"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { audit } from "@/lib/admin/audit";
import { saveAdImage, safeUrl } from "@/lib/ads";
import { r2Configured } from "@/lib/r2/client";
import { deleteObject } from "@/lib/r2/storage";

const text = (fd: FormData, k: string, max: number) => String(fd.get(k) ?? "").trim().slice(0, max);
/** <input type="datetime-local"> has no time zone; treat it as Lagos time (UTC+1, no daylight saving). */
const lagos = (s: string) => (s ? new Date(`${s}:00+01:00`).toISOString() : null);
const httpsUrl = (s: string) => { const u = safeUrl(s); return u && u.startsWith("https://") ? u : null; };
const refresh = () => { revalidatePath("/admin/ads"); revalidatePath("/admin/sponsored"); revalidatePath("/", "layout"); };

async function imageFrom(fd: FormData, back: string): Promise<string | null> {
  const f = fd.get("image");
  if (!(f instanceof File) || f.size === 0) return null;
  const r = await saveAdImage(f);
  if ("error" in r) redirect(`${back}?e=${encodeURIComponent(r.error)}`);
  return r.key;
}

export async function setAdsEnabled(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const on = fd.get("enabled") === "true";
  await supabaseAdmin().from("site_settings").upsert({ key: "ads_enabled", value: on, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  await audit(staff.id, "ads.toggle", "settings", "ads_enabled", { on });
  refresh();
}

export async function toggleSlot(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const key = String(fd.get("key") ?? "");
  await supabaseAdmin().from("ad_slots").update({ is_enabled: fd.get("enabled") === "true" }).eq("key", key);
  await audit(staff.id, "ads.slot", "ad_slot", key, { enabled: fd.get("enabled") === "true" });
  refresh();
}

export async function createAd(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const url = httpsUrl(text(fd, "target_url", 500));
  const advertiser = text(fd, "advertiser", 80);
  if (!url || !advertiser) redirect("/admin/ads?e=Enter+an+advertiser+and+an+https+link");
  const image_key = await imageFrom(fd, "/admin/ads");
  const { data } = await supabaseAdmin().from("ads").insert({
    slot_key: text(fd, "slot_key", 40), advertiser, title: text(fd, "title", 100) || null, body: text(fd, "body", 300) || null,
    image_key, target_url: url, starts_at: lagos(text(fd, "starts_at", 20)), ends_at: lagos(text(fd, "ends_at", 20)),
  }).select("id").single();
  if (data) await audit(staff.id, "ads.create", "ad", data.id, { advertiser });
  refresh();
}

export async function createSponsored(fd: FormData): Promise<void> {
  const staff = await requireAdmin();
  if (!staff) return;
  const url = httpsUrl(text(fd, "cta_url", 500));
  const advertiser = text(fd, "advertiser", 80);
  const title = text(fd, "title", 120);
  if (!url || !advertiser || !title) redirect("/admin/sponsored?e=Enter+an+advertiser%2C+a+title+and+an+https+link");
  const image_key = await imageFrom(fd, "/admin/sponsored");
  const cat = text(fd, "category_id", 40);
  const { data } = await supabaseAdmin().from("sponsored_posts").insert({
    advertiser, title, body: text(fd, "body", 600) || null, image_key, cta_url: url, cta_label: text(fd, "cta_label", 30) || "Learn more",
    category_id: cat || null, placement_position: Math.max(1, Math.min(20, Number(fd.get("placement_position")) || 3)),
    starts_at: lagos(text(fd, "starts_at", 20)), ends_at: lagos(text(fd, "ends_at", 20)),
  }).select("id").single();
  if (data) await audit(staff.id, "sponsored.create", "sponsored_post", data.id, { advertiser, title });
  refresh();
}

async function toggle(table: "ads" | "sponsored_posts", fd: FormData, action: string) {
  const staff = await requireAdmin();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  await supabaseAdmin().from(table).update({ is_active: fd.get("active") === "true" }).eq("id", id);
  await audit(staff.id, action, table, id, { active: fd.get("active") === "true" });
  refresh();
}
export async function toggleAd(fd: FormData): Promise<void> { await toggle("ads", fd, "ads.toggle_campaign"); }
export async function toggleSponsored(fd: FormData): Promise<void> { await toggle("sponsored_posts", fd, "sponsored.toggle"); }

async function remove(table: "ads" | "sponsored_posts", fd: FormData, action: string) {
  const staff = await requireAdmin();
  if (!staff) return;
  const id = String(fd.get("id") ?? "");
  const admin = supabaseAdmin();
  const { data } = await admin.from(table).select("image_key").eq("id", id).single();
  if (data?.image_key && r2Configured()) { try { await deleteObject(data.image_key); } catch (e) { console.error("[ads] image delete failed", e); } }
  await admin.from(table).delete().eq("id", id);
  await audit(staff.id, action, table, id);
  refresh();
}
export async function deleteAd(fd: FormData): Promise<void> { await remove("ads", fd, "ads.delete"); }
export async function deleteSponsored(fd: FormData): Promise<void> { await remove("sponsored_posts", fd, "sponsored.delete"); }
