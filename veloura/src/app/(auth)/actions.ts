"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { toEmail, newRecoveryCode, hashRecovery } from "@/lib/auth";
import { rateWait, recordAttempt, waitMessage } from "@/lib/rate-limit";
import { registerSchema, loginSchema, recoverSchema } from "@/validations/auth";

type State = { error?: string; recoveryCode?: string } | undefined;

export async function register(_: State, fd: FormData): Promise<State> {
  const parsed = registerSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { username, password, gender } = parsed.data;

  const wait = await rateWait("register", username);
  if (wait) return { error: waitMessage(wait) };

  const admin = supabaseAdmin();
  const { data: s } = await admin.from("site_settings").select("value").eq("key", "signups_enabled").single();
  if (s?.value === false) return { error: "Sign-ups are paused. Try again later." };

  const { data: created, error } = await admin.auth.admin.createUser({ email: toEmail(username), password, email_confirm: true });
  if (error || !created.user) {
    await recordAttempt("register", username, false);
    return { error: error?.message.includes("already") ? "That username is taken" : "Could not create your account" };
  }

  const code = newRecoveryCode();
  const now = new Date().toISOString();
  const { error: pErr } = await admin.from("profiles").insert({
    id: created.user.id, username, gender, recovery_hash: hashRecovery(code), age_confirmed_at: now, terms_accepted_at: now,
  });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    await recordAttempt("register", username, false);
    return { error: "That username is taken" };
  }

  const supabase = await createClient();
  await supabase.auth.signInWithPassword({ email: toEmail(username), password });
  await recordAttempt("register", username, true);
  return { recoveryCode: code };
}

export async function login(_: State, fd: FormData): Promise<State> {
  const parsed = loginSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Enter your username and password" };
  const { username, password } = parsed.data;

  const wait = await rateWait("login", username);
  if (wait) return { error: waitMessage(wait) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: toEmail(username), password });
  if (error) {
    await recordAttempt("login", username, false);
    return { error: "Wrong username or password" }; // same message whether or not the username exists
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: prof } = await supabaseAdmin().from("profiles").select("is_banned").eq("id", user.id).single();
    if (prof?.is_banned) {
      await supabase.auth.signOut();
      return { error: "This account has been suspended." };
    }
  }
  await recordAttempt("login", username, true); // clears earlier failures for this username on this device
  redirect("/dashboard");
}

export async function recover(_: State, fd: FormData): Promise<State> {
  const parsed = recoverSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return { error: "Check your details and try again" };
  const { username, code, password } = parsed.data;

  const wait = await rateWait("recover", username);
  if (wait) return { error: waitMessage(wait) };

  const admin = supabaseAdmin();
  const { data: p } = await admin.from("profiles").select("id, recovery_hash").eq("username", username).single();
  if (!p || p.recovery_hash !== hashRecovery(code)) {
    await recordAttempt("recover", username, false);
    return { error: "Invalid username or recovery code" };
  }

  await admin.auth.admin.updateUserById(p.id, { password });
  const fresh = newRecoveryCode();
  await admin.from("profiles").update({ recovery_hash: hashRecovery(fresh) }).eq("id", p.id);
  await recordAttempt("recover", username, true);
  return { recoveryCode: fresh };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
