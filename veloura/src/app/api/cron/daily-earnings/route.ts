import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Nightly creator earnings. Scheduled for 23:30 UTC (00:30 Lagos) in vercel.json so the previous Lagos day is complete.
 * Idempotent: running it again does nothing, and it catches up any missed days (up to 7).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data, error } = await supabaseAdmin().rpc("run_pending_earnings");
  if (error) {
    console.error("[earnings] run failed", error);
    return NextResponse.json({ error: "run failed" }, { status: 500 }); // Vercel shows failed crons; re-run is safe
  }
  return NextResponse.json({ ok: true, days: data });
}
