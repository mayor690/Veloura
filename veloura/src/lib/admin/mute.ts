import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";

/** Allowed restriction lengths in hours. null means "until an admin lifts it". */
export const MUTE_OPTIONS: { value: string; label: string; hours: number | null }[] = [
  { value: "24", label: "1 day", hours: 24 },
  { value: "168", label: "7 days", hours: 168 },
  { value: "720", label: "30 days", hours: 720 },
  { value: "forever", label: "Until lifted", hours: null },
];

/** Restrict an account from commenting and reacting. Never applies to staff accounts or banned users' own settings. */
export async function muteUser(staffId: string, userId: string, option: string, reason: string, via: string): Promise<boolean> {
  const opt = MUTE_OPTIONS.find((o) => o.value === option);
  if (!opt || !userId || userId === staffId) return false;
  const admin = supabaseAdmin();
  const { data: target } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (!target || target.role !== "user") return false; // staff accounts are never muted
  const until = opt.hours === null ? "infinity" : new Date(Date.now() + opt.hours * 3_600_000).toISOString();
  const note = reason.trim().slice(0, 200) || "Community rules";
  const { error } = await admin.from("profiles").update({ muted_until: until, mute_reason: note }).eq("id", userId);
  if (error) { console.error("[mute] failed", error.message); return false; }
  await audit(staffId, "user.mute", "user", userId, { until, reason: note, via });
  return true;
}

export async function unmuteUser(staffId: string, userId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("profiles").update({ muted_until: null, mute_reason: null }).eq("id", userId);
  if (error) { console.error("[mute] lift failed", error.message); return; }
  await audit(staffId, "user.unmute", "user", userId);
}
