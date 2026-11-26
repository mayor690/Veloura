import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge, btn, inputCls } from "@/components/admin/ui";
import { naira } from "@/lib/constants";
import { adjustBalance, banUser, muteUser, setRole, unbanUser, unmuteUser } from "./actions";
import { MUTE_OPTIONS } from "@/lib/admin/mute";

type U = { id: string; username: string; role: string; is_banned: boolean; ban_reason: string | null; created_at: string; posts: number; wallet_kobo: number; creator_kobo: number };

function muteLabel(until: string) {
  return new Date(until).getFullYear() > 9000 ? "restricted until lifted" : `restricted until ${new Date(until).toLocaleDateString("en-NG")}`;
}

export default async function Users({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const me = await requireAdmin();
  if (!me) notFound();
  const { q = "" } = await searchParams;
  const { data } = await supabaseAdmin().rpc("admin_user_rows", { p_q: q.trim().slice(0, 30), p_limit: 30 });
  const users = (data ?? []) as U[];
  const { data: muteRows } = await supabaseAdmin().from("profiles").select("id,muted_until,mute_reason").in("id", users.map((u) => u.id));
  const mutes = new Map(((muteRows ?? []) as { id: string; muted_until: string | null; mute_reason: string | null }[])
    .filter((m) => m.muted_until && new Date(m.muted_until) > new Date()).map((m) => [m.id, m]));

  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Users</h1>
      <form className="flex gap-2">
        <input name="q" defaultValue={q} placeholder="Search by username" className={`${inputCls} flex-1`} />
        <button className={`${btn} border border-line`}>Search</button>
      </form>
      {users.map((u) => (
        <article key={u.id} className="rounded-2xl border border-line bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">@{u.username}</span>
            <Badge tone={u.role === "admin" ? "info" : u.role === "moderator" ? "good" : "default"}>{u.role}</Badge>
            {u.is_banned && <Badge tone="danger">banned</Badge>}
            {mutes.has(u.id) && <Badge tone="warn">{muteLabel(mutes.get(u.id)!.muted_until!)}</Badge>}
            {u.id === me.id && <Badge>you</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted">
            Joined {new Date(u.created_at).toLocaleDateString("en-NG")} · {u.posts} posts · wallet {naira(u.wallet_kobo)} · creator balance {naira(u.creator_kobo)}
            {u.ban_reason ? ` · ban reason: ${u.ban_reason}` : ""}
            {mutes.get(u.id)?.mute_reason ? ` · mute reason: ${mutes.get(u.id)!.mute_reason}` : ""}
          </p>

          {u.id !== me.id && (
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <form action={setRole} className="flex gap-2">
                <input type="hidden" name="userId" value={u.id} />
                <select name="role" defaultValue={u.role} className={`${inputCls} flex-1`}>
                  <option value="user">user</option><option value="moderator">moderator</option><option value="admin">admin</option>
                </select>
                <button className={`${btn} border border-line`}>Set role</button>
              </form>
              {u.is_banned ? (
                <form action={unbanUser}><input type="hidden" name="userId" value={u.id} /><button className={`${btn} w-full border border-line`}>Unban</button></form>
              ) : (
                <form action={banUser} className="flex gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <input name="reason" placeholder="Ban reason" maxLength={200} className={`${inputCls} min-w-0 flex-1`} />
                  <button className={`${btn} border border-rose text-rose`}>Ban</button>
                </form>
              )}
            </div>
          )}

          {u.id !== me.id && u.role === "user" && !u.is_banned && (
            <div className="mt-3">
              {mutes.has(u.id) ? (
                <form action={unmuteUser}><input type="hidden" name="userId" value={u.id} /><button className={`${btn} border border-line`}>Lift comment restriction</button></form>
              ) : (
                <form action={muteUser} className="flex flex-wrap gap-2">
                  <input type="hidden" name="userId" value={u.id} />
                  <select name="duration" className={inputCls} defaultValue="168">
                    {MUTE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <input name="reason" placeholder="Reason (optional)" maxLength={200} className={`${inputCls} min-w-0 flex-1`} />
                  <button className={`${btn} border border-amber-400 text-amber-300`}>Restrict commenting and reactions</button>
                </form>
              )}
            </div>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">Adjust a balance (refund, correction, bonus)</summary>
            <form action={adjustBalance} className="mt-2 grid gap-2 sm:grid-cols-5">
              <input type="hidden" name="userId" value={u.id} />
              <select name="target" className={inputCls}><option value="wallet">Wallet</option><option value="creator">Creator</option></select>
              <input name="amount" type="number" step="0.01" placeholder="± ₦ amount" required className={inputCls} />
              <input name="note" placeholder="Note (required)" required maxLength={300} className={`${inputCls} sm:col-span-2`} />
              <button className={`${btn} bg-accent-gradient`}>Apply</button>
            </form>
          </details>
        </article>
      ))}
      {!users.length && <p className="text-muted">No users match.</p>}
    </div>
  );
}
