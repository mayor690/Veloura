"use client";
import { useState } from "react";
import Link from "next/link";

export function RecoveryCodePanel({ code }: { code: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="grid gap-4 text-center">
      <h2 className="font-display text-2xl">Save your recovery code</h2>
      <p className="text-sm text-muted">
        This is the only way back in if you forget your password. It is shown once and there is no email reset.
      </p>
      <code className="select-all rounded-xl border border-purple/40 bg-ink p-4 text-lg tracking-widest">{code}</code>
      <button type="button" onClick={() => navigator.clipboard.writeText(code)} className="h-11 rounded-xl border border-line">
        Copy code
      </button>
      <label className="flex items-center justify-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        I saved it somewhere safe
      </label>
      <Link
        aria-disabled={!saved}
        href={saved ? "/" : "#"}
        className={`grid h-12 place-items-center rounded-xl bg-accent-gradient font-semibold ${saved ? "" : "pointer-events-none opacity-40"}`}
      >
        Continue
      </Link>
    </div>
  );
}
