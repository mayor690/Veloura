"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function unlockWithWallet(kind: "category" | "full_pass", categoryId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/register");

  const { error } = await supabaseAdmin().rpc("unlock_with_wallet", {
    p_user: user.id,
    p_kind: kind,
    p_category_ids: kind === "category" && categoryId ? [categoryId] : [],
  });
  if (error) {
    if (error.message.includes("insufficient_balance")) return { error: "insufficient" as const };
    if (error.message.includes("already_unlocked")) return { error: "already" as const };
    return { error: "failed" as const };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

const REPORT_REASONS = ["possible_minor", "non_consensual", "illegal", "spam", "personal_info", "other"];

export async function reportPost(postId: string, reason: string, details: string): Promise<{ ok: true; urgent: boolean } | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "login" };
  if (!REPORT_REASONS.includes(reason)) return { error: "Choose a reason." };
  const { data, error } = await supabaseAdmin().rpc("create_report", {
    p_user: user.id, p_post: postId, p_reason: reason, p_details: String(details ?? "").slice(0, 1000),
  });
  if (error) {
    if (error.message.includes("rate_limited")) return { error: "You've sent a lot of reports today. Please try again tomorrow." };
    if (error.message.includes("post_not_found")) return { error: "This post is no longer available." };
    if (error.message.includes("banned")) return { error: "Your account cannot send reports." };
    console.error("[report] failed", error);
    return { error: "Could not send your report. Try again." };
  }
  return { ok: true, urgent: data === "urgent" };
}
