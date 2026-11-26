import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** For uptime monitors: 200 when the app can reach the database. Reveals nothing else. */
export async function GET() {
  const { error } = await supabaseAdmin().from("site_settings").select("key").limit(1);
  return error ? NextResponse.json({ ok: false }, { status: 503 }) : NextResponse.json({ ok: true });
}
