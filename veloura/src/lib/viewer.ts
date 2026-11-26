import { createClient } from "@/lib/supabase/server";

export type Viewer = {
  id: string;
  username: string;
  balanceKobo: number;
  fullPassExpires: Date | null;
  categoryExpires: Record<string, Date>;
};

export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: unlocks }, { data: bal }] = await Promise.all([
    supabase.from("profiles").select("username").eq("id", user.id).single(),
    supabase.from("unlocks").select("kind,category_id,expires_at").gt("expires_at", new Date().toISOString()),
    supabase.rpc("my_wallet_balance"),
  ]);

  let fullPassExpires: Date | null = null;
  const categoryExpires: Record<string, Date> = {};
  for (const u of (unlocks ?? []) as { kind: string; category_id: string | null; expires_at: string }[]) {
    const exp = new Date(u.expires_at);
    if (u.kind === "full_pass") {
      if (!fullPassExpires || exp > fullPassExpires) fullPassExpires = exp;
    } else if (u.category_id && (!categoryExpires[u.category_id] || exp > categoryExpires[u.category_id])) {
      categoryExpires[u.category_id] = exp;
    }
  }
  return {
    id: user.id,
    username: profile?.username ?? "anon",
    balanceKobo: Number(bal ?? 0),
    fullPassExpires,
    categoryExpires,
  };
}

/** Expiry date if the viewer currently has access to this category, else null. */
export function accessExpiry(v: Viewer | null, categoryId: string): Date | null {
  if (!v) return null;
  const a = v.fullPassExpires;
  const b = v.categoryExpires[categoryId] ?? null;
  if (a && b) return a > b ? a : b;
  return a ?? b;
}
