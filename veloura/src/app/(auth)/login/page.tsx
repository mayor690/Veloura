"use client";
import { useActionState } from "react";
import Link from "next/link";
import { login } from "../actions";
import { Field } from "@/components/ui/Field";

export default function Login() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="grid gap-4">
      <h1 className="font-display text-3xl text-accent-gradient">Welcome back</h1>
      <Field label="Username" name="username" autoComplete="username" required />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      {state?.error && <p className="text-sm text-rose">{state.error}</p>}
      <button disabled={pending} className="h-12 rounded-xl bg-accent-gradient font-semibold disabled:opacity-60">
        {pending ? "Signing in" : "Log in"}
      </button>
      <div className="flex justify-between text-sm text-muted">
        <Link href="/register" className="text-purple">Create account</Link>
        <Link href="/recover">Forgot password?</Link>
      </div>
    </form>
  );
}
