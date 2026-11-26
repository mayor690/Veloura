import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { btn } from "@/components/admin/ui";
import { purgeQuarantine } from "./actions";

type Row = { post_id: string; size_bytes: number; type: string; posts: { title: string | null; removed_at: string | null; removal_reason: string | null } | null };

export default async function Quarantine() {
  if (!(await requireAdmin())) notFound();
  const { data } = await supabaseAdmin().from("post_media")
    .select("post_id,size_bytes,type,posts(title,removed_at,removal_reason)").eq("status", "quarantined").limit(500);
  const byPost = new Map<string, { files: number; bytes: number; title: string | null; at: string | null; why: string | null }>();
  for (const r of (data ?? []) as unknown as Row[]) {
    const g = byPost.get(r.post_id) ?? { files: 0, bytes: 0, title: r.posts?.title ?? null, at: r.posts?.removed_at ?? null, why: r.posts?.removal_reason ?? null };
    g.files += 1; g.bytes += Number(r.size_bytes); byPost.set(r.post_id, g);
  }
  return (
    <div className="grid gap-4">
      <h1 className="font-display text-3xl">Quarantine</h1>
      <p className="rounded-xl border border-line bg-card p-4 text-sm text-muted">
        Media from urgent takedowns is kept here in the private bucket and is never displayed, not even to staff. Do not delete it until you have legal advice on your obligations to report
        and retain material involving suspected minors or non-consensual content in the places you operate. Deleting is permanent.
      </p>
      {byPost.size === 0 && <p className="text-muted">Nothing in quarantine.</p>}
      {[...byPost.entries()].map(([postId, g]) => (
        <div key={postId} className="rounded-2xl border border-line bg-card p-4">
          <p className="font-semibold">{g.title ?? "Untitled"}</p>
          <p className="mt-1 text-xs text-muted">Post {postId} · {g.files} file(s), {(g.bytes / 1048576).toFixed(1)} MB · removed {g.at ? new Date(g.at).toLocaleString("en-NG") : "?"}{g.why ? ` · ${g.why}` : ""}</p>
          <form action={purgeQuarantine} className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="postId" value={postId} />
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="confirm" required /> I have legal guidance and want to permanently delete this media</label>
            <button className={`${btn} border border-rose text-rose`}>Delete permanently</button>
          </form>
        </div>
      ))}
    </div>
  );
}
