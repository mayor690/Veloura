import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { r2Configured } from "@/lib/r2/client";
import { presignGet } from "@/lib/r2/storage";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ad creatives live in the private bucket; this hands the browser a short-lived link, only for active ads. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const t = u.searchParams.get("t");
  const id = u.searchParams.get("id") ?? "";
  if (!r2Configured() || !UUID.test(id) || (t !== "ad" && t !== "sp")) return new NextResponse(null, { status: 404 });
  const admin = supabaseAdmin();
  const { data } = await admin.from(t === "ad" ? "ads" : "sponsored_posts").select("image_key,is_active").eq("id", id).maybeSingle();
  if (!data?.is_active || !data.image_key) return new NextResponse(null, { status: 404 });
  const res = NextResponse.redirect(await presignGet(data.image_key, 3600));
  res.headers.set("Cache-Control", "public, max-age=300");
  return res;
}
