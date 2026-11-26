import { createClient } from "@/lib/supabase/server";
import { getViewer, accessExpiry } from "@/lib/viewer";
import { getPublicSettings } from "@/lib/settings";
import { naira } from "@/lib/constants";
import { CategoryCard } from "@/components/home/CategoryCard";
import { FullPassBanner } from "@/components/home/FullPassBanner";
import { AdSlot } from "@/components/ads/AdSlot";

type Cat = { id: string; slug: string; name: string; description: string | null; price_kobo: number | null };

export default async function Home() {
  const supabase = await createClient();
  const [{ data }, viewer, settings] = await Promise.all([
    supabase.from("categories").select("id,slug,name,description,price_kobo").order("sort_order"),
    getViewer(),
    getPublicSettings(),
  ]);
  const categories = (data ?? []) as Cat[];

  return (
    <main className="mx-auto max-w-6xl px-4 pt-8">
      <section className="text-center md:py-6">
        <h1 className="font-display text-4xl leading-tight md:text-6xl">
          Private. Anonymous. <span className="text-accent-gradient">Unlocked daily.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted">
          Confessions, tips and gigs from real people. Unlock a category from {naira(settings.dailyPrice)} for 24 hours.
        </p>
      </section>

      <FullPassBanner
        price={settings.fullPassPrice}
        expires={viewer?.fullPassExpires?.toISOString() ?? null}
        loggedIn={!!viewer}
        balanceKobo={viewer?.balanceKobo ?? 0}
        minTopup={settings.minTopup}
        dailyPrice={settings.dailyPrice}
      />

      <AdSlot slot="home_top" className="mt-6" />

      <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-5 lg:grid-cols-4">
        {categories.map((c, i) => (
          <CategoryCard
            key={c.id}
            index={i}
            slug={c.slug}
            name={c.name}
            description={c.description}
            price={c.price_kobo ?? settings.dailyPrice}
            expires={accessExpiry(viewer, c.id)?.toISOString() ?? null}
          />
        ))}
      </section>
    </main>
  );
}
