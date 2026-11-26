import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifyIpn } from "./ipn";
import { effectiveMinUsdCents, koboToUsdCentsCeil, parseUsdInput, usdCentsToKobo } from "./fx";

const SECRET = "test_ipn_secret";
const payload = {
  payment_id: 5077125051,
  payment_status: "finished",
  order_id: "np_abc",
  price_amount: 5,
  price_currency: "usd",
  fee: { currency: "btc", depositFee: 0.0001, withdrawalFee: 0 },
  updated_at: 1700000000000,
};
// Independent reference: hand-built sorted JSON, nested keys sorted too.
const sortedJson =
  '{"fee":{"currency":"btc","depositFee":0.0001,"withdrawalFee":0},"order_id":"np_abc","payment_id":5077125051,' +
  '"payment_status":"finished","price_amount":5,"price_currency":"usd","updated_at":1700000000000}';
const sign = (s: string) => createHmac("sha512", SECRET).update(s).digest("hex");

test("accepts a correctly signed body, whatever the key order on the wire", () => {
  const raw = JSON.stringify(payload);
  assert.ok(verifyIpn(raw, sign(sortedJson), SECRET));
});

test("rejects a wrong secret, a tampered body, and a missing signature", () => {
  const raw = JSON.stringify(payload);
  assert.equal(verifyIpn(raw, sign(sortedJson), "other_secret"), null);
  assert.equal(verifyIpn(raw.replace('"usd"', '"eur"'), sign(sortedJson), SECRET), null);
  assert.equal(verifyIpn(raw, null, SECRET), null);
  assert.equal(verifyIpn("not json", sign(sortedJson), SECRET), null);
});

test("fx math", () => {
  assert.equal(usdCentsToKobo(500, 1500), 750_000);          // $5 at ₦1,500 = ₦7,500
  assert.equal(koboToUsdCentsCeil(28_000, 1400), 20);         // float edge case, must not become 21
  assert.equal(koboToUsdCentsCeil(28_000, 1500), 19);         // ₦280 ≈ $0.19
  assert.equal(effectiveMinUsdCents({ rate: 1500, minUsdCents: 100, minTopupKobo: 50_000 }), 100);
  assert.equal(effectiveMinUsdCents({ rate: 1500, minUsdCents: 10, minTopupKobo: 50_000 }), 34); // ₦500 → 34 cents
});

test("parseUsdInput", () => {
  assert.equal(parseUsdInput("5"), 500);
  assert.equal(parseUsdInput("$2.5"), 250);
  assert.equal(parseUsdInput("12.34"), 1234);
  assert.equal(parseUsdInput("1.234"), null);
  assert.equal(parseUsdInput("-3"), null);
  assert.equal(parseUsdInput("abc"), null);
});
