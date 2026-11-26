import test from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt, maskTail } from "./crypto-box";

const KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

test("encrypt/decrypt round trip, and each encryption is different", () => {
  const a = encrypt("TXyz123456789012345678901234567890", KEY);
  const b = encrypt("TXyz123456789012345678901234567890", KEY);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, KEY), "TXyz123456789012345678901234567890");
});

test("tampering, wrong key and bad keys are rejected", () => {
  const t = encrypt("0123456789", KEY);
  const parts = t.split(":");
  parts[3] = Buffer.from("tampered!!").toString("base64");
  assert.throws(() => decrypt(parts.join(":"), KEY));
  assert.throws(() => decrypt(t, "ff".repeat(32)));
  assert.throws(() => encrypt("x", "short"));
  assert.throws(() => decrypt("garbage", KEY));
});

test("maskTail", () => {
  assert.equal(maskTail("0123456789"), "••••6789");
  assert.equal(maskTail("abc"), "abc");
});
