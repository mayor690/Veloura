import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, accessExpiry } from "@/lib/viewer";
import { getPublicSettings } from "@/lib/settings";
import { PostCard } from "@/components/feed/PostCard";
import { AdSlot, SponsoredPostCard, getSponsoredForCategory } from "@/components/ads/AdSlot";
import { timeLeft } from "@/lib/constants";

type Post = { id: string; title: string | null; preview_text: string | null };

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: cat } = await supabase
    .from("categories")
    .select("id,slug,name,description,price_kobo")
    .eq("slug", slug)
    .eq("is_active", true)
    .single();
  if (!cat) notFound();

  const [viewer, settings, { data }, sponsored] = await Promise.all([
    getViewer(),
    getPublicSettings(),
    supabase
      .from("posts")
      .select("id,title,preview_text,published_at,view_count")
      .eq("category_id", cat.id)
      .eq("status", "approved")
      .order("published_at", { ascending: false })
      .limit(30),
    getSponsoredForCategory(cat.id),
  ]);
  const posts = (data ?? []) as Post[];

  const expiry = accessExpiry(viewer, cat.id);
  const category = { id: cat.id as string, name: cat.name as string, price: (cat.price_kobo ?? settings.dailyPrice) as number };

  const items: React.ReactNode[] = posts.map((p) => (
    <PostCard key={p.id} post={p} unlocked={!!expiry} category={category} loggedIn={!!viewer}
      balanceKobo={viewer?.balanceKobo ?? 0} dailyPrice={settings.dailyPrice} fullPassPrice={settings.fullPassPrice} minTopup={settings.minTopup} />
  ));
  // A banner ad after the 4th post, and a sponsored post at its configured position (1-based).
  if (items.length >= 4) items.splice(4, 0, <AdSlot key="ad-inline" slot="feed_inline" />);
  if (sponsored && items.length > 0) items.splice(Math.min(sponsored.placement_position, items.length), 0, <SponsoredPostCard key="sponsored" post={sponsored} />);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="font-display text-3xl md:text-4xl">{cat.name}</h1>
      <p className="mt-1 text-muted">{cat.description}</p>
      {expiry && (
        <p className="mt-3 inline-block rounded-full bg-emerald-500/15 px-3 py-1 text-xs text-emerald-300">
          Unlocked, {timeLeft(expiry)}
        </p>
      )}
      <div className="mt-6 grid gap-4">
        {items.length ? items : <p className="text-muted">Nothing here yet. Be the first to post.</p>}
      </div>
    </main>
  );
}
