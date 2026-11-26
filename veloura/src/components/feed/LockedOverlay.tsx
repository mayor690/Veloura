"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { UnlockModal } from "@/components/payments/UnlockModal";
import { naira } from "@/lib/constants";

type Props = Omit<React.ComponentProps<typeof UnlockModal>, "open" | "onClose">;

export function LockedOverlay(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute inset-0 grid place-items-center bg-ink/50 backdrop-blur-[2px]"
      >
        <span className="flex items-center gap-2 rounded-full bg-accent-gradient px-4 py-2 text-sm font-semibold">
          <Lock size={14} /> Unlock for {naira(props.category?.price ?? props.dailyPrice)}
        </span>
      </button>
      <UnlockModal {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
