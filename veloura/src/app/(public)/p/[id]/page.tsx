import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { signedMediaForPost } from "@/lib/r2/media";
import { MediaGallery } from "@/components/media/MediaGallery";
import { ReportButton } from "@/components/feed/ReportButton";
import { AdSlot } from "@/components/ads/AdSlot";
import { ReactionBar } from "@/components/feed/ReactionBar";
import { CommentSection, type CommentRow } from "@/components/feed/CommentSection";
import type { Engagement } from "@/app/(public)/engage-actions";
import { TipButton } from "@/components/feed/TipButton";
import { loadTipLimits } from "@/app/(public)/tip-actions";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  // RLS hides posts that are not approved or that are on hold after a report.
  const { data: meta } = await supabase
    .from("posts")
    .select("id,title,category_id,published_at")
    .eq("id", id)
    .eq("status", "approved")
    .single();
  if (!meta) notFound();

  // Veloura is premium-only: every post needs an active unlock (the author may open their own post).
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = supabaseAdmin();
  const [{ data: access }, { data: prof }, { data: own }] = await Promise.all([
    admin.rpc("has_access", { p_user: user.id, p_category: meta.category_id }),
    admin.from("profiles").select("is_banned").eq("id", user.id).single(),
    admin.from("posts").select("author_id,body").eq("id", id).single(),
  ]);
  const isAuthor = own?.author_id === user.id;
  if (prof?.is_banned || !(access === true || isAuthor)) redirect("/");
  if (!isAuthor) await admin.rpc("record_post_view", { p_post: id, p_viewer: user.id }); // one paid view per user, post and day

  // Signed media URLs and comments are produced only here, after the access check has passed.
  const [media, { data: eng }, { data: comments }, tip, { data: bal }] = await Promise.all([
    signedMediaForPost(id),
    admin.rpc("post_engagement", { p_post: id, p_user: user.id }),
    admin.from("comments").select("id,body,created_at,profiles!comments_user_id_fkey(username)").eq("post_id", id).eq("status", "approved").order("created_at").limit(100),
    loadTipLimits(),
    supabase.rpc("my_wallet_balance"),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-3xl">{meta.title}</h1>
        <ReportButton postId={id} loggedIn className="shrink-0" />
      </div>
      {own?.body && <div className="mt-6 whitespace-pre-wrap leading-relaxed text-neutral-200">{own.body}</div>}
      <MediaGallery items={media} />
      <ReactionBar postId={id} initial={(eng ?? { like: 0, love: 0, fire: 0, mine: null, comments: 0 }) as Engagement} loggedIn
        extra={tip.enabled && !isAuthor ? <TipButton postId={id} balanceKobo={Number(bal ?? 0)} minKobo={tip.minKobo} maxKobo={tip.maxKobo} feePct={tip.feePct} /> : null} />
      <CommentSection postId={id} comments={(comments ?? []) as unknown as CommentRow[]} loggedIn />
      <AdSlot slot="post_bottom" className="mt-8" />
    </main>
  );
}
