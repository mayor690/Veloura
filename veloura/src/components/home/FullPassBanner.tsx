"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import { UnlockModal } from "@/components/payments/UnlockModal";
import { naira } from "@/lib/constants";

type Props = {
  price: number;
  expires: string | null;
  loggedIn: boolean;
  balanceKobo: number;
  minTopup: number;
  dailyPrice: number;
};

export function FullPassBanner(p: Props) {
  const [open, setOpen] = useState(false);
  const active = !!p.expires;
  return (
    <>
      <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-purple/30 bg-gradient-to-r from-purple/20 to-rose/20 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="text-rose" />
          <div>
            <p className="font-semibold">Full Daily Pass</p>
            <p className="text-sm text-muted">All 7 categories for 24 hours, {naira(p.price)}</p>
          </div>
        </div>
        <button
          disabled={active}
          onClick={() => setOpen(true)}
          className="h-11 rounded-xl bg-accent-gradient px-6 font-semibold disabled:opacity-50"
        >
          {active ? "Pass active" : "Get Full Pass"}
        </button>
      </div>
      <UnlockModal
        open={open}
        onClose={() => setOpen(false)}
        loggedIn={p.loggedIn}
        fullPassPrice={p.price}
        dailyPrice={p.dailyPrice}
        balanceKobo={p.balanceKobo}
        minTopup={p.minTopup}
      />
    </>
  );
}
