import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge } from "@/components/admin/ui";
import { naira, ago } from "@/lib/constants";

type Row = { id: string; amount_kobo: number; status: string; created_at: string; reference: string | null; profiles: { username: string } | null; payout_accounts: { label: string; type: string } | null };
const TONE: Record<string, "good" | "warn" | "danger" | "info"> = { requested: "warn", approved: "info", paid: "good", rejected: "danger" };

export default async function Payouts({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  if (!(await requireAdmin())) notFound();
  const { status = "open" } = await searchParams;
  let q = supabaseAdmin().from("payouts")
    .select("id,amount_kobo,status,created_at,reference,profiles!payouts_creator_id_fkey(username),payout_accounts(label,type)")
    .order("created_at", { ascending: status === "open" }).limit(100);
  q = status === "open" ? q.in("status", ["requested", "approved"]) : q.eq("status", status);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Creator payouts</h1>
      <nav className="flex gap-2 text-sm">
        {["open", "paid", "rejected"].map((s) => (
          <Link key={s} href={`/admin/payouts?status=${s}`} className={`rounded-full border px-4 py-1.5 ${status === s ? "border-purple bg-purple/15" : "border-line text-muted"}`}>{s}</Link>
        ))}
      </nav>
      <p className="text-sm text-muted">Funds are held (deducted from the creator&apos;s balance) when they request a payout, and returned if you reject it. Open a payout to see the decrypted account details; each view is logged.</p>
      {rows.map((p) => (
        <Link key={p.id} href={`/admin/payouts/${p.id}`} className="rounded-2xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={TONE[p.status] ?? "info"}>{p.status}</Badge>
            <span className="font-semibold">{naira(p.amount_kobo)}</span>
            <span className="text-sm text-muted">@{p.profiles?.username} · {p.payout_accounts?.label}</span>
          </div>
          <p className="mt-1 text-xs text-muted">Requested {ago(p.created_at)} ago{p.reference ? ` · ref ${p.reference}` : ""}</p>
        </Link>
      ))}
      {!rows.length && <p className="text-muted">Nothing here.</p>}
    </div>
  );
}
