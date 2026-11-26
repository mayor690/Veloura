"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function processPayout(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const action = String(fd.get("action") ?? "");
  const { error } = await supabaseAdmin().rpc("process_payout", {
    p_staff: staff.id, p_payout: id, p_action: action,
    p_reference: String(fd.get("reference") ?? "").slice(0, 200), p_note: String(fd.get("note") ?? "").slice(0, 300),
  });
  revalidatePath("/admin/payouts");
  if (error) {
    const code = ["reference_required", "note_required", "invalid_state"].find((c) => error.message.includes(c)) ?? "failed";
    redirect(`/admin/payouts/${id}?e=${code}`);
  }
  redirect("/admin/payouts");
}
