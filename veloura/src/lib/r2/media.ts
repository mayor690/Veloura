import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "./client";
import { presignGet } from "./storage";

export type SignedMedia = { id: string; type: "image" | "video"; url: string; mime: string };

/** Short-lived read URLs for a post's media. Call only after the caller has been authorised for the post. */
export async function signedMediaForPost(postId: string, ttlSeconds = 1800): Promise<SignedMedia[]> {
  if (!r2Configured()) return [];
  const { data } = await supabaseAdmin()
    .from("post_media")
    .select("id,type,storage_path,mime_type")
    .eq("post_id", postId)
    .eq("status", "ready")
    .order("sort_order");
  const rows = (data ?? []) as { id: string; type: "image" | "video"; storage_path: string; mime_type: string }[];
  return Promise.all(
    rows.map(async (r) => ({ id: r.id, type: r.type, mime: r.mime_type, url: await presignGet(r.storage_path, ttlSeconds) }))
  );
}
