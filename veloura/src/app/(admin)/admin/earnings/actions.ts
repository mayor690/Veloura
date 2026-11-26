"use server";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";

/** Same job the nightly cron runs; only pays finished days that have not been paid yet. */
export async function runEarningsNow(): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const { data, error } = await supabaseAdmin().rpc("run_pending_earnings");
  if (error) redirect("/admin/earnings?e=failed");
  const ran = ((data ?? []) as { status: string }[]).filter((d) => d.status === "ran").length;
  await audit(staff.id, "earnings.manual_run", "earnings", "manual", { days_paid: ran });
  redirect(`/admin/earnings?ran=${ran}`);
}
