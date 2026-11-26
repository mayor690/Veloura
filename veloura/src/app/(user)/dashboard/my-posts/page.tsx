import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Row = { id: string; title: string | null; status: string; held_at: string | null; rejection_reason: string | null; created_at: string; categories: { name: string } | null };

const BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-rose/15 text-rose",
  removed: "bg-line text-muted",
};
const LABEL: Record<string, string> = { pending: "In review", approved: "Live", rejected: "Not approved", removed: "Removed" };

export default async function MyPosts() {
  const v = await getViewer();
  if (!v) redirect("/login");
  // author_id and body are hidden from browser queries, so a signed-in user's own list is read on the server.
  const { data } = await supabaseAdmin()
    .from("posts")
    .select("id,title,status,held_at,rejection_reason,created_at,categories(name)")
    .eq("author_id", v.id)
    .order("created_at", { ascending: false })
    .limit(50);
  const posts = (data ?? []) as unknown as Row[];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/dashboard" className="text-sm text-muted">&larr; Dashboard</Link>
      <div className="mt-3 flex items-center justify-between">
        <h1 className="font-display text-3xl">My posts</h1>
        <Link href="/dashboard/create" className="rounded-full bg-accent-gradient px-4 py-2 text-sm font-medium">New post</Link>
      </div>
      <ul className="mt-6 grid gap-3">
        {posts.length === 0 && <li className="text-muted">You haven&apos;t posted yet.</li>}
        {posts.map((p) => (
          <li key={p.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{p.title ?? "Untitled"}</p>
                <p className="text-xs text-muted">{p.categories?.name} · {new Date(p.created_at).toLocaleDateString("en-NG")}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${p.held_at ? BADGE.pending : BADGE[p.status] ?? "bg-line"}`}>{p.held_at ? "Under review" : LABEL[p.status] ?? p.status}</span>
            </div>
            {p.status === "rejected" && p.rejection_reason && <p className="mt-2 text-sm text-rose">Reason: {p.rejection_reason}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
