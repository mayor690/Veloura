import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { safeUrl } from "@/lib/ads";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Counts the click, then redirects to the advertiser. The target comes only from our database, never from the URL. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const t = u.searchParams.get("t");
  const id = u.searchParams.get("id") ?? "";
  const home = new URL("/", req.url);
  if (!UUID.test(id) || (t !== "ad" && t !== "sp")) return NextResponse.redirect(home);

  const admin = supabaseAdmin();
  const { data } = t === "ad"
    ? await admin.from("ads").select("target_url,is_active").eq("id", id).maybeSingle()
    : await admin.from("sponsored_posts").select("target_url:cta_url,is_active").eq("id", id).maybeSingle();
  const target = data?.is_active ? safeUrl(String(data.target_url)) : null;
  if (!target) return NextResponse.redirect(home);

  await admin.rpc("ad_event", { p_table: t === "ad" ? "ads" : "sponsored_posts", p_id: id, p_event: "click" });
  return NextResponse.redirect(target);
}
