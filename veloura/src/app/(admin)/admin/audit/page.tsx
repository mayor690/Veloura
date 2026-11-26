import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

type L = { id: number; actor_id: string | null; action: string; entity: string | null; entity_id: string | null; meta: unknown; created_at: string };

export default async function Audit() {
  if (!(await requireAdmin())) notFound();
  const admin = supabaseAdmin();
  const { data } = await admin.from("audit_logs").select("id,actor_id,action,entity,entity_id,meta,created_at").order("id", { ascending: false }).limit(200);
  const logs = (data ?? []) as L[];
  const ids = [...new Set(logs.map((l) => l.actor_id).filter(Boolean))] as string[];
  const { data: ppl } = ids.length ? await admin.from("profiles").select("id,username").in("id", ids) : { data: [] };
  const name = new Map(((ppl ?? []) as { id: string; username: string }[]).map((p) => [p.id, p.username]));
  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Audit log</h1>
      <p className="text-sm text-muted">Last 200 staff and system actions. Entries are only ever added, never edited.</p>
      <ul className="grid gap-2">
        {logs.map((l) => (
          <li key={l.id} className="rounded-xl border border-line bg-card p-3 text-sm">
            <div className="flex flex-wrap gap-x-3"><span className="font-semibold">{l.action}</span>
              <span className="text-muted">{l.actor_id ? `@${name.get(l.actor_id) ?? l.actor_id.slice(0, 8)}` : "system"}</span>
              <span className="text-muted">{new Date(l.created_at).toLocaleString("en-NG")}</span></div>
            <p className="break-all text-xs text-muted">{l.entity} {l.entity_id}{l.meta ? ` · ${JSON.stringify(l.meta)}` : ""}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
