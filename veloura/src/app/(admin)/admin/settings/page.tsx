import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { btn, inputCls } from "@/components/admin/ui";
import { ago } from "@/lib/constants";
import { saveSettings } from "./actions";

const ERR: Record<string, string> = {
  rate_jump: "The exchange rate changed by more than 15%. Tick the confirmation box if that is intended.",
  failed: "Could not save. Try again.",
};

function Field({ label, name, value, hint, step = "any" }: { label: string; name: string; value: number; hint?: string; step?: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span>{label}</span>
      <input name={name} type="number" step={step} defaultValue={value} required className={inputCls} />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ e?: string; f?: string; saved?: string }> }) {
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const { data } = await supabaseAdmin().from("site_settings").select("key,value,updated_at");
  const rows = (data ?? []) as { key: string; value: unknown; updated_at: string | null }[];
  const val = (k: string, d: number) => { const n = Number(rows.find((r) => r.key === k)?.value); return Number.isFinite(n) ? n : d; };
  const flag = (k: string, d: boolean) => { const r = rows.find((x) => x.key === k); return r ? r.value === true : d; };
  const rateAt = rows.find((r) => r.key === "usd_ngn_rate")?.updated_at;

  return (
    <form action={saveSettings} className="grid max-w-2xl gap-6">
      <h1 className="font-display text-3xl">Site settings</h1>
      {sp.saved && <p className="rounded-xl bg-emerald-500/15 p-3 text-sm text-emerald-300">Saved.</p>}
      {sp.e && <p className="rounded-xl bg-rose/15 p-3 text-sm text-rose">{sp.e === "invalid" ? `Check the value for “${sp.f}”.` : ERR[sp.e] ?? ERR.failed}</p>}

      <section className="grid gap-4 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Exchange rate</h2>
        <Field label="Naira per 1 US dollar (₦ / $)" name="usd_ngn_rate" value={val("usd_ngn_rate", 1500)}
          hint={`Wallet credit = USD paid × this rate. Locked per payment. ${rateAt ? `Last confirmed ${ago(rateAt)} ago.` : ""} Saving this form re-confirms the rate.`} />
        <label className="flex items-start gap-2 text-xs text-muted"><input type="checkbox" name="confirm_rate" className="mt-0.5" /> I confirm a rate change of more than 15% is intended</label>
      </section>

      <section className="grid gap-4 rounded-2xl border border-line bg-card p-5 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Prices (₦)</h2>
        <Field label="One category, per unlock" name="daily_price_naira" value={val("daily_price_kobo", 11200) / 100} />
        <Field label="Full Daily Pass" name="full_pass_naira" value={val("full_pass_price_kobo", 28000) / 100} />
        <Field label="Unlock length (hours)" name="unlock_hours" value={val("unlock_hours", 24)} step="1" hint="Rolling from the time of payment." />
      </section>

      <section className="grid gap-4 rounded-2xl border border-line bg-card p-5 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Wallet top-ups</h2>
        <Field label="Minimum top-up (₦)" name="min_topup_naira" value={val("min_topup_kobo", 50000) / 100} hint="The effective minimum is the larger of this and the USD floor." />
        <Field label="USD floor, minimum ($)" name="min_topup_usd" value={val("min_topup_usd_cents", 100) / 100} hint="Raise this if the payment provider rejects small invoices." />
        <Field label="Maximum top-up ($)" name="max_topup_usd" value={val("max_topup_usd_cents", 20000) / 100} />
      </section>

      <section className="grid gap-4 rounded-2xl border border-line bg-card p-5 sm:grid-cols-2">
        <h2 className="font-semibold sm:col-span-2">Creators</h2>
        <Field label="Creator share of revenue (%)" name="creator_share_pct" value={val("creator_share_pct", 40)} hint="Share of each day's unlock revenue paid to creators (default 40)." />
        <Field label="Minimum payout (₦)" name="min_payout_naira" value={val("min_payout_kobo", 500000) / 100} />
        <Field label="Points per premium view" name="weight_view" value={val("weight_view", 1)} step="1" hint="Each day's creator pool is split by points. Changes apply to days not yet paid." />
        <Field label="Points per reaction" name="weight_reaction" value={val("weight_reaction", 2)} step="1" />
        <Field label="Points per approved comment" name="weight_comment" value={val("weight_comment", 3)} step="1" />
      </section>

      <section className="grid gap-3 rounded-2xl border border-line bg-card p-5 text-sm">
        <h2 className="font-semibold">Switches</h2>
        {[
          ["ads_enabled", "Show ads and sponsored posts", false],
          ["crypto_enabled", "Accept crypto payments", true],
          ["signups_enabled", "Allow new sign-ups", true],
          ["maintenance_mode", "Maintenance mode (public pages show a notice; staff can still sign in)", false],
        ].map(([k, label, d]) => (
          <label key={String(k)} className="flex items-center gap-2"><input type="checkbox" name={String(k)} defaultChecked={flag(String(k), Boolean(d))} /> {label}</label>
        ))}
      </section>

      <button className={`${btn} bg-accent-gradient`}>Save settings</button>
    </form>
  );
}
