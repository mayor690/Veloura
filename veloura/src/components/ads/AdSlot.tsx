import { getAdForSlot, getSponsoredForCategory, type AdRow, type SponsoredRow } from "@/lib/ads";
import { AdBox } from "./AdBox";

/* eslint-disable @next/next/no-img-element */
export function AdCard({ ad }: { ad: AdRow }) {
  return (
    <AdBox kind="ad" id={ad.id} className="overflow-hidden rounded-2xl border border-line bg-card">
      <a href={`/api/ads/click?t=ad&id=${ad.id}`} target="_blank" rel="sponsored noopener noreferrer" className="block">
        {ad.image_key && <img src={`/api/ads/img?t=ad&id=${ad.id}`} alt="" loading="lazy" className="w-full object-cover" />}
        <div className="p-4">
          <span className="text-[10px] uppercase tracking-wide text-muted">Ad · {ad.advertiser}</span>
          {ad.title && <p className="mt-1 font-semibold">{ad.title}</p>}
          {ad.body && <p className="mt-1 text-sm text-muted">{ad.body}</p>}
        </div>
      </a>
    </AdBox>
  );
}

/** Server component: renders nothing when ads are off, the slot is off, or no campaign is live. */
export async function AdSlot({ slot, className }: { slot: string; className?: string }) {
  const ad = await getAdForSlot(slot);
  if (!ad) return null;
  return <div className={className}><AdCard ad={ad} /></div>;
}

export function SponsoredPostCard({ post }: { post: SponsoredRow }) {
  return (
    <AdBox kind="sp" id={post.id} className="overflow-hidden rounded-2xl border border-purple/40 bg-card">
      {post.image_key && <img src={`/api/ads/img?t=sp&id=${post.id}`} alt="" loading="lazy" className="w-full object-cover" />}
      <div className="p-5">
        <span className="rounded-full bg-purple/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-purple">Sponsored · {post.advertiser}</span>
        <h3 className="mt-3 font-semibold">{post.title}</h3>
        {post.body && <p className="mt-2 text-sm text-muted">{post.body}</p>}
        <a href={`/api/ads/click?t=sp&id=${post.id}`} target="_blank" rel="sponsored noopener noreferrer"
           className="mt-4 inline-block rounded-xl bg-accent-gradient px-5 py-2.5 text-sm font-semibold">{post.cta_label}</a>
      </div>
    </AdBox>
  );
}

export { getSponsoredForCategory };
