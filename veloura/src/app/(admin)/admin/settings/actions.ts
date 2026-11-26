"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { settingsSchema } from "@/validations/settings";

const BOOLS = ["ads_enabled", "crypto_enabled", "signups_enabled", "maintenance_mode", "comment_auto_approve", "tips_enabled", "bank_enabled"] as const;

export async function saveSettings(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;

  const parsed = settingsSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) redirect(`/admin/settings?e=invalid&f=${encodeURIComponent(String(parsed.error.issues[0].path[0] ?? ""))}`);
  const v = parsed.data;
  if (fd.get("bank_enabled") === "on" && (!v.bank_name || !v.bank_account_name || !/^\d{10}$/.test(v.bank_account_number))) {
    redirect("/admin/settings?e=bank_details");
  }

  const admin = supabaseAdmin();
  const { data: old } = await admin.from("site_settings").select("key,value");
  const prev = Object.fromEntries(((old ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));

  // Guard against typos: a big jump in the exchange rate needs an explicit confirmation.
  const oldRate = Number(prev.usd_ngn_rate);
  if (Number.isFinite(oldRate) && oldRate > 0 && Math.abs(v.usd_ngn_rate - oldRate) / oldRate > 0.15 && fd.get("confirm_rate") !== "on") {
    redirect("/admin/settings?e=rate_jump");
  }

  const next: Record<string, unknown> = {
    usd_ngn_rate: v.usd_ngn_rate,
    daily_price_kobo: Math.round(v.daily_price_naira * 100),
    full_pass_price_kobo: Math.round(v.full_pass_naira * 100),
    min_topup_kobo: Math.round(v.min_topup_naira * 100),
    min_topup_usd_cents: Math.round(v.min_topup_usd * 100),
    max_topup_usd_cents: Math.round(v.max_topup_usd * 100),
    unlock_hours: v.unlock_hours,
    creator_share_pct: v.creator_share_pct,
    min_payout_kobo: Math.round(v.min_payout_naira * 100),
    weight_view: v.weight_view,
    weight_reaction: v.weight_reaction,
    weight_comment: v.weight_comment,
    comment_trust_min_approved: v.comment_trust_min_approved,
    tip_fee_pct: v.tip_fee_pct,
    tip_min_kobo: Math.round(v.tip_min_naira * 100),
    tip_max_kobo: Math.round(v.tip_max_naira * 100),
    tip_daily_cap_kobo: Math.round(v.tip_daily_cap_naira * 100),
    bank_name: v.bank_name,
    bank_account_name: v.bank_account_name,
    bank_account_number: v.bank_account_number,
    bank_min_kobo: Math.round(v.bank_min_naira * 100),
    bank_max_kobo: Math.round(v.bank_max_naira * 100),
    bank_expiry_hours: v.bank_expiry_hours,
    bank_max_pending: v.bank_max_pending,
  };
  for (const b of BOOLS) next[b] = fd.get(b) === "on";

  const now = new Date().toISOString();
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const rows = Object.entries(next)
    .filter(([k, val]) => {
      if (k === "usd_ngn_rate") return true;               // saving always re-confirms the rate (resets the staleness warning)
      const differs = JSON.stringify(prev[k]) !== JSON.stringify(val);
      return differs;
    })
    .map(([key, value]) => {
      if (JSON.stringify(prev[key]) !== JSON.stringify(value)) changed[key] = { from: prev[key], to: value };
      return { key, value, updated_by: staff.id, updated_at: now };
    });

  const { error } = await admin.from("site_settings").upsert(rows, { onConflict: "key" });
  if (error) { console.error("[settings] save failed", error); redirect("/admin/settings?e=failed"); }
  await audit(staff.id, "settings.update", "settings", "site", { changed });
  revalidatePath("/", "layout");
  redirect("/admin/settings?saved=1");
}
