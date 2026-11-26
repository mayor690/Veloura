import Link from "next/link";
import { requireStaff } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signedMediaForPost } from "@/lib/r2/media";
import { MediaGallery } from "@/components/media/MediaGallery";
import { Badge, inputCls, btn } from "@/components/admin/ui";
import { ago } from "@/lib/constants";
import { approvePost, dismissReports, rejectPost, takedownPost } from "./actions";
import { CommentsQueue } from "./CommentsQueue";

const REASON_LABEL: Record<string, string> = {
  possible_minor: "Possible minor", non_consensual: "Non-consensual / intimate content", illegal: "Illegal content",
  spam: "Spam or scam", personal_info: "Personal information", other: "Other",
};
const REJECT_REASONS = ["Possible minor or age unclear", "No consent from person shown", "Illegal content", "Spam or scam", "Personal information shown", "Low quality", "Other"];

type PostBits = {
  id: string; title: string | null; body: string | null; status: string; held_at: string | null;
  categories: { name: string } | null; profiles: { username: string } | null;
};
type ReportRow = { id: string; post_id: string; reason: string; details: string | null; created_at: string; post: PostBits };
type Group = { post: PostBits; reasons: Record<string, number>; details: string[]; oldest: string };

async function loadGroups(urgent: boolean): Promise<Group[]> {
  const { data } = await supabaseAdmin().from("reports")
    .select("id,post_id,reason,details,created_at,post:posts!inner(id,title,body,status,held_at,categories(name),profiles!posts_author_id_fkey(username))")
    .eq("status", "open").eq("is_urgent", urgent).order("created_at", { ascending: true }).limit(300);
  const groups = new Map<string, Group>();
  for (const r of (data ?? []) as unknown as ReportRow[]) {
    const g = groups.get(r.post_id) ?? { post: r.post, reasons: {}, details: [], oldest: r.created_at };
    g.reasons[r.reason] = (g.reasons[r.reason] ?? 0) + 1;
    if (r.details && g.details.length < 5) g.details.push(r.details);
    groups.set(r.post_id, g);
  }
  return [...groups.values()];
}

async function countGroups(urgent: boolean) {
  const { data } = await supabaseAdmin().from("reports").select("post_id").eq("status", "open").eq("is_urgent", urgent).limit(500);
  return new Set((data ?? []).map((r: { post_id: string }) => r.post_id)).size;
}

export default async function Moderation({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const staff = (await requireStaff())!;
  const sp = await searchParams;
  const admin = supabaseAdmin();
  const [urgentN, reportsN, { count: pendingN }, { count: commentsN }] = await Promise.all([
    countGroups(true), countGroups(false),
    admin.from("posts").select("id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("comments").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const tab = ["urgent", "reports", "posts", "comments", "live"].includes(sp.tab ?? "") ? sp.tab! : urgentN ? "urgent" : reportsN ? "reports" : pendingN ? "posts" : commentsN ? "comments" : "posts";

  const tabs = [
    { id: "urgent", label: "Urgent", n: urgentN, tone: "danger" as const },
    { id: "reports", label: "Reports", n: reportsN, tone: "warn" as const },
    { id: "posts", label: "New posts", n: pendingN ?? 0, tone: "warn" as const },
    { id: "comments", label: "Comments", n: commentsN ?? 0, tone: "warn" as const },
    { id: "live", label: "Live posts", n: 0, tone: "default" as const },
  ];

  return (
    <div className="grid gap-5">
      <h1 className="font-display text-3xl">Moderation</h1>
      <nav className="flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <Link key={t.id} href={`/admin/moderation?tab=${t.id}`}
            className={`flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium ${
              tab === t.id ? (t.id === "urgent" ? "border-rose bg-rose/20 text-rose" : "border-purple bg-purple/15") : t.id === "urgent" && t.n ? "border-rose text-rose" : "border-line text-muted"}`}>
            {t.label}{t.id !== "live" && <Badge tone={t.n ? t.tone : "default"}>{t.n}</Badge>}
          </Link>
        ))}
      </nav>

      {(tab === "urgent" || tab === "reports") && <ReportGroups urgent={tab === "urgent"} role={staff.role} />}
      {tab === "posts" && <PendingPosts />}
      {tab === "comments" && <CommentsQueue />}
      {tab === "live" && <LivePosts q={sp.q ?? ""} role={staff.role} />}
    </div>
  );
}

function ActionForms({ postId, urgent, role }: { postId: string; urgent: boolean; role: string }) {
  return (
    <div className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
      <form action={dismissReports} className="grid content-start gap-2">
        <input type="hidden" name="postId" value={postId} />
        <input name="note" placeholder="Why dismissed (optional)" maxLength={300} className={inputCls} />
        <button className={`${btn} border border-line`}>Dismiss reports{urgent ? " and restore post" : ""}</button>
      </form>
      <form action={takedownPost} className="grid content-start gap-2">
        <input type="hidden" name="postId" value={postId} />
        <input name="note" placeholder="Reason for takedown" maxLength={300} className={inputCls} />
        {urgent
          ? <p className="text-xs text-muted">Urgent takedown keeps the media as private evidence (never shown). See Quarantine.</p>
          : <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="quarantine" /> Keep media as evidence instead of deleting</label>}
        {role === "admin" && <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="ban" /> Also ban the author</label>}
        <button className={`${btn} bg-rose text-white`}>Take down post</button>
      </form>
    </div>
  );
}

async function ReportGroups({ urgent, role }: { urgent: boolean; role: string }) {
  const groups = await loadGroups(urgent);
  const media = await Promise.all(groups.map((g) => signedMediaForPost(g.post.id, 3600)));
  if (!groups.length) return <p className="text-muted">{urgent ? "No urgent reports. " : "No open reports. "}Nice.</p>;
  return (
    <div className="grid gap-5">
      {urgent && <p className="rounded-xl border border-rose/50 bg-rose/10 p-3 text-sm text-rose">These posts were hidden automatically when reported. Review the oldest first. Dismiss restores the post; takedown removes it.</p>}
      {groups.map((g, i) => (
        <article key={g.post.id} className={`rounded-2xl border bg-card p-5 ${urgent ? "border-rose/60" : "border-line"}`}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            {urgent ? <Badge tone="danger">URGENT</Badge> : <Badge tone="warn">Report</Badge>}
            {g.post.held_at && <Badge tone="info">hidden from site</Badge>}
            {g.post.status !== "approved" && <Badge>{g.post.status}</Badge>}
            <span>waiting {ago(g.oldest)}</span><span>·</span><span>{g.post.categories?.name}</span><span>·</span><span>@{g.post.profiles?.username}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(g.reasons).map(([r, c]) => <Badge key={r} tone={urgent ? "danger" : "warn"}>{REASON_LABEL[r] ?? r} × {c}</Badge>)}
          </div>
          {g.details.length > 0 && <ul className="mt-3 grid gap-1 text-sm text-muted">{g.details.map((d, k) => <li key={k}>“{d}”</li>)}</ul>}
          <h2 className="mt-4 text-lg font-semibold">{g.post.title ?? "Untitled"}</h2>
          {g.post.body && <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-200">{g.post.body}</p>}
          <MediaGallery items={media[i]} />
          <ActionForms postId={g.post.id} urgent={urgent} role={role} />
        </article>
      ))}
    </div>
  );
}

async function PendingPosts() {
  const { data } = await supabaseAdmin().from("posts")
    .select("id,title,body,preview_text,created_at,consent_confirmed_at,categories(name),profiles!posts_author_id_fkey(username)")
    .eq("status", "pending").order("created_at", { ascending: true }).limit(15);
  const posts = (data ?? []) as unknown as (PostBits & { preview_text: string | null; created_at: string; consent_confirmed_at: string | null })[];
  const media = await Promise.all(posts.map((p) => signedMediaForPost(p.id, 3600)));
  if (!posts.length) return <p className="text-muted">Nothing waiting for review.</p>;
  return (
    <div className="grid gap-5">
      <p className="text-sm text-muted">Watch every video in full and check every image before approving. Reject anything involving a possible minor, missing consent, or illegal content.</p>
      {posts.map((p, i) => (
        <article key={p.id} className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{p.categories?.name}</span><span>·</span><span>@{p.profiles?.username}</span><span>·</span><span>waiting {ago(p.created_at)}</span>
            {!p.consent_confirmed_at && <span className="text-rose">· no consent confirmation</span>}
          </div>
          <h2 className="mt-2 text-lg font-semibold">{p.title ?? "Untitled"}</h2>
          {p.preview_text && <p className="mt-1 text-sm text-muted">Feed summary: {p.preview_text}</p>}
          {p.body && <p className="mt-3 whitespace-pre-wrap text-sm text-neutral-200">{p.body}</p>}
          <MediaGallery items={media[i]} />
          <div className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <form action={approvePost}><input type="hidden" name="id" value={p.id} /><button className={`${btn} w-full bg-emerald-600`}>Approve</button></form>
            <form action={rejectPost} className="grid gap-2">
              <input type="hidden" name="id" value={p.id} />
              <select name="reason" className={inputCls}>{REJECT_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              <input name="note" placeholder="Note to the poster (optional)" maxLength={300} className={inputCls} />
              <button className={`${btn} border border-rose text-rose`}>Reject and delete media</button>
            </form>
          </div>
        </article>
      ))}
    </div>
  );
}

async function LivePosts({ q, role }: { q: string; role: string }) {
  let query = supabaseAdmin().from("posts")
    .select("id,title,body,status,held_at,categories(name),profiles!posts_author_id_fkey(username)")
    .eq("status", "approved").order("published_at", { ascending: false }).limit(15);
  if (q.trim()) query = query.ilike("title", `%${q.trim().replace(/[%_]/g, "")}%`);
  const { data } = await query;
  const posts = (data ?? []) as unknown as PostBits[];
  return (
    <div className="grid gap-4">
      <form className="flex gap-2"><input type="hidden" name="tab" value="live" />
        <input name="q" defaultValue={q} placeholder="Search live posts by title" className={`${inputCls} flex-1`} />
        <button className={`${btn} border border-line`}>Search</button></form>
      {posts.map((p) => (
        <article key={p.id} className="rounded-2xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>{p.categories?.name}</span><span>·</span><span>@{p.profiles?.username}</span>{p.held_at && <Badge tone="info">hidden</Badge>}
          </div>
          <h2 className="mt-2 font-semibold">{p.title ?? "Untitled"}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{p.body}</p>
          <ActionForms postId={p.id} urgent={false} role={role} />
        </article>
      ))}
      {!posts.length && <p className="text-muted">No live posts match.</p>}
    </div>
  );
}
