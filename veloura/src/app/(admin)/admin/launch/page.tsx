import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "@/lib/r2/client";
import { headBucket } from "@/lib/r2/storage";
import { nowpayments } from "@/lib/payments/nowpayments";
import { Badge } from "@/components/admin/ui";
import { ago } from "@/lib/constants";

export const dynamic = "force-dynamic";
type Check = { label: string; status: "ok" | "warn" | "fail"; detail?: string };

const MANUAL: { group: string; items: string[] }[] = [
  { group: "Legal and policy", items: [
    "Terms, Privacy and Content Policy pages are written by a lawyer (the shipped ones are placeholders).",
    "Written confirmation that your crypto payment provider and Cloudflare allow this content category.",
    "Legal advice on reporting and retention duties for suspected-minor and non-consensual material (quarantine policy).",
    "A real contact for takedown requests and law-enforcement queries, published on the site.",
    "A moderator rota: someone watches the Urgent tab every day, with a target response time.",
  ] },
  { group: "Money", items: [
    "One real $1 top-up end to end: invoice, webhook, wallet credit, unlock, and the funds arriving in your payout wallet.",
    "A replayed NOWPayments webhook does not credit twice.",
    "One real payout processed end to end (request, send, mark paid).",
    "You have a plan for refunds and chargebacks (crypto has no chargebacks; decide your policy).",
  ] },
  { group: "Security and operations", items: [
    "All secrets are set in production only, none committed, and PAYOUT_ENCRYPTION_KEY is backed up somewhere separate.",
    "Supabase: automatic backups on (paid plan) or a scheduled export; you have tested a restore.",
    "Supabase Auth rate limits reviewed and the project's anon key is not shipped to browsers (this app never uses it client-side).",
    "Error monitoring (for example Sentry) and an uptime monitor on /api/health.",
    "Two-factor authentication on Supabase, Vercel, Cloudflare, NOWPayments and your domain registrar.",
    "Staff accounts use strong unique passwords and the recovery code is stored safely.",
  ] },
  { group: "Product", items: [
    "Registration, login, recovery code flow and 18+ gate tested on a real phone (iOS Safari and Android Chrome).",
    "Video record and upload tested on both phones, including a dropped connection mid-upload.",
    "Run scripts/sql_smoke_test.py against the final migrations, and npm test.",
  ] },
];

export default async function Launch() {
  if (!(await requireAdmin())) notFound();
  const admin = supabaseAdmin();
  const env = (k: string) => !!process.env[k];
  const checks: Check[] = [];
  const add = (label: string, ok: boolean, detail?: string, level: "fail" | "warn" = "fail") => checks.push({ label, status: ok ? "ok" : level, detail });

  add("Supabase keys set", env("NEXT_PUBLIC_SUPABASE_URL") && env("NEXT_PUBLIC_SUPABASE_ANON_KEY") && env("SUPABASE_SERVICE_ROLE_KEY"));
  add("RECOVERY_PEPPER is long and random", (process.env.RECOVERY_PEPPER ?? "").length >= 32, "Use at least 32 characters (openssl rand -hex 32).");
  add("RATE_LIMIT_SALT set", env("RATE_LIMIT_SALT"), "Falls back to RECOVERY_PEPPER; a separate value is cleaner.", "warn");
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  add("Site URL is a public https address", site.startsWith("https://") && !site.includes("localhost"), `Currently: ${site || "not set"}. Needed for webhooks and links.`);
  add("NOWPayments keys set", nowpayments.configured());
  add("R2 variables set", r2Configured());
  if (r2Configured()) add("R2 bucket reachable with these credentials", await headBucket(), "Check the bucket name, token permissions and R2_ENDPOINT.");
  add("CRON_SECRET set (nightly jobs)", env("CRON_SECRET"), "Without it the nightly earnings and cleanup jobs are rejected.");
  add("PAYOUT_ENCRYPTION_KEY valid", /^[0-9a-fA-F]{64}$/.test(process.env.PAYOUT_ENCRYPTION_KEY ?? ""), "Exactly 64 hex characters.");

  const [{ count: admins }, { count: cats }, { data: set }, { data: lastRun }] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
    admin.from("categories").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin.from("site_settings").select("key,value,updated_at,updated_by"),
    admin.from("earnings_runs").select("earn_date,ran_at").order("earn_date", { ascending: false }).limit(1),
  ]);
  const s = (k: string) => ((set ?? []) as { key: string; value: unknown; updated_at: string | null; updated_by: string | null }[]).find((r) => r.key === k);
  add("At least one admin exists", (admins ?? 0) >= 1);
  add("All 7 categories active", (cats ?? 0) >= 7, `${cats ?? 0} active.`, "warn");
  add("Exchange rate was set by an admin (not the seeded placeholder)", !!s("usd_ngn_rate")?.updated_by, "Open Settings, enter today's rate and save.");
  const rateAt = s("usd_ngn_rate")?.updated_at;
  add("Exchange rate confirmed in the last 7 days", !!rateAt && Date.now() - new Date(rateAt).getTime() < 7 * 86_400_000, rateAt ? `Last confirmed ${ago(rateAt)} ago.` : "Never.", "warn");
  add("Crypto payments switched on", s("crypto_enabled")?.value !== false);
  add("Maintenance mode is off", s("maintenance_mode")?.value !== true, "Public pages are hidden while it is on.");
  add("Sign-ups are open", s("signups_enabled")?.value !== false, undefined, "warn");
  const run = (lastRun ?? [])[0] as { earn_date: string; ran_at: string } | undefined;
  add("Nightly earnings job has run recently", !!run && Date.now() - new Date(run.ran_at).getTime() < 36 * 3_600_000,
    run ? `Last run ${ago(run.ran_at)} ago (for ${run.earn_date}).` : "No run yet. Expected after the first full day; check the cron in Vercel.", "warn");

  const tone = { ok: "good", warn: "warn", fail: "danger" } as const;
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;

  return (
    <div className="grid gap-6">
      <h1 className="font-display text-3xl">Launch checks</h1>
      <p className={`rounded-xl border p-4 text-sm ${fails ? "border-rose/50 text-rose" : warns ? "border-amber-400/40 text-amber-200" : "border-emerald-500/40 text-emerald-300"}`}>
        {fails ? `${fails} blocking issue(s) to fix before launch.` : warns ? `No blockers, ${warns} thing(s) to review.` : "All automatic checks pass."} The list below cannot be checked by the app; tick them off yourself.
      </p>
      <ul className="grid gap-2">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-3 rounded-xl border border-line bg-card p-3 text-sm">
            <Badge tone={tone[c.status]}>{c.status === "ok" ? "OK" : c.status === "warn" ? "Review" : "Fix"}</Badge>
            <div><p>{c.label}</p>{c.status !== "ok" && c.detail && <p className="text-xs text-muted">{c.detail}</p>}</div>
          </li>
        ))}
      </ul>
      {MANUAL.map((g) => (
        <section key={g.group} className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-semibold">{g.group}</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {g.items.map((i) => <li key={i} className="flex items-start gap-2"><input type="checkbox" className="mt-1" aria-label={i} /> <span>{i}</span></li>)}
          </ul>
        </section>
      ))}
      <p className="text-xs text-muted">Tick boxes here are not saved. The same list, with more detail, is in docs/LAUNCH_CHECKLIST.md.</p>
    </div>
  );
}
