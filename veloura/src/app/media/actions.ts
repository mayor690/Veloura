"use server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "@/lib/r2/client";
import {
  abortMultipart, completeMultipart, createMultipart, deleteObject, headObject,
  listParts, newObjectKey, presignPart, presignPut, readHead,
} from "@/lib/r2/storage";
import { expectedPartBytes, planUpload, validateMediaMeta } from "@/lib/media/limits";
import { mimeMatches, sniffMime } from "@/lib/media/sniff";
import { initUploadSchema } from "@/validations/media";

type Err = { error: string };
const UNAVAILABLE: Err = { error: "Uploads are unavailable right now. Try again later." };

async function activeUserId(): Promise<string | Err> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Please log in to upload." };
  const { data: p } = await supabaseAdmin().from("profiles").select("is_banned").eq("id", user.id).single();
  if (!p || p.is_banned) return { error: "Your account cannot upload." };
  return user.id;
}

type UploadRow = {
  id: string; user_id: string; object_key: string; kind: "image" | "video"; mime_type: string;
  declared_size_bytes: number; mode: "single" | "multipart"; r2_upload_id: string | null;
  part_size: number | null; part_count: number | null; status: string;
};

async function ownedUpload(userId: string, id: string): Promise<UploadRow | null> {
  const { data } = await supabaseAdmin()
    .from("media_uploads")
    .select("id,user_id,object_key,kind,mime_type,declared_size_bytes,mode,r2_upload_id,part_size,part_count,status")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as UploadRow | null) ?? null;
}

/** Step 1: validate, create the upload session, and hand back either a presigned PUT or multipart parameters. */
export async function initUpload(
  raw: unknown
): Promise<Err | { id: string; mode: "single"; url: string } | { id: string; mode: "multipart"; partSize: number; partCount: number }> {
  if (!r2Configured()) return UNAVAILABLE;
  const uid = await activeUserId();
  if (typeof uid !== "string") return uid;

  const parsed = initUploadSchema.safeParse(raw);
  if (!parsed.success) return { error: "Invalid upload request." };
  const v = parsed.data;
  const bad = validateMediaMeta({ kind: v.kind, mime: v.mime, size: v.size, durationMs: v.durationMs, width: v.width, height: v.height });
  if (bad) return { error: bad };

  const admin = supabaseAdmin();
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin.from("media_uploads").select("id", { count: "exact", head: true })
    .eq("user_id", uid).gte("created_at", since);
  if ((count ?? 0) >= 40) return { error: "Too many uploads this hour. Please wait a bit." };
  const { count: waiting } = await admin.from("media_uploads").select("id", { count: "exact", head: true })
    .eq("user_id", uid).eq("status", "verified");
  if ((waiting ?? 0) >= 20) return { error: "You have too many unattached uploads. Post or remove some first." };

  const key = newObjectKey(v.mime);
  const plan = planUpload(v.kind, v.size);
  const { data: row, error } = await admin.from("media_uploads").insert({
    user_id: uid, object_key: key, kind: v.kind, mime_type: v.mime, declared_size_bytes: v.size,
    mode: plan.mode, duration_ms: v.durationMs ?? null, width: v.width ?? null, height: v.height ?? null,
    part_size: plan.mode === "multipart" ? plan.partSize : null,
    part_count: plan.mode === "multipart" ? plan.partCount : null,
  }).select("id").single();
  if (error || !row) { console.error("[upload] insert failed", error); return { error: "Could not start the upload." }; }

  try {
    if (plan.mode === "single") {
      return { id: row.id, mode: "single", url: await presignPut(key, v.mime) };
    }
    const uploadId = await createMultipart(key, v.mime);
    await admin.from("media_uploads").update({ r2_upload_id: uploadId }).eq("id", row.id);
    return { id: row.id, mode: "multipart", partSize: plan.partSize, partCount: plan.partCount };
  } catch (e) {
    console.error("[upload] R2 init failed", e);
    await admin.from("media_uploads").update({ status: "aborted" }).eq("id", row.id);
    return { error: "Storage is unavailable right now. Try again." };
  }
}

/**
 * Resume point for a multipart upload: which parts R2 already has, plus fresh presigned URLs for the rest.
 * Called at the start of every upload and again after an interruption or page reload.
 */
export async function getUploadParts(
  id: string
): Promise<Err | { partSize: number; partCount: number; done: number[]; urls: Record<string, string> }> {
  if (!r2Configured()) return UNAVAILABLE;
  const uid = await activeUserId();
  if (typeof uid !== "string") return uid;
  const up = await ownedUpload(uid, id);
  if (!up || up.status !== "initiated" || up.mode !== "multipart" || !up.r2_upload_id || !up.part_size || !up.part_count)
    return { error: "This upload can't be resumed." };

  try {
    const have = new Set((await listParts(up.object_key, up.r2_upload_id)).map((p) => p.PartNumber));
    const urls: Record<string, string> = {};
    for (let n = 1; n <= up.part_count; n++) {
      if (!have.has(n)) urls[String(n)] = await presignPart(up.object_key, up.r2_upload_id, n);
    }
    return { partSize: up.part_size, partCount: up.part_count, done: [...have].sort((a, b) => a - b), urls };
  } catch (e) {
    console.error("[upload] listParts failed", e);
    return { error: "This upload expired. Please start it again." };
  }
}

/** Last step: stitch parts together, then verify size and file type from R2 itself. Never trust the browser. */
export async function completeUpload(id: string): Promise<{ ok: true } | { error: string; retry?: boolean }> {
  if (!r2Configured()) return UNAVAILABLE;
  const uid = await activeUserId();
  if (typeof uid !== "string") return uid;
  const up = await ownedUpload(uid, id);
  if (!up || up.status !== "initiated") return { error: "Upload not found." };
  const admin = supabaseAdmin();

  const reject = async (msg: string) => {
    try { await deleteObject(up.object_key); } catch { /* may not exist */ }
    await admin.from("media_uploads").update({ status: "rejected" }).eq("id", up.id);
    return { error: msg };
  };

  try {
    if (up.mode === "multipart") {
      if (!up.r2_upload_id || !up.part_size || !up.part_count) return { error: "Upload not found." };
      const parts = await listParts(up.object_key, up.r2_upload_id);
      const byNumber = new Map(parts.map((p) => [p.PartNumber, p]));
      for (let n = 1; n <= up.part_count; n++) {
        const p = byNumber.get(n);
        if (!p) return { error: "Some parts are missing.", retry: true };
        if (p.Size !== expectedPartBytes(up.declared_size_bytes, up.part_size, up.part_count, n)) {
          return { error: "A part has the wrong size.", retry: true };
        }
      }
      await completeMultipart(up.object_key, up.r2_upload_id, parts);
    }

    const head = await headObject(up.object_key);
    if (!head) return { error: "We didn't receive the file. Please try again.", retry: true };
    if (head.size !== up.declared_size_bytes) return reject("The uploaded file didn't match its declared size.");

    const sniffed = sniffMime(await readHead(up.object_key));
    if (!mimeMatches(up.mime_type, sniffed)) return reject("That file isn't a valid image or video.");

    await admin.from("media_uploads")
      .update({ status: "verified", size_bytes: head.size, verified_at: new Date().toISOString() })
      .eq("id", up.id);
    return { ok: true };
  } catch (e) {
    console.error("[upload] complete failed", e);
    return { error: "Could not finish the upload. Try again.", retry: true };
  }
}

/** Throw away an upload the user removed before posting. */
export async function abortUpload(id: string): Promise<{ ok: true } | Err> {
  if (!r2Configured()) return UNAVAILABLE;
  const uid = await activeUserId();
  if (typeof uid !== "string") return uid;
  const up = await ownedUpload(uid, id);
  if (!up || !["initiated", "verified"].includes(up.status)) return { ok: true };
  try {
    if (up.mode === "multipart" && up.status === "initiated" && up.r2_upload_id) await abortMultipart(up.object_key, up.r2_upload_id);
    else await deleteObject(up.object_key);
  } catch (e) {
    console.error("[upload] abort failed", e);
  }
  await supabaseAdmin().from("media_uploads").update({ status: "aborted" }).eq("id", up.id);
  return { ok: true };
}
