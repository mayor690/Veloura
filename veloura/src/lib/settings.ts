import { createClient } from "@/lib/supabase/server";

export async function getPublicSettings() {
  const supabase = await createClient();
  const { data } = await supabase.from("site_settings").select("key,value");
  const m: Record<string, unknown> = Object.fromEntries(
    (data ?? []).map((r: { key: string; value: unknown }) => [r.key, r.value])
  );
  const rate = Number(m.usd_ngn_rate);
  const minUsdCents = Number(m.min_topup_usd_cents ?? 100);
  const minKobo = Number(m.min_topup_kobo ?? 50000);
  const usdFloorKobo = Number.isFinite(rate) && rate > 0 ? Math.round(minUsdCents * rate) : 0;
  return {
    dailyPrice: Number(m.daily_price_kobo ?? 11200),
    fullPassPrice: Number(m.full_pass_price_kobo ?? 28000),
    minTopup: Math.max(minKobo, usdFloorKobo),
    adsEnabled: m.ads_enabled === true,
    maintenance: m.maintenance_mode === true,
  };
}
