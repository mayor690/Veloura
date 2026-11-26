import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bankReady, loadBankSettings } from "@/lib/payments/bank";
import { naira } from "@/lib/constants";
import { cancelBankTransfer, markBankTransferPaid, requestBankTransfer } from "../bank-actions";

export const dynamic = "force-dynamic";

const MSG: Record<string, [string, boolean]> = {
  requested: ["Request created. Pay with the details below, then tap I've paid.", true],
  submitted: ["Thanks. We'll credit your wallet once the payment shows in our account.", true],
  cancelled: ["Request cancelled.", true],
  bank_off: ["Bank transfer top-ups are unavailable right now.", false],
  banned: ["Your account cannot make payments.", false],
  below_min: ["That is below the minimum amount.", false],
  above_max: ["That is above the maximum amount.", false],
  bad_amount: ["Enter a valid amount.", false],
  too_many_pending: ["You already have the maximum number of open requests. Finish or cancel one first.", false],
  rate_limited: ["Too many requests today. Please try again tomorrow.", false],
  not_open: ["That request is no longer open.", false],
  not_found: ["We couldn't find that request.", false],
  failed: ["Something went wrong. Try again.", false],
};
const STATUS: Record<string, string> = {
  pending: "Waiting for your payment", submitted: "Waiting for us to confirm", approved: "Credited",
  rejected: "Not accepted", expired: "Expired", cancelled: "Cancelled",
};
const input = "h-12 rounded-xl border border-line bg-ink px-4 text-white outline-none focus:border-purple";

type T = { id: string; reference: string; amount_kobo: number; status: string; expires_at: string; created_at: string; approved_amount_kobo: number | null; review_note: string | null };

export default async function BankTopup({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  const s = await loadBankSettings();
  const ready = bankReady(s);
  const admin = supabaseAdmin();
  await admin.rpc("expire_bank_transfers");
  const { data } = await admin.from("bank_transfers")
    .select("id,reference,amount_kobo,status,expires_at,created_at,approved_amount_kobo,review_note")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(10);
  const rows = (data ?? []) as T[];
  const { data: me } = await admin.from("profiles").select("username").eq("id", user.id).single();
  const username = me?.username ?? "";
  const open = rows.filter((r) => r.status === "pending" || r.status === "submitted");
  const past = rows.filter((r) => !open.includes(r));
  const msg = sp.e ? MSG[sp.e] ?? MSG.failed : sp.ok ? MSG[sp.ok] : null;

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/checkout/topup" className="text-sm text-muted">&larr; Top up</Link>
      <h1 className="mt-3 font-display text-3xl">Pay by bank transfer</h1>
      <p className="mt-1 text-sm text-muted">Send a transfer from your bank, then tell us. We add the money to your wallet after we see it in our account, usually within a few hours.</p>
      {msg && <p className={`mt-4 text-sm ${msg[1] ? "text-emerald-300" : "text-rose"}`}>{msg[0]}</p>}

      {!ready ? (
        <div className="mt-6 rounded-2xl border border-line bg-card p-5 text-sm text-muted">Bank transfer top-ups are unavailable right now. Please check back soon.</div>
      ) : (
        <>
          <section className="mt-6 grid gap-3 rounded-2xl border border-line bg-card p-5 text-sm">
            <h2 className="font-semibold">Send a transfer</h2>
            <dl className="grid gap-1.5">
              <div className="flex justify-between gap-3"><dt className="text-muted">Bank</dt><dd>{s.bankName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Account name</dt><dd>{s.accountName}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Account number</dt><dd className="font-mono">{s.accountNumber}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Narration / remark</dt><dd className="font-mono font-semibold">{username}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted">Amount</dt><dd>{naira(s.minKobo)} to {naira(s.maxKobo)}</dd></div>
            </dl>
            <p className="text-xs text-muted">Put your username <span className="font-mono">{username}</span> in the narration so we know whose wallet to credit. We add the money after we see it in our account, usually within a few hours. Bank and P2P transfers both work.</p>
          </section>

          {open.map((t) => (
            <section key={t.id} className="mt-6 grid gap-3 rounded-2xl border border-purple/60 bg-card p-5 text-sm">
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold">{naira(t.amount_kobo)}</p>
                <span className="rounded-full bg-purple/15 px-2.5 py-1 text-xs text-purple">{STATUS[t.status]}</span>
              </div>
              <dl className="grid gap-1.5">
                <div className="flex justify-between gap-3"><dt className="text-muted">Bank</dt><dd>{s.bankName}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Account name</dt><dd>{s.accountName}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Account number</dt><dd className="font-mono">{s.accountNumber}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Amount to send</dt><dd>{naira(t.amount_kobo)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Reference (put in the narration)</dt><dd className="font-mono font-semibold">{t.reference}</dd></div>
              </dl>
              <p className="text-xs text-muted">
                Send exactly {naira(t.amount_kobo)} and include the reference so we can match it.
                {t.status === "pending" && ` Please pay before ${new Date(t.expires_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}.`}
              </p>
              {t.status === "pending" && (
                <form action={markBankTransferPaid} className="grid gap-2">
                  <input type="hidden" name="id" value={t.id} />
                  <input name="note" maxLength={100} placeholder="Name on the sending account (optional)" className={input} />
                  <button className="h-12 rounded-xl bg-accent-gradient font-semibold">I&apos;ve paid</button>
                </form>
              )}
              {t.status === "pending" && (
                <form action={cancelBankTransfer}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-muted underline">Cancel this request</button></form>
              )}
            </section>
          ))}

          {open.length < s.maxPending && (
            <form action={requestBankTransfer} className="mt-6 grid gap-3 rounded-2xl border border-line bg-card p-5">
              <h2 className="font-semibold">Want a unique reference? (optional)</h2>
              <input name="amount" type="number" step="1" min={s.minKobo / 100} max={s.maxKobo / 100} required placeholder={`Amount in ₦ (${naira(s.minKobo)} to ${naira(s.maxKobo)})`} className={input} />
              <button className="h-12 rounded-xl bg-accent-gradient font-semibold">Get a reference</button>
              <p className="text-xs text-muted">Your bank statement will show your name to us. We keep it private and use it only to match your payment.</p>
            </form>
          )}
        </>
      )}

      {past.length > 0 && (
        <section className="mt-6 rounded-2xl border border-line bg-card p-5">
          <h2 className="font-semibold">Recent requests</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {past.map((t) => (
              <li key={t.id} className="flex justify-between gap-3">
                <span className="text-muted">{new Date(t.created_at).toLocaleDateString("en-NG")} · <span className="font-mono">{t.reference}</span></span>
                <span>{t.status === "approved" ? naira(t.approved_amount_kobo ?? t.amount_kobo) : naira(t.amount_kobo)} · {STATUS[t.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
