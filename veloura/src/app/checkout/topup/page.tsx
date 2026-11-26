import Link from "next/link";
import { nowpayments } from "@/lib/payments/nowpayments";
import { loadFx } from "@/lib/payments/settings";
import { effectiveMinUsdCents, koboToUsdCentsCeil } from "@/lib/payments/fx";
import { TopupForm } from "@/components/payments/TopupForm";
import { bankReady, loadBankSettings } from "@/lib/payments/bank";

export default async function Topup() {
  const fx = await loadFx();
  const ready = nowpayments.configured() && !!fx && fx.cryptoEnabled;
  const bank = await loadBankSettings();
  const bankOn = bankReady(bank);

  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <Link href="/" className="font-display text-2xl text-accent-gradient">Veloura</Link>
      <h1 className="mt-6 font-display text-3xl">Top up wallet</h1>
      <p className="mt-1 text-sm text-muted">
        Pay once in USDT or USDC, then unlock categories from your balance with no network fees per unlock.
      </p>

      <div className="mt-6">
        {ready && fx ? (
          (() => {
            const min = effectiveMinUsdCents(fx);
            const presets = [100, 200, 500, 1000].filter((c) => c >= min && c <= fx.maxUsdCents);
            const passCents = koboToUsdCentsCeil(fx.fullPassKobo, fx.rate);
            return (
              <TopupForm
                rate={fx.rate}
                rateUpdated={fx.rateUpdatedAt}
                minCents={min}
                maxCents={fx.maxUsdCents}
                presets={presets.length ? presets : [min]}
                fullPass={{ usdCents: passCents, kobo: fx.fullPassKobo, eligible: passCents >= fx.minUsdCents }}
              />
            );
          })()
        ) : (
          <div className="rounded-2xl border border-line bg-card p-5 text-sm text-muted">
            Crypto top-ups are unavailable right now.{bankOn ? "" : " Please check back soon."}
          </div>
        )}
        {bankOn && (
          <Link href="/checkout/bank" className="mt-4 block rounded-2xl border border-line bg-card p-5 text-sm hover:border-purple">
            <span className="font-semibold">Pay by bank transfer</span>
            <span className="mt-1 block text-muted">Send Naira from your bank and we credit your wallet once it arrives.</span>
          </Link>
        )}
      </div>
    </main>
  );
}
