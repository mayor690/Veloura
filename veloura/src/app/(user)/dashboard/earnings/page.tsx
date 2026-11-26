import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getViewer } from "@/lib/viewer";
import { naira } from "@/lib/constants";
import { addBankAccount, addUsdtAccount, requestPayout } from "./actions";

const MSG: Record<string, [string, boolean]> = {
  account_saved: ["Payout account saved.", true], requested: ["Payout requested. We'll review it soon.", true],
  bad_address: ["That wallet address doesn't match the network you chose.", false],
  bad_bank: ["Enter the bank name, account name and a 10-digit account number.", false],
  bad_amount: ["Enter a valid amount.", false], below_minimum: ["That is below the minimum payout.", false],
  insufficient_balance: ["You don't have that much available.", false], payout_in_progress: ["You already have a payout in progress.", false],
  invalid_account: ["Choose a payout account.", false], unavailable: ["Saving payout accounts is unavailable right now.", false],
  banned: ["Your account cannot request payouts.", false], failed: ["Something went wrong. Try again.", false],
};
const input = "h-11 rounded-xl border border-line bg-ink px-3 text-sm outline-none focus:border-purple";

export default async function Earnings({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const v = await getViewer();
  if (!v) redirect("/login");
  const { e } = await searchParams;
  const supabase = await createClient();
  const admin = supabaseAdmin();
  const [{ data: bal }, { data: pays }, { data: accts }, { data: min }, { data: earned }, { data: tipRows }] = await Promise.all([
    supabase.rpc("my_creator_balance"),
    supabase.from("payouts").select("id,amount_kobo,status,reference,note,created_at").order("created_at", { ascending: false }).limit(20),
    admin.from("payout_accounts").select("id,label,type").eq("user_id", v.id).eq("is_active", true),
    admin.from("site_settings").select("value").eq("key", "min_payout_kobo").maybeSingle(),
    admin.from("earnings_ledger").select("earn_date,views,reactions,comments,amount_kobo,posts(title)").eq("creator_id", v.id).order("earn_date", { ascending: false }).limit(60),
    admin.from("tips").select("net_kobo,created_at,posts(title)").eq("creator_id", v.id).order("created_at", { ascending: false }).limit(15),
  ]);
  type T = { net_kobo: number; created_at: string; posts: { title: string | null } | null };
  const tips = (tipRows ?? []) as unknown as T[];
  type E = { earn_date: string; views: number; reactions: number; comments: number; amount_kobo: number; posts: { title: string | null } | null };
  const byDay = new Map<string, { total: number; lines: E[] }>();
  for (const e of (earned ?? []) as unknown as E[]) {
    const d = byDay.get(e.earn_date) ?? { total: 0, lines: [] };
    d.total += e.amount_kobo; d.lines.push(e); byDay.set(e.earn_date, d);
  }
  const balance = Number(bal ?? 0);
  const minPayout = Number(min?.value ?? 500000);
  const accounts = (accts ?? []) as { id: string; label: string; type: string }[];
  const msg = e ? MSG[e] : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/dashboard" className="text-sm text-muted">&larr; Dashboard</Link>
      <h1 className="mt-3 font-display text-3xl">Earnings</h1>
      {msg && <p className={`mt-3 text-sm ${msg[1] ? "text-emerald-300" : "text-rose"}`}>{msg[0]}</p>}

      <div className="mt-5 rounded-2xl border border-line bg-card p-5">
        <p className="text-sm text-muted">Available to withdraw</p>
        <p className="mt-1 text-3xl font-semibold">{naira(balance)}</p>
        <p className="mt-1 text-xs text-muted">Minimum payout {naira(minPayout)}. One payout at a time.</p>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Recent earnings</h2>
        <p className="mt-1 text-xs text-muted">Credited each night. Your share of each day&apos;s revenue depends on how many views (1 point), reactions (2) and approved comments (3) your posts earned from other people that day.</p>
        <ul className="mt-3 grid gap-3 text-sm">
          {[...byDay.entries()].slice(0, 14).map(([day, d]) => (
            <li key={day}>
              <p className="flex justify-between font-medium"><span>{day}</span><span>{naira(d.total)}</span></p>
              <ul className="mt-1 grid gap-0.5 text-xs text-muted">
                {d.lines.map((l, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{l.posts?.title ?? "Untitled"}: {l.views} views, {l.reactions} reactions, {l.comments} comments</span><span>{naira(l.amount_kobo)}</span></li>)}
              </ul>
            </li>
          ))}
          {byDay.size === 0 && <li className="text-muted">Nothing yet. Earnings appear after the first full day with activity on your posts.</li>}
        </ul>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Tips</h2>
        <p className="mt-1 text-xs text-muted">Readers can tip you anonymously. Tips are added to your balance straight away, after the platform fee.</p>
        <ul className="mt-3 grid gap-1.5 text-sm">
          {tips.map((t, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span className="truncate text-muted">{new Date(t.created_at).toLocaleDateString("en-NG")} · {t.posts?.title ?? "Untitled"}</span>
              <span>{naira(t.net_kobo)}</span>
            </li>
          ))}
          {tips.length === 0 && <li className="text-muted">No tips yet.</li>}
        </ul>
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Request a payout</h2>
        {accounts.length === 0 ? <p className="mt-2 text-sm text-muted">Add a payout account first.</p> : (
          <form action={requestPayout} className="mt-3 grid gap-2 sm:grid-cols-3">
            <select name="account" className={input}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
            <input name="amount" type="number" step="0.01" min={minPayout / 100} max={balance / 100} defaultValue={balance >= minPayout ? balance / 100 : undefined} placeholder="Amount in ₦" required className={input} />
            <button className="h-11 rounded-xl bg-accent-gradient font-semibold">Request</button>
          </form>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Payout accounts</h2>
        <p className="mt-1 text-xs text-muted">USDT keeps you more anonymous: a bank account ties payouts to your real name. Details are encrypted and only shown to admins when processing a payout.</p>
        <ul className="mt-3 grid gap-1 text-sm">{accounts.map((a) => <li key={a.id}>{a.label}</li>)}</ul>
        <details className="mt-4"><summary className="cursor-pointer text-sm text-purple">Add a USDT wallet</summary>
          <form action={addUsdtAccount} className="mt-3 grid gap-2 sm:grid-cols-3">
            <select name="network" className={input}>{["TRC20", "ERC20", "BEP20", "Polygon"].map((n) => <option key={n}>{n}</option>)}</select>
            <input name="address" placeholder="Wallet address" required className={`${input} sm:col-span-2`} />
            <button className="h-11 rounded-xl border border-line sm:col-span-3">Save wallet</button>
          </form>
          <p className="mt-2 text-xs text-muted">Double-check the network. Money sent on the wrong network is usually lost.</p>
        </details>
        <details className="mt-3"><summary className="cursor-pointer text-sm text-purple">Add a bank account</summary>
          <form action={addBankAccount} className="mt-3 grid gap-2 sm:grid-cols-3">
            <input name="bank" placeholder="Bank name" required className={input} />
            <input name="name" placeholder="Account name" required className={input} />
            <input name="number" placeholder="10-digit account number" inputMode="numeric" pattern="\d{10}" required className={input} />
            <button className="h-11 rounded-xl border border-line sm:col-span-3">Save bank account</button>
          </form>
        </details>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">Payout history</h2>
        <ul className="mt-3 grid gap-2">
          {(pays ?? []).map((p: { id: string; amount_kobo: number; status: string; reference: string | null; note: string | null; created_at: string }) => (
            <li key={p.id} className="rounded-xl border border-line bg-card p-3 text-sm">
              <span className="font-semibold">{naira(p.amount_kobo)}</span> · {p.status} · {new Date(p.created_at).toLocaleDateString("en-NG")}
              {p.status === "paid" && p.reference && <span className="text-muted"> · ref {p.reference}</span>}
              {p.status === "rejected" && p.note && <span className="text-rose"> · {p.note}</span>}
            </li>
          ))}
          {!pays?.length && <li className="text-sm text-muted">No payouts yet.</li>}
        </ul>
      </section>
    </main>
  );
}
