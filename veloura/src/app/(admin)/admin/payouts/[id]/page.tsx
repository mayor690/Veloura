import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { decrypt } from "@/lib/crypto-box";
import { audit } from "@/lib/admin/audit";
import { loadFx } from "@/lib/payments/settings";
import { Badge, btn, inputCls } from "@/components/admin/ui";
import { naira } from "@/lib/constants";
import { processPayout } from "../actions";

const ERRORS: Record<string, string> = {
  reference_required: "Enter the transfer reference or transaction hash.",
  note_required: "A note is required when rejecting.",
  invalid_state: "This payout was already processed.",
  failed: "Something went wrong.",
};

type Payout = { id: string; amount_kobo: number; status: string; reference: string | null; note: string | null; created_at: string; account_id: string; profiles: { username: string } | null };
type Account = { type: string; label: string; bank_name: string | null; account_name: string | null; account_number_enc: string | null; crypto_network: string | null; crypto_address_enc: string | null };

export default async function PayoutDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const staff = await requireAdmin();
  if (!staff) notFound();
  const { id } = await params;
  const { e } = await searchParams;
  const admin = supabaseAdmin();

  const { data: p } = await admin.from("payouts")
    .select("id,amount_kobo,status,reference,note,created_at,account_id,profiles!payouts_creator_id_fkey(username)").eq("id", id).single();
  if (!p) notFound();
  const payout = p as unknown as Payout;
  const { data: a } = await admin.from("payout_accounts")
    .select("type,label,bank_name,account_name,account_number_enc,crypto_network,crypto_address_enc").eq("id", payout.account_id).single();
  const acct = a as Account | null;

  let destination = "Could not decrypt (check PAYOUT_ENCRYPTION_KEY).";
  try {
    if (acct?.type === "usdt" && acct.crypto_address_enc) destination = decrypt(acct.crypto_address_enc);
    if (acct?.type === "bank" && acct.account_number_enc) destination = decrypt(acct.account_number_enc);
  } catch { /* keep message */ }
  await audit(staff.id, "payout.reveal", "payout", id); // every view of decrypted details is logged

  const fx = await loadFx();
  const open = payout.status === "requested" || payout.status === "approved";

  return (
    <div className="grid max-w-xl gap-4">
      <Link href="/admin/payouts" className="text-sm text-muted">&larr; Payouts</Link>
      <h1 className="font-display text-3xl">Payout {naira(payout.amount_kobo)}</h1>
      <div className="rounded-2xl border border-line bg-card p-4 text-sm">
        <p><Badge>{payout.status}</Badge> <span className="ml-2">@{payout.profiles?.username}</span></p>
        {acct?.type === "usdt" ? (
          <>
            <p className="mt-3 text-muted">USDT on {acct.crypto_network}</p>
            <p className="mt-1 break-all font-mono text-base">{destination}</p>
            {fx && <p className="mt-2 text-xs text-muted">≈ ${(payout.amount_kobo / fx.rate / 100).toFixed(2)} at ₦{fx.rate} per $1. Confirm the network before sending; wrong-network transfers usually can&apos;t be recovered.</p>}
          </>
        ) : (
          <>
            <p className="mt-3 text-muted">Bank transfer</p>
            <p className="mt-1">{acct?.bank_name} · {acct?.account_name}</p>
            <p className="font-mono text-base">{destination}</p>
          </>
        )}
        {payout.reference && <p className="mt-3 text-xs text-muted">Reference: {payout.reference}</p>}
        {payout.note && <p className="mt-1 text-xs text-muted">Note: {payout.note}</p>}
      </div>

      {e && <p className="text-sm text-rose">{ERRORS[e] ?? ERRORS.failed}</p>}
      {open && (
        <div className="grid gap-3">
          {payout.status === "requested" && (
            <form action={processPayout}><input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="approve" />
              <button className={`${btn} w-full border border-line`}>Mark as approved (processing)</button></form>
          )}
          <form action={processPayout} className="grid gap-2 rounded-2xl border border-line bg-card p-4">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="paid" />
            <input name="reference" placeholder="Transfer reference or tx hash (required)" required className={inputCls} />
            <input name="note" placeholder="Note (optional)" className={inputCls} />
            <button className={`${btn} bg-emerald-600`}>I sent the money: mark paid</button>
          </form>
          <form action={processPayout} className="grid gap-2 rounded-2xl border border-line bg-card p-4">
            <input type="hidden" name="id" value={id} /><input type="hidden" name="action" value="reject" />
            <input name="note" placeholder="Reason shown to the creator (required)" required className={inputCls} />
            <button className={`${btn} border border-rose text-rose`}>Reject and return the funds</button>
          </form>
        </div>
      )}
    </div>
  );
}
