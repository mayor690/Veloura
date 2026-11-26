import { createHmac, timingSafeEqual } from "crypto";

/** Recursively sort object keys (arrays keep their order). */
export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object).sort().map((k) => [k, sortKeysDeep((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

/**
 * NOWPayments signs the JSON body with HMAC-SHA512 using the IPN secret, keys sorted alphabetically.
 * Their sample code sorts top-level keys only (JSON.stringify with a key array, which also filters nested
 * keys); other implementations sort recursively. We accept either form. Both require the secret,
 * so accepting both does not weaken verification.
 */
export function expectedSignatures(payload: Record<string, unknown>, secret: string): string[] {
  const recursive = JSON.stringify(sortKeysDeep(payload));
  const topLevelOnly = JSON.stringify(payload, Object.keys(payload).sort());
  return [recursive, topLevelOnly].map((s) => createHmac("sha512", secret).update(s).digest("hex"));
}

/** Returns the parsed payload when the signature is valid, otherwise null. */
export function verifyIpn(rawBody: string, signature: string | null, secret: string): Record<string, unknown> | null {
  if (!signature || !secret) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const given = Buffer.from(signature.trim().toLowerCase(), "utf8");
  for (const exp of expectedSignatures(payload as Record<string, unknown>, secret)) {
    const e = Buffer.from(exp, "utf8");
    if (e.length === given.length && timingSafeEqual(e, given)) return payload as Record<string, unknown>;
  }
  return null;
}
