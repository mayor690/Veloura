"use server";
import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { nowpayments } from "@/lib/payments/nowpayments";
import { loadFx } from "@/lib/payments/settings";
import { effectiveMinUsdCents, koboToUsdCentsCeil, usd, usdCentsToKobo } from "@/lib/payments/fx";

type Input = { kind: "topup"; usdCents: number } | { kind: "full_pass" };
type Result = { url: string } | { error: string };

export async function startCryptoCheckout(input: Input): Promise<Result> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: prof } = await supabaseAdmin().from("profiles").select("is_banned").eq("id", user.id).single();
  if (!prof || prof.is_banned) return { error: "Your account cannot make payments." };

  if (!nowpayments.configured()) {
    console.error("[crypto] NOWPAYMENTS_API_KEY / NOWPAYMENTS_IPN_SECRET / NEXT_PUBLIC_SITE_URL not set");
    return { error: "Crypto payments are unavailable right now. Try again later." };
  }
  const fx = await loadFx();
  if (!fx) {
    console.error("[crypto] site_settings.usd_ngn_rate is missing or invalid");
    return { error: "Crypto payments are unavailable right now. Try again later." };
  }
  if (!fx.cryptoEnabled) return { error: "Crypto payments are switched off at the moment." };

  let usdCents: number;
  let kobo: number;
  if (input.kind === "topup") {
    usdCents = Math.round(Number(input.usdCents));
    const min = effectiveMinUsdCents(fx);
    if (!Number.isInteger(usdCents) || usdCents < min) return { error: `The minimum top-up is ${usd(min)}.` };
    if (usdCents > fx.maxUsdCents) return { error: `The maximum top-up is ${usd(fx.maxUsdCents)}.` };
    kobo = usdCentsToKobo(usdCents, fx.rate);
  } else {
    kobo = fx.fullPassKobo;
    usdCents = koboToUsdCentsCeil(kobo, fx.rate);
    if (usdCents < fx.minUsdCents) {
      return { error: "The Full Pass is too small to pay directly in crypto. Top up your wallet instead." };
    }
  }

  const admin = supabaseAdmin();

  // Simple abuse guard: at most 5 unpaid crypto invoices per user per hour.
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("provider", "nowpayments")
    .eq("status", "pending")
    .gte("created_at", since);
  if ((count ?? 0) >= 5) return { error: "Too many unpaid payments. Finish or wait for the earlier ones to expire." };

  const reference = `np_${randomUUID().replace(/-/g, "")}`;
  const { data: pay, error: insErr } = await admin
    .from("payments")
    .insert({
      user_id: user.id,
      reference,
      provider: "nowpayments",
      method: "crypto",
      amount_kobo: kobo,          // what gets credited / what the pass is worth, in NGN
      currency: "NGN",
      status: "pending",
      item_kind: input.kind,
      category_ids: [],
      price_usd_cents: usdCents,  // what the customer is charged
      fx_rate: fx.rate,           // locked now; later rate changes do not affect this invoice
    })
    .select("id")
    .single();
  if (insErr || !pay) {
    console.error("[crypto] could not create payment row", insErr);
    return { error: "Could not start the payment. Try again." };
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL!.replace(/\/$/, "");
  try {
    const inv = await nowpayments.createInvoice({
      priceUsd: usdCents / 100,
      orderId: reference,
      description: input.kind === "topup" ? "Veloura wallet top-up" : "Veloura Full Daily Pass",
      ipnUrl: `${site}/api/webhooks/crypto`,
      successUrl: `${site}/checkout/status/${reference}`,
      cancelUrl: `${site}/checkout/topup`,
    });
    await admin.from("payments").update({ provider_invoice_id: inv.id, invoice_url: inv.url }).eq("id", pay.id);
    return { url: inv.url };
  } catch (e) {
    console.error("[crypto] invoice creation failed", e);
    await admin.from("payments").update({ status: "failed", provider_status: "invoice_error" }).eq("id", pay.id);
    return { error: "The payment provider could not create your invoice. Try again in a moment." };
  }
}
