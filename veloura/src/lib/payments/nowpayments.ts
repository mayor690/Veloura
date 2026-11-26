import "server-only";
import type { PaymentProvider, CreateInvoiceInput } from "./provider";

const base = () => (process.env.NOWPAYMENTS_API_BASE || "https://api.nowpayments.io/v1").replace(/\/$/, "");

export const nowpayments: PaymentProvider = {
  name: "nowpayments",

  configured() {
    return !!(
      process.env.NOWPAYMENTS_API_KEY &&
      process.env.NOWPAYMENTS_IPN_SECRET &&
      process.env.NEXT_PUBLIC_SITE_URL
    );
  },

  async createInvoice(i: CreateInvoiceInput) {
    const res = await fetch(`${base()}/invoice`, {
      method: "POST",
      headers: { "x-api-key": process.env.NOWPAYMENTS_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        price_amount: i.priceUsd,
        price_currency: "usd",
        order_id: i.orderId,
        order_description: i.description,
        ipn_callback_url: i.ipnUrl,
        success_url: i.successUrl,
        cancel_url: i.cancelUrl,
        is_fixed_rate: true,        // lock the crypto amount for the life of the invoice
        is_fee_paid_by_user: true,  // network fees must not eat into a small wallet credit
        // Optional: force one coin/network (e.g. a USDT network code from your NOWPayments currency list).
        // Leave unset and the customer picks on the hosted page.
        ...(process.env.NOWPAYMENTS_PAY_CURRENCY ? { pay_currency: process.env.NOWPAYMENTS_PAY_CURRENCY } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`NOWPayments ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const j = (await res.json()) as { id?: string | number; invoice_url?: string };
    if (!j.id || !j.invoice_url) throw new Error("NOWPayments: malformed invoice response");
    return { id: String(j.id), url: j.invoice_url };
  },
};
