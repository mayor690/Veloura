import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge, btn, inputCls } from "@/components/admin/ui";
import { naira, ago } from "@/lib/constants";
import { approveBankTransfer, creditFromBankAlert, rejectBankTransfer } from "./actions";

export const dynamic = "force-dynamic";

type T = {
  id: string; reference: string; amount_kobo: number; status: string; sender_note: string | null; created_at: string; submitted_at: string | null;
  expires_at: string; approved_amount_kobo: number | null; review_note: string | null; reviewed_at: string | null;
  profiles: { username: string } | null;
};
const SEL = "id,reference,amount_kobo,status,sender_note,created_at,submitted_at,expires_at,approved_amount_kobo,review_note,reviewed_at,profiles!bank_transfers_user_id_fkey(username)";
const MSG: Record<string, [string, boolean]> = {
  approved: ["Approved. The wallet was credited.", true], rejected: ["Rejected.", true], credited: ["Done. The reader's wallet was credited.", true],
  user_not_found: ["No reader with that username.", false], ambiguous_user: ["More than one account matches that username. Check the spelling and capitals.", false],
  bad_reference: ["Enter the reference from your bank alert (3 to 60 characters).", false],
  duplicate_reference: ["That bank reference was already used to credit a wallet. Check before crediting again.", false],
  not_open: ["That request was already handled.", false], bad_amount: ["Enter a valid amount.", false],
  banned: ["That account is banned, so it can't be credited.", false], failed: ["Something went wrong. Try again.", false],
};
const TONE: Record<string, "good" | "warn" | "danger" | "default" | "info"> = { approved: "good", submitted: "info", pending: "warn", rejected: "danger", expired: "default", cancelled: "default" };

export default async function BankTransfers({ searchParams }: { searchParams: Promise<{ e?: string; ok?: string }> }) {
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const admin = supabaseAdmin();
  await admin.rpc("expire_bank_transfers");
  const [{ data: openRows }, { data: doneRows }] = await Promise.all([
    admin.from("bank_transfers").select(SEL).in("status", ["submitted", "pending", "expired"]).order("submitted_at", { ascending: true, nullsFirst: false }).limit(100),
    admin.from("bank_transfers").select(SEL).in("status", ["approved", "rejected", "cancelled"]).order("created_at", { ascending: false }).limit(25),
  ]);
  const open = ((openRows ?? []) as unknown as T[]).sort((a, b) => Number(b.status === "submitted") - Number(a.status === "submitted"));
  const done = (doneRows ?? []) as unknown as T[];
  const msg = sp.e ? MSG[sp.e] ?? MSG.failed : sp.ok ? MSG[sp.ok] : null;

  return (
    <div className="grid gap-5">
      <h1 className="font-display text-3xl">Bank transfers</h1>
      <p className="rounded-xl border border-line bg-card p-4 text-sm text-muted">
        Credit or approve only after the money has actually arrived in your bank account. Never act on a screenshot or a message.
        Crediting adds to the reader&apos;s wallet once; you can change the amount if they sent more or less. &quot;Reader says paid&quot; means they asked for a reference and tapped I&apos;ve paid.
      </p>
      {msg && <p className={`rounded-xl p-3 text-sm ${msg[1] ? "bg-emerald-500/15 text-emerald-300" : "bg-rose/15 text-rose"}`}>{msg[0]}</p>}

      <section className="grid gap-3 rounded-2xl border border-purple/50 bg-card p-5 text-sm">
        <h2 className="font-semibold">Credit a reader from a bank alert</h2>
        <p className="text-xs text-muted">
          For a normal transfer or P2P payment where the reader never made a request here. Enter the reader&apos;s username (they should put it in the narration),
          the amount that reached your account, and the bank&apos;s own reference or session ID for that credit. The same reference can only be used once,
          so the same alert can never credit twice.
        </p>
        <form action={creditFromBankAlert} className="grid gap-2 sm:grid-cols-2">
          <input name="username" required maxLength={30} placeholder="Reader username" className={inputCls} />
          <input name="amount" type="number" step="0.01" min="1" required placeholder="Amount received (₦)" className={inputCls} />
          <input name="reference" required minLength={3} maxLength={60} placeholder="Bank reference / session ID from the alert" className={inputCls} />
          <input name="note" maxLength={200} placeholder="Note (optional)" className={inputCls} />
          <button className={`${btn} bg-emerald-600 sm:col-span-2`}>Credit wallet</button>
        </form>
      </section>

      <section className="grid gap-3">
        <h2 className="font-semibold">Open requests ({open.length})</h2>
        {open.map((t) => (
          <article key={t.id} className={`rounded-2xl border bg-card p-4 text-sm ${t.status === "submitted" ? "border-purple/60" : "border-line"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-semibold">{t.reference}</span>
              <Badge tone={TONE[t.status]}>{t.status === "submitted" ? "Reader says paid" : t.status === "pending" ? "Not marked paid" : "Expired (may still be paid)"}</Badge>
              <span className="text-xs text-muted">@{t.profiles?.username} · asked {naira(t.amount_kobo)} · {ago(t.submitted_at ?? t.created_at)} ago</span>
            </div>
            {t.sender_note && <p className="mt-2 text-xs text-muted">Sender name given: “{t.sender_note}”</p>}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <form action={approveBankTransfer} className="grid gap-2">
                <input type="hidden" name="id" value={t.id} />
                <label className="grid gap-1 text-xs text-muted">Amount received (₦)
                  <input name="amount" type="number" step="0.01" min="1" defaultValue={t.amount_kobo / 100} required className={inputCls} />
                </label>
                <input name="note" maxLength={200} placeholder="Note (optional)" className={inputCls} />
                <button className={`${btn} bg-emerald-600`}>Approve and credit wallet</button>
              </form>
              <form action={rejectBankTransfer} className="grid content-start gap-2">
                <input type="hidden" name="id" value={t.id} />
                <input name="note" maxLength={200} placeholder="Reason (optional)" className={inputCls} />
                <button className={`${btn} border border-rose text-rose`}>Reject</button>
              </form>
            </div>
          </article>
        ))}
        {!open.length && <p className="text-muted">Nothing waiting.</p>}
      </section>

      <section className="grid gap-3">
        <h2 className="font-semibold">Recently handled</h2>
        <ul className="grid gap-2 text-sm">
          {done.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-2">
              <span><span className="font-mono">{t.reference}</span> <span className="text-muted">@{t.profiles?.username}</span></span>
              <span className="flex items-center gap-2">
                {t.status === "approved" ? naira(t.approved_amount_kobo ?? t.amount_kobo) : naira(t.amount_kobo)}
                <Badge tone={TONE[t.status]}>{t.status}</Badge>
                {t.review_note && <span className="text-xs text-muted">{t.review_note}</span>}
              </span>
            </li>
          ))}
          {!done.length && <li className="text-muted">None yet.</li>}
        </ul>
      </section>
    </div>
  );
}
