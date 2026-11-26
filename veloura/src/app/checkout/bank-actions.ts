"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { bankReady, loadBankSettings } from "@/lib/payments/bank";

const KEYS = ["bank_off", "banned", "below_min", "above_max", "too_many_pending", "rate_limited", "not_open", "not_found", "try_again"];

function fail(message: string): never {
  const key = KEYS.find((k) => message.includes(k));
  if (!key) console.error("[bank] failed", message);
  redirect(`/checkout/bank?e=${key ?? "failed"}`);
}

async function userId(): Promise<string> {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) redirect("/login");
  return user.id;
}

export async function requestBankTransfer(fd: FormData): Promise<void> {
  const uid = await userId();
  if (!bankReady(await loadBankSettings())) redirect("/checkout/bank?e=bank_off");
  const naira = Number(fd.get("amount"));
  if (!Number.isFinite(naira) || naira <= 0) redirect("/checkout/bank?e=bad_amount");
  const { error } = await supabaseAdmin().rpc("request_bank_transfer", { p_user: uid, p_amount: Math.round(naira * 100) });
  if (error) fail(error.message);
  revalidatePath("/checkout/bank");
  redirect("/checkout/bank?ok=requested");
}

export async function markBankTransferPaid(fd: FormData): Promise<void> {
  const uid = await userId();
  const { error } = await supabaseAdmin().rpc("mark_bank_transfer_paid", {
    p_user: uid, p_id: String(fd.get("id") ?? ""), p_note: String(fd.get("note") ?? "").slice(0, 100),
  });
  if (error) fail(error.message);
  revalidatePath("/checkout/bank");
  redirect("/checkout/bank?ok=submitted");
}

export async function cancelBankTransfer(fd: FormData): Promise<void> {
  const uid = await userId();
  const { error } = await supabaseAdmin().rpc("cancel_bank_transfer", { p_user: uid, p_id: String(fd.get("id") ?? "") });
  if (error) fail(error.message);
  revalidatePath("/checkout/bank");
  redirect("/checkout/bank?ok=cancelled");
}
