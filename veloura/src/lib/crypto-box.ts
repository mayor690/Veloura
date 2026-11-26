import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM for payout account details. The key lives only in PAYOUT_ENCRYPTION_KEY (64 hex chars = 32 bytes).
function key(hex?: string) {
  const h = hex ?? process.env.PAYOUT_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error("PAYOUT_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(h, "hex");
}

export function encrypt(plain: string, hex?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(hex), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decrypt(token: string, hex?: string): string {
  const [v, iv, tag, ct] = token.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised ciphertext");
  const d = createDecipheriv("aes-256-gcm", key(hex), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

export const maskTail = (s: string, n = 4) => (s.length <= n ? s : `••••${s.slice(-n)}`);
