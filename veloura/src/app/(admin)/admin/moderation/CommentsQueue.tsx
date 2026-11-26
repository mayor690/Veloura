import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge, btn } from "@/components/admin/ui";
import { ago } from "@/lib/constants";
import { approveComment, dismissCommentReports, rejectAndMuteComment, rejectComment, removeComment } from "./actions";

// comments has two foreign keys to profiles (author and moderator), so the embed must name the author one.
const AUTHOR = "profiles!comments_user_id_fkey(username)";
const SEL = `id,body,created_at,flag,auto_approved,${AUTHOR},posts(title)`;

type C = { id: string; body: string; created_at: string; flag: string | null; auto_approved?: boolean; profiles: { username: string } | null; posts: { title: string | null } | null };
type R = { id: string; reason: string; details: string | null; created_at: string; comment: Omit<C, "flag" | "created_at"> & { status: string } };

const FLAG_LABEL: Record<string, string> = {
  minor_terms: "Mentions age or minors",
  reported_possible_minor: "Reported: possible minor",
  reported_non_consensual: "Reported: no consent",
  reported_illegal: "Reported: illegal",
};
const REASON_LABEL: Record<string, string> = {
  possible_minor: "Possible minor", non_consensual: "No consent", illegal: "Illegal", spam: "Spam or scam", personal_info: "Personal info", other: "Other",
};

export async function CommentsQueue() {
  const admin = supabaseAdmin();
  const [pendingQ, recentQ, reportsQ] = await Promise.all([
    // Flagged comments first, then oldest first.
    admin.from("comments").select(SEL).eq("status", "pending")
      .order("flag", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true }).limit(30),
    admin.from("comments").select(SEL).eq("status", "approved").order("approved_at", { ascending: false }).limit(15),
    admin.from("comment_reports")
      .select(`id,reason,details,created_at,comment:comments!inner(id,body,status,${AUTHOR},posts(title))`)
      .eq("status", "open").eq("comment.status", "approved").order("created_at", { ascending: true }).limit(100),
  ]);
  for (const q of [pendingQ, recentQ, reportsQ]) if (q.error) console.error("[moderation] comments query failed", q.error.message);

  const pending = (pendingQ.data ?? []) as unknown as C[];
  const recent = (recentQ.data ?? []) as unknown as C[];

  // Group open reports by comment.
  const grouped = new Map<string, { comment: R["comment"]; reasons: Record<string, number>; details: string[]; oldest: string }>();
  for (const r of (reportsQ.data ?? []) as unknown as R[]) {
    const g = grouped.get(r.comment.id) ?? { comment: r.comment, reasons: {}, details: [], oldest: r.created_at };
    g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
    if (r.details && g.details.length < 3) g.details.push(r.details);
    grouped.set(r.comment.id, g);
  }
  const reported = [...grouped.values()];

  const row = (c: { id: string; body: string; auto_approved?: boolean; profiles: { username: string } | null; posts: { title: string | null } | null }, when: string, flag: string | null, actions: React.ReactNode) => (
    <li key={c.id} className={`rounded-2xl border bg-card p-4 text-sm ${flag ? "border-amber-400/60" : "border-line"}`}>
      <p className="text-xs text-muted">@{c.profiles?.username} on “{c.posts?.title ?? "Untitled"}” · {ago(when)} ago</p>
      {flag && <p className="mt-2"><Badge tone="warn">{FLAG_LABEL[flag] ?? flag}</Badge></p>}
      {c.auto_approved && <p className="mt-2"><Badge tone="info">Auto-approved (trusted account)</Badge></p>}
      <p className="mt-2 whitespace-pre-wrap">{c.body}</p>
      <div className="mt-3 flex gap-2">{actions}</div>
    </li>
  );

  return (
    <div className="grid gap-6">
      {reported.length > 0 && (
        <section className="grid gap-3">
          <h2 className="font-semibold text-amber-300">Reported by readers ({reported.length})</h2>
          <ul className="grid gap-3">
            {reported.map((g) => (
              <li key={g.comment.id} className="rounded-2xl border border-amber-400/60 bg-card p-4 text-sm">
                <p className="text-xs text-muted">@{g.comment.profiles?.username} on “{g.comment.posts?.title ?? "Untitled"}” · reported {ago(g.oldest)} ago</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(g.reasons).map(([r, n]) => <Badge key={r} tone="warn">{REASON_LABEL[r] ?? r} × {n}</Badge>)}
                </div>
                {g.details.length > 0 && <ul className="mt-2 grid gap-1 text-xs text-muted">{g.details.map((d, i) => <li key={i}>“{d}”</li>)}</ul>}
                <p className="mt-2 whitespace-pre-wrap">{g.comment.body}</p>
                <div className="mt-3 flex gap-2">
                  <form action={removeComment}><input type="hidden" name="id" value={g.comment.id} /><button className={`${btn} border border-rose text-rose`}>Remove comment</button></form>
                  <form action={dismissCommentReports}><input type="hidden" name="id" value={g.comment.id} /><button className={`${btn} border border-line`}>Dismiss reports</button></form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3">
        <h2 className="font-semibold">Waiting for review</h2>
        <p className="text-xs text-muted">Flagged comments (age or minor mentions, or pulled back after a serious report) are listed first.</p>
        <ul className="grid gap-3">
          {pending.map((c) => row(c, c.created_at, c.flag, <>
            <form action={approveComment}><input type="hidden" name="id" value={c.id} /><button className={`${btn} bg-emerald-600`}>Approve</button></form>
            <form action={rejectComment}><input type="hidden" name="id" value={c.id} /><button className={`${btn} border border-rose text-rose`}>Reject</button></form>
            <form action={rejectAndMuteComment}><input type="hidden" name="id" value={c.id} /><button className={`${btn} border border-amber-400 text-amber-300`}>Reject and restrict 7 days</button></form>
          </>))}
          {!pending.length && <li className="text-muted">No comments waiting.</li>}
        </ul>
      </section>

      <section className="grid gap-3">
        <h2 className="font-semibold">Recently approved</h2>
        <ul className="grid gap-3">
          {recent.map((c) => row(c, c.created_at, null,
            <form action={removeComment}><input type="hidden" name="id" value={c.id} /><button className={`${btn} border border-line`}>Remove</button></form>))}
          {!recent.length && <li className="text-muted">None yet.</li>}
        </ul>
      </section>
    </div>
  );
}
