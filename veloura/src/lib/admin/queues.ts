import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Comments waiting for review, plus live comments with open reader reports. Shown in the admin nav, overview and moderation tabs. */
export async function commentQueueCounts(): Promise<{ pending: number; reported: number; total: number }> {
  const admin = supabaseAdmin();
  const [{ count: pending }, { data: rep }] = await Promise.all([
    admin.from("comments").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("comment_reports").select("comment_id,comment:comments!inner(status)").eq("status", "open").eq("comment.status", "approved").limit(500),
  ]);
  const reported = new Set(((rep ?? []) as unknown as { comment_id: string }[]).map((r) => r.comment_id)).size;
  const p = pending ?? 0;
  return { pending: p, reported, total: p + reported };
}
