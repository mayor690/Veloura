import Link from "next/link";
import { requireStaff } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadFx } from "@/lib/payments/settings";
import { nowpayments } from "@/lib/payments/nowpayments";
import { r2Configured } from "@/lib/r2/client";
import { naira, ago } from "@/lib/constants";
import { usd } from "@/lib/payments/fx";
import { BarChart, Stat } from "@/components/admin/ui";

type Overview = Record<string, number | string | null>;
type Day = { day: string; signups: number; topup_kobo: number; spend_kobo: number; views: number; unlocks: number };

export default async function AdminHome() {
  const staff = await requireStaff();
  const admin = supabaseAdmin();
  const [{ data: ov }, { data: days }, { data: top }, fx] = await Promise.all([
    admin.rpc("admin_overview"),
    admin.rpc("admin_daily_stats", { p_days: 14 }),
    admin.from("posts").select("id,title,view_count,categories(name)").eq("status", "approved").order("view_count", { ascending: false }).limit(5),
    loadFx(),
  ]);
  const o = (ov ?? {}) as Overview;
  const n = (k: string) => Number(o[k] ?? 0);
  const series = ((days ?? []) as Day[]).map((d) => ({ ...d, label: d.day.slice(5) }));
  const isAdmin = staff?.role === "admin";

  const warnings: string[] = [];
  if (!fx) warnings.push("Exchange rate is missing or invalid: crypto top-ups are off.");
  else if (fx.rateUpdatedAt && Date.now() - new Date(fx.rateUpdatedAt).getTime() > 7 * 86_400_000)
    warnings.push(`Exchange rate was last updated ${ago(fx.rateUpdatedAt)} ago. Check it against the market.`);
  if (!nowpayments.configured()) warnings.push("NOWPayments environment variables are not set.");
  if (!r2Configured()) warnings.push("R2 environment variables are not set: uploads are off.");
  if (!process.env.CRON_SECRET) warnings.push("CRON_SECRET is not set: abandoned uploads are not being cleaned up.");
  if (!process.env.PAYOUT_ENCRYPTION_KEY) warnings.push("PAYOUT_ENCRYPTION_KEY is not set: creators cannot save payout accounts.");

  return (
    <div className="grid gap-6">
      {warnings.length > 0 && (
        <ul className="grid gap-1 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          {warnings.map((w) => <li key={w}>• {w}</li>)}
        </ul>
      )}

      <section className="grid gap-3 sm:grid-cols-3">
        <Link href="/admin/moderation?tab=urgent"><Stat label="Urgent reports" value={n("reports_urgent")} tone={n("reports_urgent") ? "danger" : "default"}
          sub={o.oldest_urgent_at ? `oldest ${ago(String(o.oldest_urgent_at))}` : "none waiting"} /></Link>
        <Link href="/admin/moderation?tab=reports"><Stat label="Other reports" value={n("reports_open")} tone={n("reports_open") ? "warn" : "default"} /></Link>
        <Link href="/admin/moderation?tab=posts"><Stat label="New posts to review" value={n("posts_pending")} tone={n("posts_pending") ? "warn" : "default"} /></Link>
      </section>

      {isAdmin && (
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Top-ups today" value={naira(n("topups_today_kobo"))} sub={`30 days: ${naira(n("topups_30d_kobo"))} (${usd(n("topups_30d_usd_cents"))})`} />
          <Stat label="Spent on unlocks today" value={naira(n("spend_today_kobo"))} sub={`30 days: ${naira(n("spend_30d_kobo"))}`} />
          <Stat label="Wallets hold (owed to users)" value={naira(n("wallet_liability_kobo"))} sub="prepaid balances not yet spent" />
          <Stat label="Owed to creators" value={naira(n("creator_liability_kobo"))} sub={`${n("payouts_pending")} payout(s) pending, ${naira(n("payouts_pending_kobo"))}`} tone={n("payouts_pending") ? "warn" : "default"} />
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Users" value={n("users_total").toLocaleString()} sub={`+${n("users_7d")} in 7 days`} />
        <Stat label="Active unlocks now" value={n("active_unlocks")} sub={`${n("unlocks_30d")} in 30 days`} />
        <Stat label="Live posts" value={n("posts_live")} />
        <Stat label="Payments pending" value={n("payments_pending")} sub="created in the last 7 days" tone={n("payments_pending") > 5 ? "warn" : "default"} />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <BarChart title="Sign-ups per day (14 days)" data={series.map((d) => ({ label: d.label, value: d.signups }))} format={(v) => String(v)} />
        <BarChart title="Post views per day (every view is paid)" data={series.map((d) => ({ label: d.label, value: d.views }))} format={(v) => String(v)} />
        {isAdmin && <BarChart title="Top-ups per day (₦)" data={series.map((d) => ({ label: d.label, value: d.topup_kobo }))} format={naira} />}
        {isAdmin && <BarChart title="Unlock spend per day (₦)" data={series.map((d) => ({ label: d.label, value: d.spend_kobo }))} format={naira} />}
      </section>
      <p className="-mt-3 text-xs text-muted">Traffic here means sign-ups and premium views recorded in the database. For page-level traffic (visitors, sources), add a privacy-friendly analytics tool.</p>

      <section className="rounded-2xl border border-line bg-card p-4">
        <h2 className="font-semibold">Top posts by premium views</h2>
        <ol className="mt-3 grid gap-2 text-sm">
          {((top ?? []) as unknown as { id: string; title: string | null; view_count: number; categories: { name: string } | null }[]).map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="truncate">{p.title ?? "Untitled"} <span className="text-muted">· {p.categories?.name}</span></span>
              <span className="shrink-0 text-muted">{p.view_count} views</span>
            </li>
          ))}
          {!top?.length && <li className="text-muted">No views yet.</li>}
        </ol>
      </section>
    </div>
  );
}
