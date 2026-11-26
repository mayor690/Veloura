import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyIpn } from "@/lib/payments/ipn";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** NOWPayments IPN. Only this route ever grants value for a crypto payment; the browser redirect never does. */
export async function POST(req: Request) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) {
    console.error("[ipn] NOWPAYMENTS_IPN_SECRET not set");
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  }

  const raw = await req.text();
  const body = verifyIpn(raw, req.headers.get("x-nowpayments-sig"), secret);
  if (!body) return NextResponse.json({ error: "invalid signature" }, { status: 400 });

  const orderId = String(body.order_id ?? "");
  const status = String(body.payment_status ?? "");
  const providerPaymentId = String(body.payment_id ?? "");
  if (!orderId.startsWith("np_") || !status || !providerPaymentId) {
    return NextResponse.json({ ok: true, ignored: "not one of ours" });
  }

  const admin = supabaseAdmin();
  const { data: pay } = await admin
    .from("payments")
    .select("price_usd_cents")
    .eq("reference", orderId)
    .eq("provider", "nowpayments")
    .maybeSingle();
  if (!pay) return NextResponse.json({ ok: true, ignored: "unknown order" });

  // The invoice amount must match what we created. Never credit on a mismatch.
  const paidUsdCents = Math.round(Number(body.price_amount) * 100);
  if (String(body.price_currency ?? "").toLowerCase() !== "usd" || paidUsdCents !== pay.price_usd_cents) {
    console.error("[ipn] amount mismatch", { orderId, got: body.price_amount, expected: pay.price_usd_cents });
    return NextResponse.json({ error: "amount mismatch" }, { status: 400 });
  }

  const { data: result, error } = await admin.rpc("process_nowpayments_ipn", {
    p_event_id: `${providerPaymentId}:${status}:${String(body.updated_at ?? "")}`,
    p_order_id: orderId,
    p_status: status,
    p_provider_payment_id: providerPaymentId,
    p_pay_currency: body.pay_currency ? String(body.pay_currency) : null,
    p_tx_hash: body.payin_hash ? String(body.payin_hash) : null,
    p_payload: body,
  });
  if (error) {
    console.error("[ipn] processing failed", error);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // provider will retry
  }
  return NextResponse.json({ ok: true, result });
}
