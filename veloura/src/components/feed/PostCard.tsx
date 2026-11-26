import Link from "next/link";
import { LockedOverlay } from "./LockedOverlay";
import { ReportButton } from "./ReportButton";

type Post = { id: string; title: string | null; preview_text: string | null };
type Props = {
  post: Post;
  unlocked: boolean;
  loggedIn: boolean;
  category: { id: string; name: string; price: number };
  balanceKobo: number;
  dailyPrice: number;
  fullPassPrice: number;
  minTopup: number;
};

export function PostCard({ post, unlocked, ...unlock }: Props) {
  return (
    <article className="relative overflow-hidden rounded-2xl border border-line bg-card p-5 pb-12">
      {unlocked ? (
        <Link href={`/p/${post.id}`} className="block transition active:opacity-80">
          <h3 className="font-semibold">{post.title ?? "Untitled"}</h3>
          {post.preview_text && <p className="mt-2 text-sm text-muted">{post.preview_text}</p>}
        </Link>
      ) : (
        <>
          <h3 className="font-semibold">{post.title ?? "Untitled"}</h3>
          {/* Placeholder lines only: the real summary is never sent to someone who hasn't paid. */}
          <div className="mt-3 grid gap-2" aria-hidden>
            <div className="h-3 w-full rounded bg-line" /><div className="h-3 w-5/6 rounded bg-line" /><div className="h-3 w-2/3 rounded bg-line" />
          </div>
          <LockedOverlay {...unlock} />
        </>
      )}
      <ReportButton postId={post.id} loggedIn={unlock.loggedIn} className="absolute bottom-3 right-3 z-10" />
    </article>
  );
}
