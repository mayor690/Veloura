import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge, btn, inputCls } from "@/components/admin/ui";
import { createSponsored, deleteSponsored, toggleSponsored } from "../ads/actions";

type S = { id: string; advertiser: string; title: string; is_active: boolean; impressions: number; clicks: number; placement_position: number; categories: { name: string } | null; cta_url: string };

export default async function Sponsored({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (!(await requireAdmin())) notFound();
  const { e } = await searchParams;
  const admin = supabaseAdmin();
  const [{ data: cats }, { data }] = await Promise.all([
    admin.from("categories").select("id,name").order("sort_order"),
    admin.from("sponsored_posts").select("id,advertiser,title,is_active,impressions,clicks,placement_position,cta_url,categories(name)").order("created_at", { ascending: false }),
  ]);
  return (
    <div className="grid gap-6">
      <h1 className="font-display text-3xl">Sponsored posts</h1>
      <p className="text-sm text-muted">Shown inside category feeds, labelled &ldquo;Sponsored&rdquo;. They only appear while ads are switched on (Ads page).</p>
      {e && <p className="rounded-xl bg-rose/15 p-3 text-sm text-rose">{e}</p>}
      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">New sponsored post</h2>
        <form action={createSponsored} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input name="advertiser" placeholder="Advertiser" required className={inputCls} />
          <input name="title" placeholder="Title" required maxLength={120} className={inputCls} />
          <textarea name="body" placeholder="Text (optional)" maxLength={600} rows={3} className={`${inputCls} h-auto py-2 sm:col-span-2`} />
          <input name="cta_label" placeholder="Button label (Learn more)" maxLength={30} className={inputCls} />
          <input name="cta_url" type="url" placeholder="https:// link" required className={inputCls} />
          <select name="category_id" className={inputCls}><option value="">All categories</option>{((cats ?? []) as { id: string; name: string }[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <label className="grid gap-1 text-xs text-muted">Show after every N-th post<input name="placement_position" type="number" min={1} max={20} defaultValue={3} className={inputCls} /></label>
          <label className="grid gap-1 text-xs text-muted">Start (Lagos time, optional)<input name="starts_at" type="datetime-local" className={inputCls} /></label>
          <label className="grid gap-1 text-xs text-muted">End (Lagos time, optional)<input name="ends_at" type="datetime-local" className={inputCls} /></label>
          <label className="grid gap-1 text-xs text-muted sm:col-span-2">Image (JPEG, PNG or WebP, max 2 MB)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" /></label>
          <button className={`${btn} bg-accent-gradient sm:col-span-2`}>Create</button>
        </form>
      </section>
      {((data ?? []) as unknown as S[]).map((s) => (
        <article key={s.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2"><Badge tone={s.is_active ? "good" : "default"}>{s.is_active ? "active" : "paused"}</Badge>
            <span className="font-semibold">{s.title}</span><span className="text-muted">· {s.advertiser} · {s.categories?.name ?? "all categories"} · position {s.placement_position}</span></div>
          <p className="mt-1 text-xs text-muted">{s.impressions.toLocaleString()} impressions · {s.clicks.toLocaleString()} clicks · CTR {s.impressions ? ((s.clicks / s.impressions) * 100).toFixed(2) : "0.00"}%</p>
          <div className="mt-3 flex gap-2">
            <form action={toggleSponsored}><input type="hidden" name="id" value={s.id} /><input type="hidden" name="active" value={String(!s.is_active)} /><button className={`${btn} border border-line`}>{s.is_active ? "Pause" : "Resume"}</button></form>
            <form action={deleteSponsored}><input type="hidden" name="id" value={s.id} /><button className={`${btn} border border-rose text-rose`}>Delete</button></form>
          </div>
        </article>
      ))}
    </div>
  );
}
