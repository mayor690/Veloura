# NOWPayments setup (crypto wallet top-ups)

Veloura uses NOWPayments' **hosted invoice** flow. The user picks an amount in USD, is sent to NOWPayments'
payment page to pay in crypto, and NOWPayments calls our webhook when the payment is final. Only the webhook
credits the wallet. The browser redirect back to the site never does.

You will set two secrets as environment variables: `NOWPAYMENTS_API_KEY` and `NOWPAYMENTS_IPN_SECRET`.
Never commit them, never put them in a `NEXT_PUBLIC_` variable, and never paste them into chat or screenshots.

---

## 0. Before you start: confirm the content is allowed

Crypto processors also have acceptable-use rules, and adult content is a common restriction. I have not
verified NOWPayments' policy for your categories. Ask their support in writing, before you build volume on it:
"Does your acceptable-use policy allow a platform with adult/sexual user-generated content?" Keep the answer.
If they say no, the code is provider-agnostic (`src/lib/payments/provider.ts`), so another processor can be swapped in.

## 1. Create the account

1. Register at nowpayments.io and verify your email.
2. Complete any identity/business verification they ask for. Requirements depend on your country and volume,
   so follow what the dashboard asks.
3. Create a **store** if the dashboard prompts for one (the store holds your API key, IPN secret and payout settings).

## 2. Set where your money goes (payout wallet)

In the dashboard, set the wallet address and currency you want to receive funds in. Because Veloura wallet
credit is stablecoin-denominated, receiving into USDT or USDC is the simplest choice, and it avoids price swings
between a customer paying and you cashing out. Use a wallet you control and double-check the network (for
example TRC20 vs ERC20); funds sent to the wrong network are usually unrecoverable.

## 3. Create the API key

1. In the dashboard's store/settings area, create an **API key**. (Menu names change; search the dashboard
   or NOWPayments' docs for "API keys" if you can't find it.)
2. Copy it immediately and put it in `NOWPAYMENTS_API_KEY`.

## 4. Create the IPN secret

1. In the same settings area, find the **IPN / Instant Payment Notifications** section and generate an
   **IPN secret key**.
2. Put it in `NOWPAYMENTS_IPN_SECRET`.
3. The callback URL is sent with every invoice by the app, so you normally don't need to type it in the
   dashboard: it is `NEXT_PUBLIC_SITE_URL + /api/webhooks/crypto`.

## 5. Environment variables

Local: copy `.env.example` to `.env.local` and fill in the two NOWPayments values.

Production (for example Vercel): add these in the project's Environment Variables settings, then redeploy:

| Variable | Value |
|---|---|
| `NOWPAYMENTS_API_KEY` | your API key |
| `NOWPAYMENTS_IPN_SECRET` | your IPN secret |
| `NEXT_PUBLIC_SITE_URL` | `https://yourdomain.com` (no trailing slash) |

If any of these are missing, `/checkout/topup` shows "Crypto top-ups are unavailable" and nothing is charged.

## 6. Run the database migration and set the exchange rate

Run `supabase/migrations/0003_crypto_topups.sql`. It seeds a **placeholder** rate of ₦1,500 per $1. Set the real
one before taking money (the admin dashboard will get a form for this in Step 5; until then, use SQL):

```sql
update site_settings set value = '1500', updated_at = now() where key = 'usd_ngn_rate';
```

Related settings (all editable the same way):

| Key | Meaning | Default |
|---|---|---|
| `usd_ngn_rate` | Naira per 1 USD. Wallet credit = USD paid × this rate. | `1500` (placeholder) |
| `min_topup_usd_cents` | Smallest top-up, in USD cents | `100` ($1.00) |
| `max_topup_usd_cents` | Largest top-up, in USD cents | `20000` ($200.00) |
| `min_topup_kobo` | The ₦ minimum (₦500). The effective minimum is the larger of this and the USD floor. | `50000` |
| `crypto_enabled` | Master switch for crypto payments | `true` |

How the rate behaves: the rate is **locked into each payment when the invoice is created**. Changing it later
only affects new payments. Keep it current: if the naira weakens and you leave the rate high, you credit users
more naira per dollar than the market, and you lose the difference.

## 7. Test before real money

NOWPayments provides a separate **sandbox** environment with its own account and keys. Check their API docs
for the current sandbox URLs, create sandbox keys, and put the sandbox API base URL in `NOWPAYMENTS_API_BASE`.

Webhooks need a public URL, so for local testing expose your dev server with a tunnel (Cloudflare Tunnel,
ngrok, etc.) and set `NEXT_PUBLIC_SITE_URL` to the tunnel's https address.

Test checklist:

1. Register a user, open `/checkout/topup`, choose $1, click Pay. You land on NOWPayments' payment page.
2. Complete a sandbox payment. You are returned to `/checkout/status/<reference>`, which polls every 5 seconds.
3. When NOWPayments sends the `finished` status, the page turns green and the navbar balance rises by
   $1 × rate in naira.
4. Check the database: `payments.status = 'succeeded'`, one row in `wallet_ledger` (`reason = 'topup'`), one
   row in `webhook_events` per status change.
5. Replay the same webhook (NOWPayments' dashboard can resend). The balance must NOT change again.
6. Unlock a category from the wallet; the balance drops by ₦112.

## 8. Going live

1. Create production keys, put them in production env vars, and remove `NOWPAYMENTS_API_BASE` (or set it back
   to `https://api.nowpayments.io/v1`).
2. Set the real `usd_ngn_rate`.
3. Run one small real payment end to end ($1) and confirm the wallet credit and your payout wallet receipt.
4. Add monitoring for failed webhooks (5xx responses from `/api/webhooks/crypto`) in your host's logs.

## How statuses are handled

| NOWPayments status | What Veloura does |
|---|---|
| `waiting`, `confirming`, `confirmed`, `sending` | Stays pending; the status page shows progress. **Not credited.** |
| `finished` | Marked succeeded and the wallet is credited (or the Full Pass granted), exactly once. |
| `partially_paid` | Stays pending, **not credited**. The user is told to contact support. Review manually. |
| `failed`, `expired` | Marked failed/expired. Nothing is credited. |
| `refunded` | Marked refunded if it was still pending. |

Security properties: every webhook's HMAC-SHA512 signature is verified with `NOWPAYMENTS_IPN_SECRET`; the
invoice amount in the webhook must equal the amount we created; events are de-duplicated in `webhook_events`; and
processing is a single database transaction so a failure is retried safely.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Crypto payments are unavailable" | Missing env var, `crypto_enabled = false`, or `usd_ngn_rate` missing/invalid. Check server logs for `[crypto]`. |
| "The payment provider could not create your invoice" | Wrong/expired API key, sandbox key against the production URL (or vice versa), or the amount is below the provider's minimum for the coin. Server log has the provider's response. |
| Paid, but wallet not credited | Webhook not arriving: `NEXT_PUBLIC_SITE_URL` not publicly reachable or wrong. Look for requests to `/api/webhooks/crypto` in logs. |
| Webhook returns 400 "invalid signature" | `NOWPAYMENTS_IPN_SECRET` doesn't match the dashboard's current secret (regenerated?), or a proxy is altering the request body. |
| Webhook returns 400 "amount mismatch" | The invoice was changed or the webhook doesn't belong to one of our invoices. Check the payment row. |
| Direct Full Pass option says it's too small | At today's rate the pass is below the single-payment minimum. This is expected at low prices; use the wallet. |

## Known limits to plan for

- Provider minimums: every coin/network has a minimum payment and network fees. That is why top-ups are $1+
  and why per-unlock crypto payments (₦112) are not offered. If NOWPayments rejects a $1 invoice for your chosen
  coin, raise `min_topup_usd_cents`.
- Refunds of already-credited top-ups are manual for now (a negative `wallet_ledger` adjustment plus a note).
- Rate risk sits with you between the day you set the rate and the day you cash out stablecoins to naira.
