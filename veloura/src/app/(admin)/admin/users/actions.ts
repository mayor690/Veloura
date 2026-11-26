"use server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { muteUser as applyMute, unmuteUser as liftMute } from "@/lib/admin/mute";

const done = () => revalidatePath("/admin/users");

export async function banUser(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const id = String(fd.get("userId") ?? "");
  if (id === staff.id) return; // never ban yourself
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 200) || "Content policy violation";
  await supabaseAdmin().from("profiles").update({ is_banned: true, ban_reason: reason }).eq("id", id);
  await audit(staff.id, "user.ban", "user", id, { reason });
  done();
}

export async function unbanUser(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const id = String(fd.get("userId") ?? "");
  await supabaseAdmin().from("profiles").update({ is_banned: false, ban_reason: null }).eq("id", id);
  await audit(staff.id, "user.unban", "user", id);
  done();
}

export async function setRole(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const id = String(fd.get("userId") ?? "");
  const role = String(fd.get("role") ?? "");
  if (!["user", "moderator", "admin"].includes(role) || id === staff.id) return; // cannot change your own role
  const admin = supabaseAdmin();
  const { data: target } = await admin.from("profiles").select("role").eq("id", id).single();
  if (target?.role === "admin" && role !== "admin") {
    const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) <= 1) return; // keep at least one admin
  }
  await admin.from("profiles").update({ role }).eq("id", id);
  await audit(staff.id, "user.role", "user", id, { from: target?.role, to: role });
  done();
}

/** Manual correction of a wallet or creator balance. Needs a note; written to the ledger and the audit log. */
export async function adjustBalance(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const target = String(fd.get("target") ?? "");
  const naira = Number(fd.get("amount"));
  if (!Number.isFinite(naira) || naira === 0 || Math.abs(naira) > 1_000_000) return;
  const { error } = await supabaseAdmin().rpc("admin_adjust_balance", {
    p_admin: staff.id, p_target: target, p_user: String(fd.get("userId") ?? ""),
    p_delta: Math.round(naira * 100), p_note: String(fd.get("note") ?? "").slice(0, 300),
  });
  if (error) console.error("[admin] adjust failed", error.message);
  done();
}

export async function muteUser(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  await applyMute(staff.id, String(fd.get("userId") ?? ""), String(fd.get("duration") ?? ""), String(fd.get("reason") ?? ""), "users");
  done();
}

export async function unmuteUser(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  await liftMute(staff.id, String(fd.get("userId") ?? ""));
  done();
}
