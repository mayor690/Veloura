import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Polled by the status page. RLS limits this to the signed-in user's own payments. */
export async function GET(req: Request) {
  const reference = new URL(req.url).searchParams.get("reference") ?? "";
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("status,provider_status")
    .eq("reference", reference)
    .maybeSingle();
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
