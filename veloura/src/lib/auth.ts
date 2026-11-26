import "server-only";
import { createHash, randomBytes } from "crypto";

export const toEmail = (username: string) => `${username.toLowerCase()}@users.veloura.app`;

export function newRecoveryCode() {
  // 20 chars from a 32-symbol alphabet = 100 bits, shown once as XXXXX-XXXXX-XXXXX-XXXXX
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  const raw = Array.from(bytes, (b) => alphabet[b % 32]).join("");
  return raw.match(/.{5}/g)!.join("-");
}

export const hashRecovery = (code: string) =>
  createHash("sha256")
    .update(code.replace(/-/g, "").toUpperCase() + process.env.RECOVERY_PEPPER)
    .digest("hex");
