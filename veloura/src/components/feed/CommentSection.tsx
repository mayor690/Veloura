import Link from "next/link";
import { CommentForm } from "./CommentForm";

export type CommentRow = { id: string; body: string; created_at: string; profiles: { username: string } | null };

export function CommentSection({ postId, comments, loggedIn }: { postId: string; comments: CommentRow[]; loggedIn: boolean }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="font-semibold">Comments</h2>
      <ul className="mt-4 grid gap-3">
        {comments.map((c) => (
          <li key={c.id} className="rounded-xl border border-line bg-card p-3 text-sm">
            <p className="text-xs text-muted">@{c.profiles?.username ?? "anon"} · {new Date(c.created_at).toLocaleDateString("en-NG")}</p>
            <p className="mt-1 whitespace-pre-wrap">{c.body}</p>
          </li>
        ))}
        {comments.length === 0 && <li className="text-sm text-muted">No comments yet.</li>}
      </ul>
      <div className="mt-4">
        {loggedIn ? <CommentForm postId={postId} /> : <p className="text-sm text-muted"><Link href="/login" className="text-purple underline">Log in</Link> to comment.</p>}
      </div>
    </section>
  );
}
