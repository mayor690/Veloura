"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { naira } from "@/lib/constants";
import { unlockWithWallet } from "@/app/(public)/actions";

type Props = {
  open: boolean;
  onClose: () => void;
  loggedIn: boolean;
  category?: { id: string; name: string; price: number };
  dailyPrice: number;
  fullPassPrice: number;
  balanceKobo: number;
  minTopup: number;
};

export function UnlockModal(p: Props) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (!p.open) return null;

  const run = (kind: "category" | "full_pass") =>
    start(async () => {
      const r = await unlockWithWallet(kind, p.category?.id);
      if ("ok" in r) return p.onClose();
      setMsg(
        r.error === "insufficient"
          ? "Not enough balance. Top up to continue."
          : r.error === "already"
          ? "You already have access."
          : "Something went wrong. Try again."
      );
    });

  const short = (price: number) => p.balanceKobo < price;

  return (
    <div className="fixed inset-0 z-50 grid items-end bg-black/70 backdrop-blur-sm md:place-items-center" onClick={p.onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="safe-bottom w-full rounded-t-3xl border border-line bg-card p-6 md:max-w-md md:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl">Unlock access</h2>
          <button onClick={p.onClose} aria-label="Close"><X /></button>
        </div>

        {!p.loggedIn ? (
          <div className="mt-6 grid gap-3">
            <p className="text-sm text-muted">Create an anonymous account, top up your wallet, then unlock.</p>
            <Link href="/register" className="grid h-12 place-items-center rounded-xl bg-accent-gradient font-semibold">
              Join anonymously
            </Link>
            <Link href="/login" className="grid h-12 place-items-center rounded-xl border border-line">Log in</Link>
          </div>
        ) : (
          <div className="mt-5 grid gap-3">
            <p className="text-sm text-muted">
              Wallet balance: <b className="text-white">{naira(p.balanceKobo)}</b>
            </p>

            {p.category && (
              <button
                disabled={pending || short(p.category.price)}
                onClick={() => run("category")}
                className="flex h-14 items-center justify-between rounded-xl bg-accent-gradient px-4 font-semibold disabled:opacity-40"
              >
                <span>{p.category.name}</span>
                <span>{naira(p.category.price)} for 24h</span>
              </button>
            )}
            <button
              disabled={pending || short(p.fullPassPrice)}
              onClick={() => run("full_pass")}
              className="flex h-14 items-center justify-between rounded-xl border border-purple/50 px-4 font-semibold disabled:opacity-40"
            >
              <span>Full Pass (all categories)</span>
              <span>{naira(p.fullPassPrice)} for 24h</span>
            </button>

            {msg && <p className="text-sm text-rose">{msg}</p>}
            <Link href="/checkout/topup" className="mt-1 text-center text-sm text-purple underline">
              Top up wallet with crypto (minimum {naira(p.minTopup)})
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
