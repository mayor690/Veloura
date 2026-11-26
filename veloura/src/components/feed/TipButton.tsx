"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gift, X } from "lucide-react";
import { naira } from "@/lib/constants";
import { sendTip } from "@/app/(public)/tip-actions";

const PRESETS_NAIRA = [200, 500, 1000, 2000, 5000];

type Props = { postId: string; balanceKobo: number; minKobo: number; maxKobo: number; feePct: number };

export function TipButton({ postId, balanceKobo, minKobo, maxKobo, feePct }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string; topUp?: boolean } | null>(null);
  const [pending, start] = useTransition();

  const value = Number(amount);
  const kobo = Math.round(value * 100);
  const valid = Number.isFinite(value) && value > 0 && kobo >= minKobo && kobo <= maxKobo;
  const presets = PRESETS_NAIRA.filter((n) => n * 100 >= minKobo && n * 100 <= maxKobo);

  const submit = () =>
    start(async () => {
      const r = await sendTip(postId, value);
      if ("ok" in r) { setMsg({ ok: true, text: "Tip sent. Thank you for supporting this creator." }); setAmount(""); router.refresh(); }
      else setMsg({ ok: false, text: r.error, topUp: r.topUp });
    });

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setMsg(null); }}
        className="flex h-10 items-center gap-1.5 rounded-full border border-line px-4 text-sm hover:border-purple">
        <Gift size={16} /> Tip
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid items-end bg-black/70 backdrop-blur-sm md:place-items-center" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="safe-bottom max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-card p-6 md:max-w-md md:rounded-3xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Tip this creator</h2>
              <button onClick={() => setOpen(false)} aria-label="Close"><X /></button>
            </div>
            <p className="mt-2 text-sm text-muted">Tips come from your wallet ({naira(balanceKobo)}) and are anonymous. The creator receives {100 - feePct}% of your tip.</p>

            {msg?.ok ? (
              <p className="mt-5 text-sm text-emerald-300">{msg.text}</p>
            ) : (
              <div className="mt-4 grid gap-3">
                <div className="flex flex-wrap gap-2">
                  {presets.map((n) => (
                    <button key={n} type="button" onClick={() => setAmount(String(n))}
                      className={`h-10 rounded-full border px-4 text-sm ${Number(amount) === n ? "border-purple bg-purple/20" : "border-line"}`}>{naira(n * 100)}</button>
                  ))}
                </div>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" type="number" min={minKobo / 100} max={maxKobo / 100} step="any"
                  placeholder={`Amount in ₦ (${naira(minKobo)} to ${naira(maxKobo)})`}
                  className="h-12 rounded-xl border border-line bg-ink px-4 text-white outline-none focus:border-purple" />
                {msg && <p className="text-sm text-rose">{msg.text}</p>}
                {msg?.topUp && <Link href="/checkout/topup" className="text-sm text-purple underline">Top up your wallet</Link>}
                <button disabled={!valid || pending} onClick={submit} className="h-12 rounded-xl bg-accent-gradient font-semibold disabled:opacity-40">
                  {pending ? "Sending" : valid ? `Send ${naira(kobo)}` : "Send tip"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
