"use server";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "@/lib/r2/client";
import { deleteObject } from "@/lib/r2/storage";
import { audit } from "@/lib/admin/audit";

const done = () => revalidatePath("/admin/moderation");

async function purgeMedia(postId: string) {
  const admin = supabaseAdmin();
  const { data } = await admin.from("post_media").select("storage_path").eq("post_id", postId);
  if (r2Configured()) {
    for (const m of (data ?? []) as { storage_path: string }[]) {
      try { await deleteObject(m.storage_path); } catch (e) { console.error("[moderation] R2 delete failed", e); }
    }
  }
  await admin.from("post_media").delete().eq("post_id", postId);
}

/** Pre-publication review: approve. */
export async function approvePost(fd: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin().from("posts")
    .update({ status: "approved", published_at: now, moderated_by: staff.id, moderated_at: now, rejection_reason: null })
    .eq("id", id).eq("status", "pending").select("id");
  if (data?.length) await audit(staff.id, "post.approve", "post", id);
  done();
}

/** Pre-publication review: reject and delete the media. */
export async function rejectPost(fd: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const reason = String(fd.get("reason") ?? "").slice(0, 80);
  const note = String(fd.get("note") ?? "").trim().slice(0, 300);
  const { data } = await supabaseAdmin().from("posts")
    .update({ status: "rejected", rejection_reason: note ? `${reason}: ${note}` : reason, moderated_by: staff.id, moderated_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending").select("id");
  if (!data?.length) return done();
  await purgeMedia(id);
  await audit(staff.id, "post.reject", "post", id, { reason, note });
  done();
}

/** Reports: dismiss them all (also releases an automatic hold). */
export async function dismissReports(fd: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!staff) return;
  const { error } = await supabaseAdmin().rpc("resolve_post_reports", {
    p_staff: staff.id, p_post: String(fd.get("postId") ?? ""), p_action: "dismiss",
    p_note: String(fd.get("note") ?? "").slice(0, 300), p_quarantine: false,
  });
  if (error) console.error("[moderation] dismiss failed", error);
  done();
}

/**
 * Takedown. Routine takedowns delete the media. If an urgent report is open (possible minor / non-consensual) or the
 * moderator ticks "keep as evidence", media is quarantined instead: kept in the private bucket, never served.
 * Banning is admin-only.
 */
export async function takedownPost(fd: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!staff) return;
  const postId = String(fd.get("postId") ?? "");
  const note = String(fd.get("note") ?? "").trim().slice(0, 300);
  const admin = supabaseAdmin();

  const { data: result, error } = await admin.rpc("resolve_post_reports", {
    p_staff: staff.id, p_post: postId, p_action: "takedown", p_note: note, p_quarantine: fd.get("quarantine") === "on",
  });
  if (error) { console.error("[moderation] takedown failed", error); return done(); }
  if (result === "removed") await purgeMedia(postId);

  if (fd.get("ban") === "on" && staff.role === "admin") {
    const { data: post } = await admin.from("posts").select("author_id").eq("id", postId).single();
    if (post) {
      await admin.from("profiles").update({ is_banned: true, ban_reason: note || "Content policy violation" }).eq("id", post.author_id);
      await audit(staff.id, "user.ban", "user", post.author_id, { via: "takedown", post: postId, note });
    }
  }
  done();
}

/* ---------- comments (always reviewed before they appear; approved comments earn the author 3 points) ---------- */
export async function approveComment(fd: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const now = new Date().toISOString();
  const { data } = await supabaseAdmin().from("comments")
    .update({ status: "approved", approved_at: now, moderated_by: staff.id }).eq("id", id).eq("status", "pending").select("id");
  if (data?.length) await audit(staff.id, "comment.approve", "comment", id);
  done();
}

export async function rejectComment(fd: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const { data } = await supabaseAdmin().from("comments")
    .update({ status: "rejected", moderated_by: staff.id }).eq("id", id).eq("status", "pending").select("id");
  if (data?.length) await audit(staff.id, "comment.reject", "comment", id);
  done();
}

export async function removeComment(fd: FormData): Promise<void> {
  const staff = await requireStaff();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const { data } = await supabaseAdmin().from("comments")
    .update({ status: "removed", moderated_by: staff.id }).eq("id", id).eq("status", "approved").select("id");
  if (data?.length) await audit(staff.id, "comment.remove", "comment", id);
  done();
}
