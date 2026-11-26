import { supabaseAdmin } from "@/lib/supabase/admin";
import { btn } from "@/components/admin/ui";
import { ago } from "@/lib/constants";
import { approveComment, rejectComment, removeComment } from "./actions";

type C = { id: string; body: string; created_at: string; profiles: { username: string } | null; posts: { title: string | null } | null };
const SEL = "id,body,created_at,profiles(username),posts(title)";

export async function CommentsQueue() {
  const admin = supabaseAdmin();
  const [{ data: pending }, { data: recent }] = await Promise.all([
    admin.from("comments").select(SEL).eq("status", "pending").order("created_at", { ascending: true }).limit(30),
    admin.from("comments").select(SEL).eq("status", "approved").order("approved_at", { ascending: false }).limit(15),
  ]);
  const row = (c: C, actions: React.ReactNode) => (
    <li key={c.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
      <p className="text-xs text-muted">@{c.profiles?.username} on “{c.posts?.title ?? "Untitled"}” · {ago(c.created_at)} ago</p>
      <p className="mt-2 whitespace-pre-wrap">{c.body}</p>
      <div className="mt-3 flex gap-2">{actions}</div>
    </li>
  );
  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h2 className="font-semibold">Waiting for review</h2>
        <ul className="grid gap-3">
          {((pending ?? []) as unknown as C[]).map((c) => row(c, <>
            <form action={approveComment}><input type="hidden" name="id" value={c.id} /><button className={`${btn} bg-emerald-600`}>Approve</button></form>
            <form action={rejectComment}><input type="hidden" name="id" value={c.id} /><button className={`${btn} border border-rose text-rose`}>Reject</button></form>
          </>))}
          {!pending?.length && <li className="text-muted">No comments waiting.</li>}
        </ul>
      </section>
      <section className="grid gap-3">
        <h2 className="font-semibold">Recently approved</h2>
        <ul className="grid gap-3">
          {((recent ?? []) as unknown as C[]).map((c) => row(c,
            <form action={removeComment}><input type="hidden" name="id" value={c.id} /><button className={`${btn} border border-line`}>Remove</button></form>))}
        </ul>
      </section>
    </div>
  );
}
