"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

const ERR: Record<string, string> = {
  tips_off: "Tips are switched off right now.",
  below_min: "That is below the minimum tip.",
  above_max: "That is above the maximum tip.",
  banned: "Your account cannot send tips.",
  post_not_found: "This post is no longer available.",
  own_post: "You can't tip your own post.",
  creator_unavailable: "This creator can't receive tips right now.",
  no_access: "Unlock this category to tip.",
  daily_cap: "You have reached the daily tipping limit. Try again later.",
  insufficient_balance: "Not enough balance. Top up your wallet to tip.",
};

export async function sendTip(postId: string, amountNaira: number): Promise<{ ok: true } | { error: string; topUp?: boolean }> {
  const { data: { user } } = await createClient().then((s) => s.auth.getUser());
  if (!user) return { error: "Log in to tip." };
  if (!Number.isFinite(amountNaira) || amountNaira <= 0) return { error: "Enter a valid amount." };
  const amountKobo = Math.round(amountNaira * 100);

  const { error } = await supabaseAdmin().rpc("send_tip", { p_user: user.id, p_post: postId, p_amount: amountKobo });
  if (error) {
    const key = Object.keys(ERR).find((k) => error.message.includes(k));
    if (!key) console.error("[tip] failed", error);
    return { error: key ? ERR[key] : "Could not send your tip. Try again.", topUp: key === "insufficient_balance" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export type TipLimits = { enabled: boolean; feePct: number; minKobo: number; maxKobo: number };

/** Current tipping rules, for the Tip button. */
export async function loadTipLimits(): Promise<TipLimits> {
  const { data } = await supabaseAdmin().from("site_settings").select("key,value")
    .in("key", ["tips_enabled", "tip_fee_pct", "tip_min_kobo", "tip_max_kobo"]);
  const m = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => { const n = Number(m.get(k)); return Number.isFinite(n) ? n : d; };
  return { enabled: m.get("tips_enabled") === true, feePct: num("tip_fee_pct", 10), minKobo: num("tip_min_kobo", 10000), maxKobo: num("tip_max_kobo", 5000000) };
}
