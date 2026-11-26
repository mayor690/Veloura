import "server-only";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** Returns the signed-in user if they are an admin or moderator. Check this in every admin action; layouts are not enough. */
export async function requireStaff(): Promise<{ id: string; role: "admin" | "moderator" } | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabaseAdmin().from("profiles").select("role,is_banned").eq("id", user.id).single();
  if (!data || data.is_banned || (data.role !== "admin" && data.role !== "moderator")) return null;
  return { id: user.id, role: data.role };
}

/** Admin-only (finance, users, settings, ads). Moderators are not enough. */
export async function requireAdmin() {
  const s = await requireStaff();
  return s?.role === "admin" ? s : null;
}
