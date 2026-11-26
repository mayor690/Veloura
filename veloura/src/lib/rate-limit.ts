import "server-only";
import { createHmac } from "crypto";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Kind = "login" | "recover" | "register";

/** HMAC of the caller's IP. The raw IP is never stored. Returns null when the platform gives us no IP. */
async function ipHash(): Promise<string | null> {
  const h = await headers();
  // x-real-ip is set by the platform (Vercel). If you run behind your own proxy, make sure it overwrites these headers.
  const raw = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  if (!raw) return null;
  const salt = process.env.RATE_LIMIT_SALT || process.env.RECOVERY_PEPPER || "";
  return createHmac("sha256", salt).update(raw).digest("hex").slice(0, 32);
}

/** Seconds the caller must wait before trying again, or 0 if allowed. Fails open if the database is unreachable. */
export async function rateWait(kind: Kind, username: string): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc("auth_rl_blocked", { p_kind: kind, p_username: username, p_ip: await ipHash() });
  if (error) { console.error("[rate-limit] check failed (allowing)", error.message); return 0; }
  return Number(data ?? 0);
}

export async function recordAttempt(kind: Kind, username: string, success: boolean): Promise<void> {
  const { error } = await supabaseAdmin().rpc("auth_rl_record", { p_kind: kind, p_username: username, p_ip: await ipHash(), p_success: success });
  if (error) console.error("[rate-limit] record failed", error.message);
}

export function waitMessage(seconds: number) {
  const m = Math.ceil(seconds / 60);
  return `Too many attempts. Please try again in ${m} minute${m === 1 ? "" : "s"}.`;
}
