"use client";
import { useActionState } from "react";
import Link from "next/link";
import { register } from "../actions";
import { Field } from "@/components/ui/Field";
import { RecoveryCodePanel } from "@/components/auth/RecoveryCodePanel";

const GENDERS = [
  ["male", "Male"],
  ["female", "Female"],
  ["other", "Other"],
  ["prefer_not_to_say", "Prefer not to say"],
];

export default function Register() {
  const [state, action, pending] = useActionState(register, undefined);
  if (state?.recoveryCode) return <RecoveryCodePanel code={state.recoveryCode} />;

  return (
    <form action={action} className="grid gap-4">
      <h1 className="font-display text-3xl text-accent-gradient">Join anonymously</h1>
      <p className="text-sm text-muted">No email. No phone. Just a username.</p>
      <Field label="Username" name="username" autoComplete="username" required />
      <Field label="Password" name="password" type="password" autoComplete="new-password" required />
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm text-muted">Gender</legend>
        <div className="grid grid-cols-2 gap-2">
          {GENDERS.map(([v, l]) => (
            <label
              key={v}
              className="cursor-pointer rounded-xl border border-line px-3 py-2.5 text-center text-sm has-[:checked]:border-purple has-[:checked]:bg-purple/15"
            >
              <input type="radio" name="gender" value={v} defaultChecked={v === "prefer_not_to_say"} className="sr-only" />
              {l}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" name="age18" required /> I am 18 or older
      </label>
      <label className="flex gap-2 text-sm">
        <input type="checkbox" name="terms" required />
        <span>
          I accept the <Link href="/terms" className="underline">Terms</Link> and{" "}
          <Link href="/content-policy" className="underline">Content Policy</Link>
        </span>
      </label>
      {state?.error && <p className="text-sm text-rose">{state.error}</p>}
      <button disabled={pending} className="h-12 rounded-xl bg-accent-gradient font-semibold disabled:opacity-60">
        {pending ? "Creating account" : "Create account"}
      </button>
      <p className="text-center text-sm text-muted">
        Have an account? <Link href="/login" className="text-purple">Log in</Link>
      </p>
    </form>
  );
}
