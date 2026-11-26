"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { encrypt, maskTail } from "@/lib/crypto-box";

const NETWORKS: Record<string, RegExp> = {
  TRC20: /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  ERC20: /^0x[a-fA-F0-9]{40}$/,
  BEP20: /^0x[a-fA-F0-9]{40}$/,
  Polygon: /^0x[a-fA-F0-9]{40}$/,
};
const back = (code: string): never => redirect(`/dashboard/earnings?e=${code}`);

async function userId() {
  const { data: { user } } = await createClient().then((s) => s.auth.getUser());
  if (!user) redirect("/login");
  return user.id;
}

export async function addUsdtAccount(fd: FormData): Promise<void> {
  const uid = await userId();
  const network = String(fd.get("network") ?? "");
  const address = String(fd.get("address") ?? "").trim();
  if (!NETWORKS[network] || !NETWORKS[network].test(address)) return back("bad_address");
  if (!process.env.PAYOUT_ENCRYPTION_KEY) return back("unavailable");
  const { error } = await supabaseAdmin().from("payout_accounts").insert({
    user_id: uid, type: "usdt", label: `USDT ${network} ${maskTail(address)}`,
    crypto_network: network, crypto_address_enc: encrypt(address),
  });
  back(error ? "failed" : "account_saved");
}

export async function addBankAccount(fd: FormData): Promise<void> {
  const uid = await userId();
  const bank = String(fd.get("bank") ?? "").trim().slice(0, 60);
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const number = String(fd.get("number") ?? "").trim();
  if (!bank || !name || !/^\d{10}$/.test(number)) return back("bad_bank");
  if (!process.env.PAYOUT_ENCRYPTION_KEY) return back("unavailable");
  const { error } = await supabaseAdmin().from("payout_accounts").insert({
    user_id: uid, type: "bank", label: `${bank} ${maskTail(number)}`,
    bank_name: bank, account_name: name, account_number_enc: encrypt(number),
  });
  back(error ? "failed" : "account_saved");
}

export async function requestPayout(fd: FormData): Promise<void> {
  const uid = await userId();
  const naira = Number(fd.get("amount"));
  if (!Number.isFinite(naira) || naira <= 0) return back("bad_amount");
  const { error } = await supabaseAdmin().rpc("request_payout", {
    p_user: uid, p_account: String(fd.get("account") ?? ""), p_amount: Math.round(naira * 100),
  });
  if (error) {
    const code = ["below_minimum", "insufficient_balance", "payout_in_progress", "invalid_account", "banned"].find((c) => error.message.includes(c));
    return back(code ?? "failed");
  }
  back("requested");
}
