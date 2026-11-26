"use client";
import { useState, useTransition } from "react";
import { startCryptoCheckout } from "@/app/checkout/actions";
import { naira } from "@/lib/constants";
import { parseUsdInput, usd } from "@/lib/payments/fx";

type Props = {
  rate: number;
  rateUpdated: string | null;
  minCents: number;
  maxCents: number;
  presets: number[];
  fullPass: { usdCents: number; kobo: number; eligible: boolean };
};

export function TopupForm(p: Props) {
  const [cents, setCents] = useState<number | null>(p.presets[1] ?? p.presets[0] ?? p.minCents);
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const valid = cents !== null && cents >= p.minCents && cents <= p.maxCents;
  const credit = cents ? Math.round(cents * p.rate) : 0;

  const go = (input: Parameters<typeof startCryptoCheckout>[0]) =>
    start(async () => {
      setErr(null);
      const r = await startCryptoCheckout(input);
      if ("url" in r) window.location.assign(r.url);
      else setErr(r.error);
    });

  return (
    <div className="grid gap-6">
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Choose an amount</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {p.presets.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => { setCents(c); setCustom(""); }}
              className={`h-12 rounded-xl border text-sm font-medium ${
                cents === c && !custom ? "border-purple bg-purple/15" : "border-line"
              }`}
            >
              {usd(c)}
            </button>
          ))}
        </div>

        <label className="mt-3 grid gap-1.5 text-sm">
          <span className="text-muted">Or enter an amount in USD</span>
          <input
            inputMode="decimal"
            value={custom}
            onChange={(e) => { setCustom(e.target.value); setCents(parseUsdInput(e.target.value)); }}
            placeholder={`${(p.minCents / 100).toFixed(2)} to ${(p.maxCents / 100).toFixed(0)}`}
            className="h-12 rounded-xl border border-line bg-ink px-4 outline-none focus:border-purple"
          />
        </label>

        <div className="mt-4 rounded-xl bg-ink p-4 text-sm">
          {valid ? (
            <>
              <p>You pay <b>{usd(cents!)}</b> in USDT or USDC.</p>
              <p className="mt-1 text-muted">
                Wallet credit: <b className="text-white">{naira(credit)}</b> at ₦{p.rate.toLocaleString("en-NG")} per $1.
                The rate is locked when you start the payment.
              </p>
            </>
          ) : (
            <p className="text-rose">Enter between {usd(p.minCents)} and {usd(p.maxCents)}.</p>
          )}
        </div>

        <button
          disabled={!valid || pending}
          onClick={() => go({ kind: "topup", usdCents: cents! })}
          className="mt-4 h-12 w-full rounded-xl bg-accent-gradient font-semibold disabled:opacity-40"
        >
          {pending ? "Opening payment page" : valid ? `Pay ${usd(cents!)} with crypto` : "Pay with crypto"}
        </button>
        {err && <p className="mt-3 text-sm text-rose">{err}</p>}
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Pay for the Full Pass directly</h2>
        {p.fullPass.eligible ? (
          <>
            <p className="mt-1 text-sm text-muted">
              {naira(p.fullPass.kobo)} is about {usd(p.fullPass.usdCents)}. Unlocks every category for 24 hours once confirmed.
            </p>
            <button
              disabled={pending}
              onClick={() => go({ kind: "full_pass" })}
              className="mt-3 h-12 w-full rounded-xl border border-purple/50 font-semibold disabled:opacity-40"
            >
              Pay {usd(p.fullPass.usdCents)} for the Full Pass
            </button>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">
            At today&apos;s rate the Full Pass is about {usd(p.fullPass.usdCents)}, below the {usd(p.minCents)} minimum for a
            single crypto payment. Top up your wallet above, then buy the pass from your balance.
          </p>
        )}
      </section>

      {p.rateUpdated && (
        <p className="text-center text-xs text-muted">
          Exchange rate updated {new Date(p.rateUpdated).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" })}.
        </p>
      )}
    </div>
  );
}
