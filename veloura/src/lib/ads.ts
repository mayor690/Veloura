import "server-only";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "@/lib/r2/client";
import { putObject } from "@/lib/r2/storage";
import { sniffMime } from "@/lib/media/sniff";

export type AdRow = {
  id: string; slot_key: string; advertiser: string; title: string | null; body: string | null;
  image_key: string | null; target_url: string;
};
export type SponsoredRow = {
  id: string; advertiser: string; category_id: string | null; title: string; body: string | null;
  image_key: string | null; cta_label: string; cta_url: string; placement_position: number;
};

const nowIso = () => new Date().toISOString();
const pick = <T,>(xs: T[]) => (xs.length ? xs[Math.floor(Math.random() * xs.length)] : null);

async function adsOn() {
  const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", "ads_enabled").maybeSingle();
  return data?.value === true;
}

export async function getAdForSlot(slotKey: string): Promise<AdRow | null> {
  if (!(await adsOn())) return null;
  const admin = supabaseAdmin();
  const { data: slot } = await admin.from("ad_slots").select("is_enabled").eq("key", slotKey).maybeSingle();
  if (!slot?.is_enabled) return null;
  const now = nowIso();
  const { data } = await admin.from("ads")
    .select("id,slot_key,advertiser,title,body,image_key,target_url")
    .eq("slot_key", slotKey).eq("is_active", true)
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
    .limit(20);
  return pick((data ?? []) as AdRow[]);
}

export async function getSponsoredForCategory(categoryId: string): Promise<SponsoredRow | null> {
  if (!(await adsOn())) return null;
  const now = nowIso();
  const { data } = await supabaseAdmin().from("sponsored_posts")
    .select("id,advertiser,category_id,title,body,image_key,cta_label,cta_url,placement_position")
    .eq("is_active", true)
    .or(`category_id.is.null,category_id.eq.${categoryId}`)
    .or(`starts_at.is.null,starts_at.lte.${now}`).or(`ends_at.is.null,ends_at.gte.${now}`)
    .limit(20);
  return pick((data ?? []) as SponsoredRow[]);
}

/** Validates and stores an ad creative in R2 (private). Served through /api/ads/img. */
export async function saveAdImage(file: File): Promise<{ key: string } | { error: string }> {
  if (!r2Configured()) return { error: "R2 is not configured." };
  if (file.size === 0) return { error: "Choose an image." };
  if (file.size > 2 * 1024 * 1024) return { error: "Ad images can be at most 2 MB." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes.slice(0, 32));
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : null;
  if (!mime || !ext) return { error: "Ad images must be JPEG, PNG or WebP." };
  const key = `ads/${randomUUID()}.${ext}`;
  await putObject(key, bytes, mime);
  return { key };
}

export function safeUrl(u: string): string | null {
  try {
    const url = new URL(u);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
