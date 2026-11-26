"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Props = { reference: string; initialStatus: string; initialProviderStatus: string | null; invoiceUrl: string | null };

const TERMINAL = ["succeeded", "failed", "expired", "refunded"];

export function PaymentStatus(p: Props) {
  const router = useRouter();
  const [status, setStatus] = useState(p.initialStatus);
  const [providerStatus, setProviderStatus] = useState(p.initialProviderStatus);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (TERMINAL.includes(status)) return;
    const started = Date.now();
    const id = setInterval(async () => {
      if (Date.now() - started > 15 * 60_000) { setGaveUp(true); clearInterval(id); return; }
      try {
        const r = await fetch(`/api/payments/status?reference=${encodeURIComponent(p.reference)}`, { cache: "no-store" });
        if (!r.ok) return;
        const j = (await r.json()) as { status: string; provider_status: string | null };
        setProviderStatus(j.provider_status);
        if (j.status !== status) { setStatus(j.status); if (j.status === "succeeded") router.refresh(); }
      } catch { /* keep polling */ }
    }, 5000);
    return () => clearInterval(id);
  }, [status, p.reference, router]);

  const detail =
    status === "succeeded" ? { title: "Payment confirmed", body: "Your wallet or pass has been updated.", tone: "text-emerald-300" }
    : status === "failed" ? { title: "Payment failed", body: "Nothing was charged to your wallet. You can try again.", tone: "text-rose" }
    : status === "expired" ? { title: "Payment expired", body: "The payment window closed before funds arrived. Start a new payment.", tone: "text-rose" }
    : status === "refunded" ? { title: "Payment refunded", body: "This payment was refunded.", tone: "text-muted" }
    : providerStatus === "partially_paid" ? { title: "Partial payment received", body: "We received less than the invoice total. It has not been credited. Contact support with your reference.", tone: "text-rose" }
    : providerStatus === "confirming" || providerStatus === "confirmed" || providerStatus === "sending"
      ? { title: "Payment detected", body: "Waiting for network confirmations. This usually takes a few minutes.", tone: "text-purple" }
    : { title: "Waiting for your payment", body: "Send the exact amount on the payment page. This page updates by itself.", tone: "text-purple" };

  return (
    <div className="rounded-2xl border border-line bg-card p-6 text-center">
      <h2 className={`font-display text-2xl ${detail.tone}`}>{detail.title}</h2>
      <p className="mt-2 text-sm text-muted">{detail.body}</p>
      {!TERMINAL.includes(status) && p.invoiceUrl && (
        <a href={p.invoiceUrl} className="mt-5 grid h-12 place-items-center rounded-xl border border-purple/50 font-semibold">
          Open payment page
        </a>
      )}
      {gaveUp && <p className="mt-3 text-xs text-muted">Still pending. Leave this page open or come back later; your credit arrives once confirmed.</p>}
      <Link href="/" className="mt-5 inline-block text-sm text-purple underline">Back to categories</Link>
      <p className="mt-4 break-all text-xs text-muted">Reference: {p.reference}</p>
    </div>
  );
}
