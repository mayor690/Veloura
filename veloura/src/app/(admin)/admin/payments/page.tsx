import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge, btn, inputCls } from "@/components/admin/ui";
import { naira } from "@/lib/constants";
import { usd } from "@/lib/payments/fx";

type P = {
  id: string; reference: string; method: string; provider: string; amount_kobo: number; price_usd_cents: number | null; fx_rate: number | null;
  status: string; provider_status: string | null; item_kind: string; crypto_asset: string | null; tx_hash: string | null;
  created_at: string; confirmed_at: string | null; raw_webhook: unknown; profiles: { username: string } | null;
};
const TONE: Record<string, "good" | "warn" | "danger" | "default"> = { succeeded: "good", pending: "warn", failed: "danger", expired: "danger", refunded: "default" };

export default async function Payments({ searchParams }: { searchParams: Promise<{ status?: string; kind?: string; q?: string }> }) {
  if (!(await requireAdmin())) notFound();
  const { status = "", kind = "", q = "" } = await searchParams;
  let query = supabaseAdmin().from("payments")
    .select("id,reference,method,provider,amount_kobo,price_usd_cents,fx_rate,status,provider_status,item_kind,crypto_asset,tx_hash,created_at,confirmed_at,raw_webhook,profiles(username)")
    .order("created_at", { ascending: false }).limit(100);
  if (status) query = query.eq("status", status);
  if (kind) query = query.eq("item_kind", kind);
  if (q.trim()) query = query.ilike("reference", `%${q.trim().replace(/[%_]/g, "")}%`);
  const { data } = await query;
  const rows = (data ?? []) as unknown as P[];

  const filters = (label: string, name: string, values: string[], current: string) => (
    <div className="flex flex-wrap items-center gap-1 text-xs">
      <span className="text-muted">{label}:</span>
      {["", ...values].map((v) => {
        const sp = new URLSearchParams({ status, kind, q, [name]: v });
        return <Link key={v || "all"} href={`/admin/payments?${sp}`} className={`rounded-full px-2.5 py-1 ${current === v ? "bg-purple/20 text-white" : "text-muted"}`}>{v || "all"}</Link>;
      })}
    </div>
  );

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Payments</h1>
      <p className="text-sm text-muted">Crypto top-ups and wallet unlocks. Fix a wrong or partial payment with a balance adjustment on the Users page (needs a note, is audited).</p>
      <div className="grid gap-2">
        {filters("Status", "status", ["pending", "succeeded", "failed", "expired", "refunded"], status)}
        {filters("Type", "kind", ["topup", "category", "full_pass"], kind)}
        <form className="flex gap-2"><input type="hidden" name="status" value={status} /><input type="hidden" name="kind" value={kind} />
          <input name="q" defaultValue={q} placeholder="Search by reference" className={`${inputCls} flex-1`} /><button className={`${btn} border border-line`}>Search</button></form>
      </div>
      {rows.map((p) => (
        <article key={p.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[p.status] ?? "default"}>{p.status}</Badge>
            <span className="font-semibold">{naira(p.amount_kobo)}</span>
            {p.price_usd_cents != null && <span className="text-muted">({usd(p.price_usd_cents)} at ₦{p.fx_rate})</span>}
            <span className="text-muted">· {p.item_kind} · {p.method}</span>
            {p.provider_status && <span className="text-muted">· provider: {p.provider_status}</span>}
          </div>
          <p className="mt-1 break-all text-xs text-muted">@{p.profiles?.username} · {p.reference} · {new Date(p.created_at).toLocaleString("en-NG")}{p.tx_hash ? ` · tx ${p.tx_hash}` : ""}</p>
          {p.raw_webhook != null && (
            <details className="mt-2"><summary className="cursor-pointer text-xs text-muted">Provider payload</summary>
              <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-ink p-3 text-xs">{JSON.stringify(p.raw_webhook, null, 2)}</pre></details>
          )}
        </article>
      ))}
      {!rows.length && <p className="text-muted">No payments match.</p>}
    </div>
  );
}
