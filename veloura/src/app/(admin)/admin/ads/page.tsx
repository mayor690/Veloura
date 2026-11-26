import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { Badge, btn, inputCls } from "@/components/admin/ui";
import { createAd, deleteAd, setAdsEnabled, toggleAd, toggleSlot } from "./actions";

type Ad = { id: string; slot_key: string; advertiser: string; title: string | null; target_url: string; is_active: boolean; impressions: number; clicks: number; starts_at: string | null; ends_at: string | null; image_key: string | null };
type Slot = { key: string; label: string; is_enabled: boolean };

export default async function AdsAdmin({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  if (!(await requireAdmin())) notFound();
  const { e } = await searchParams;
  const admin = supabaseAdmin();
  const [{ data: on }, { data: slots }, { data: ads }] = await Promise.all([
    admin.from("site_settings").select("value").eq("key", "ads_enabled").maybeSingle(),
    admin.from("ad_slots").select("key,label,is_enabled").order("key"),
    admin.from("ads").select("id,slot_key,advertiser,title,target_url,is_active,impressions,clicks,starts_at,ends_at,image_key").order("created_at", { ascending: false }),
  ]);
  const enabled = on?.value === true;

  return (
    <div className="grid gap-6">
      <h1 className="font-display text-3xl">Ads</h1>
      {e && <p className="rounded-xl bg-rose/15 p-3 text-sm text-rose">{e}</p>}

      <section className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 ${enabled ? "border-emerald-500/50" : "border-line"} bg-card`}>
        <div><p className="font-semibold">Ads are {enabled ? "ON" : "OFF"} sitewide</p><p className="text-sm text-muted">Applies to banner ads and sponsored posts. Off hides everything immediately.</p></div>
        <form action={setAdsEnabled}><input type="hidden" name="enabled" value={String(!enabled)} />
          <button className={`${btn} ${enabled ? "border border-line" : "bg-accent-gradient"}`}>{enabled ? "Turn ads off" : "Turn ads on"}</button></form>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">Placements</h2>
        <ul className="mt-3 grid gap-2">
          {((slots ?? []) as Slot[]).map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
              <span>{s.label} <span className="text-muted">({s.key})</span></span>
              <form action={toggleSlot}><input type="hidden" name="key" value={s.key} /><input type="hidden" name="enabled" value={String(!s.is_enabled)} />
                <button className={`rounded-full px-3 py-1 text-xs ${s.is_enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-line text-muted"}`}>{s.is_enabled ? "On" : "Off"}</button></form>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl border border-line bg-card p-5">
        <h2 className="font-semibold">New banner / native ad</h2>
        <form action={createAd} className="mt-3 grid gap-2 sm:grid-cols-2">
          <select name="slot_key" className={inputCls}>{((slots ?? []) as Slot[]).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
          <input name="advertiser" placeholder="Advertiser" required className={inputCls} />
          <input name="title" placeholder="Headline" maxLength={100} className={inputCls} />
          <input name="target_url" type="url" placeholder="https:// link" required className={inputCls} />
          <input name="body" placeholder="Short text (optional)" maxLength={300} className={`${inputCls} sm:col-span-2`} />
          <label className="grid gap-1 text-xs text-muted">Start (Lagos time, optional)<input name="starts_at" type="datetime-local" className={inputCls} /></label>
          <label className="grid gap-1 text-xs text-muted">End (Lagos time, optional)<input name="ends_at" type="datetime-local" className={inputCls} /></label>
          <label className="grid gap-1 text-xs text-muted sm:col-span-2">Image (JPEG, PNG or WebP, max 2 MB)<input name="image" type="file" accept="image/jpeg,image/png,image/webp" className="text-sm" /></label>
          <button className={`${btn} bg-accent-gradient sm:col-span-2`}>Create ad</button>
        </form>
      </section>

      <section className="grid gap-3">
        <h2 className="font-semibold">Campaigns</h2>
        {((ads ?? []) as Ad[]).map((a) => (
          <article key={a.id} className="rounded-2xl border border-line bg-card p-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={a.is_active ? "good" : "default"}>{a.is_active ? "active" : "paused"}</Badge>
              <span className="font-semibold">{a.advertiser}</span><span className="text-muted">· {a.title} · {a.slot_key}</span>
            </div>
            <p className="mt-1 break-all text-xs text-muted">{a.target_url}</p>
            <p className="mt-1 text-xs text-muted">{a.impressions.toLocaleString()} impressions · {a.clicks.toLocaleString()} clicks · CTR {a.impressions ? ((a.clicks / a.impressions) * 100).toFixed(2) : "0.00"}%
              {a.starts_at ? ` · from ${new Date(a.starts_at).toLocaleDateString("en-NG")}` : ""}{a.ends_at ? ` · until ${new Date(a.ends_at).toLocaleDateString("en-NG")}` : ""}</p>
            <div className="mt-3 flex gap-2">
              <form action={toggleAd}><input type="hidden" name="id" value={a.id} /><input type="hidden" name="active" value={String(!a.is_active)} /><button className={`${btn} border border-line`}>{a.is_active ? "Pause" : "Resume"}</button></form>
              <form action={deleteAd}><input type="hidden" name="id" value={a.id} /><button className={`${btn} border border-rose text-rose`}>Delete</button></form>
            </div>
          </article>
        ))}
        {!ads?.length && <p className="text-muted">No ads yet.</p>}
      </section>
      <p className="text-xs text-muted">Impression and click counts are approximate (bots and repeat views are not filtered). Do not bill advertisers from them without a stricter system.</p>
    </div>
  );
}
