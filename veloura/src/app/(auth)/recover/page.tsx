"use client";
import { useActionState } from "react";
import { recover } from "../actions";
import { Field } from "@/components/ui/Field";
import { RecoveryCodePanel } from "@/components/auth/RecoveryCodePanel";

export default function Recover() {
  const [state, action, pending] = useActionState(recover, undefined);
  if (state?.recoveryCode)
    return (
      <div className="grid gap-3">
        <p className="text-sm text-emerald-300">Password reset. Your old code no longer works; save this new one.</p>
        <RecoveryCodePanel code={state.recoveryCode} />
      </div>
    );
  return (
    <form action={action} className="grid gap-4">
      <h1 className="font-display text-3xl text-accent-gradient">Recover account</h1>
      <Field label="Username" name="username" required />
      <Field label="Recovery code" name="code" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" required />
      <Field label="New password" name="password" type="password" autoComplete="new-password" required />
      {state?.error && <p className="text-sm text-rose">{state.error}</p>}
      <button disabled={pending} className="h-12 rounded-xl bg-accent-gradient font-semibold disabled:opacity-60">
        {pending ? "Checking" : "Reset password"}
      </button>
    </form>
  );
}
