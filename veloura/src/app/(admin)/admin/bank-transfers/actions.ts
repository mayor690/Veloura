"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

const back = (q: string): never => { revalidatePath("/admin/bank-transfers"); redirect(`/admin/bank-transfers?${q}`); };

export async function approveBankTransfer(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const amountNaira = Number(fd.get("amount"));
  if (!id || !Number.isFinite(amountNaira) || amountNaira <= 0) back("e=bad_amount");
  const { error } = await supabaseAdmin().rpc("approve_bank_transfer", {
    p_admin: staff.id, p_id: id, p_amount: Math.round(amountNaira * 100), p_note: String(fd.get("note") ?? "").slice(0, 200),
  });
  if (error) {
    console.error("[bank] approve failed", error.message);
    back(`e=${error.message.includes("not_open") ? "not_open" : error.message.includes("banned") ? "banned" : "failed"}`);
  }
  back("ok=approved");
}

export async function rejectBankTransfer(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const { error } = await supabaseAdmin().rpc("reject_bank_transfer", {
    p_admin: staff.id, p_id: String(fd.get("id") ?? ""), p_note: String(fd.get("note") ?? "").slice(0, 200),
  });
  if (error) {
    console.error("[bank] reject failed", error.message);
    back(`e=${error.message.includes("not_open") ? "not_open" : "failed"}`);
  }
  back("ok=rejected");
}
