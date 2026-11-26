import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { Fx } from "./fx";

export type FxSettings = Fx & { cryptoEnabled: boolean; fullPassKobo: number };

/** Authoritative read (service role). Returns null if the exchange rate is missing or invalid. */
export async function loadFx(): Promise<FxSettings | null> {
  const { data } = await supabaseAdmin().from("site_settings").select("key,value,updated_at");
  const rows = (data ?? []) as { key: string; value: unknown; updated_at: string | null }[];
  const row = (k: string) => rows.find((r) => r.key === k);
  const num = (k: string) => Number(row(k)?.value);

  const rate = num("usd_ngn_rate");
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const pos = (n: number, fallback: number) => (Number.isFinite(n) && n > 0 ? n : fallback);
  return {
    rate,
    rateUpdatedAt: row("usd_ngn_rate")?.updated_at ?? null,
    minUsdCents: pos(num("min_topup_usd_cents"), 100),
    maxUsdCents: pos(num("max_topup_usd_cents"), 20000),
    minTopupKobo: pos(num("min_topup_kobo"), 50000),
    fullPassKobo: pos(num("full_pass_price_kobo"), 28000),
    cryptoEnabled: row("crypto_enabled")?.value !== false,
  };
}
