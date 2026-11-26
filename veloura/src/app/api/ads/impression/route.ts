import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { t?: string; id?: string } | null;
  if (!body?.id || !UUID.test(body.id) || (body.t !== "ad" && body.t !== "sp")) return new NextResponse(null, { status: 400 });
  await supabaseAdmin().rpc("ad_event", { p_table: body.t === "ad" ? "ads" : "sponsored_posts", p_id: body.id, p_event: "impression" });
  return new NextResponse(null, { status: 204 });
}
