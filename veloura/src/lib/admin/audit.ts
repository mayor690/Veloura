import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function audit(actorId: string | null, action: string, entity: string, entityId: string, meta?: Record<string, unknown>) {
  const { error } = await supabaseAdmin().from("audit_logs").insert({ actor_id: actorId, action, entity, entity_id: entityId, meta: meta ?? null });
  if (error) console.error("[audit] failed to write", action, error);
}
