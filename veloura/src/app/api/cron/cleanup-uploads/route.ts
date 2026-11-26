import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "@/lib/r2/client";
import { abortMultipart, deleteObject } from "@/lib/r2/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Daily: remove uploads that were started or finished but never attached to a post. Vercel Cron sends CRON_SECRET. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!r2Configured()) return NextResponse.json({ ok: true, skipped: "r2 not configured" });

  const cutoff = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const admin = supabaseAdmin();
  const { data } = await admin.from("media_uploads")
    .select("id,object_key,mode,r2_upload_id,status")
    .in("status", ["initiated", "verified"]).lt("created_at", cutoff).limit(200);

  await admin.rpc("auth_rl_purge"); // drop login/recovery attempt records older than 2 days

  let cleaned = 0;
  for (const u of (data ?? []) as { id: string; object_key: string; mode: string; r2_upload_id: string | null; status: string }[]) {
    try {
      if (u.mode === "multipart" && u.status === "initiated" && u.r2_upload_id) await abortMultipart(u.object_key, u.r2_upload_id);
      else await deleteObject(u.object_key);
      await admin.from("media_uploads").update({ status: "aborted" }).eq("id", u.id);
      cleaned++;
    } catch (e) {
      console.error("[cleanup] failed for", u.id, e);
    }
  }
  return NextResponse.json({ ok: true, cleaned });
}
