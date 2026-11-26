import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type BankSettings = {
  enabled: boolean; bankName: string; accountName: string; accountNumber: string;
  minKobo: number; maxKobo: number; expiryHours: number; maxPending: number;
};

/** Manual bank transfer settings. Server only: the account details are never sent to a browser until a request exists. */
export async function loadBankSettings(): Promise<BankSettings> {
  const { data } = await supabaseAdmin().from("site_settings").select("key,value").like("key", "bank_%");
  const m = new Map(((data ?? []) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => { const n = Number(m.get(k)); return Number.isFinite(n) && n > 0 ? n : d; };
  const str = (k: string) => (typeof m.get(k) === "string" ? String(m.get(k)) : "");
  return {
    enabled: m.get("bank_enabled") === true,
    bankName: str("bank_name"), accountName: str("bank_account_name"), accountNumber: str("bank_account_number"),
    minKobo: num("bank_min_kobo", 50000), maxKobo: num("bank_max_kobo", 5000000),
    expiryHours: num("bank_expiry_hours", 24), maxPending: num("bank_max_pending", 3),
  };
}

/** A bank transfer is only offered when it is switched on and the account details are complete. */
export const bankReady = (s: BankSettings) => s.enabled && !!s.bankName && !!s.accountName && /^\d{10}$/.test(s.accountNumber);
