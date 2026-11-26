"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "@/lib/r2/client";
import { deleteObject } from "@/lib/r2/storage";
import { audit } from "@/lib/admin/audit";

/** Permanently deletes quarantined media. Irreversible: only after you have taken legal advice on reporting and retention. */
export async function purgeQuarantine(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff || fd.get("confirm") !== "on") return;
  const postId = String(fd.get("postId") ?? "");
  const admin = supabaseAdmin();
  const { data } = await admin.from("post_media").select("id,storage_path").eq("post_id", postId).eq("status", "quarantined");
  if (!r2Configured()) return;
  for (const m of (data ?? []) as { id: string; storage_path: string }[]) {
    try { await deleteObject(m.storage_path); await admin.from("post_media").delete().eq("id", m.id); }
    catch (e) { console.error("[quarantine] delete failed", e); }
  }
  await audit(staff.id, "quarantine.purge", "post", postId);
  revalidatePath("/admin/quarantine");
}
