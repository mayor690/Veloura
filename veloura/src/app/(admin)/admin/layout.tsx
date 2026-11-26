import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ago } from "@/lib/constants";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; adminOnly?: boolean }[] = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/moderation", label: "Moderation" },
  { href: "/admin/users", label: "Users", adminOnly: true },
  { href: "/admin/payments", label: "Payments", adminOnly: true },
  { href: "/admin/earnings", label: "Earnings", adminOnly: true },
  { href: "/admin/payouts", label: "Payouts", adminOnly: true },
  { href: "/admin/ads", label: "Ads", adminOnly: true },
  { href: "/admin/sponsored", label: "Sponsored", adminOnly: true },
  { href: "/admin/settings", label: "Settings", adminOnly: true },
  { href: "/admin/quarantine", label: "Quarantine", adminOnly: true },
  { href: "/admin/audit", label: "Audit", adminOnly: true },
  { href: "/admin/launch", label: "Launch checks", adminOnly: true },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  if (!staff) notFound(); // do not reveal that /admin exists

  // The urgent banner is on EVERY admin page so urgent reports can never be buried.
  const { data } = await supabaseAdmin().from("reports").select("post_id,created_at")
    .eq("status", "open").eq("is_urgent", true).order("created_at", { ascending: true }).limit(500);
  const urgent = (data ?? []) as { post_id: string; created_at: string }[];
  const urgentPosts = new Set(urgent.map((r) => r.post_id)).size;

  return (
    <div className="mx-auto max-w-5xl px-4 py-5">
      {urgentPosts > 0 && (
        <Link href="/admin/moderation?tab=urgent" className="mb-4 flex items-center justify-between rounded-xl border border-rose bg-rose/15 px-4 py-3 text-sm font-semibold text-rose">
          <span>URGENT: {urgentPosts} post{urgentPosts > 1 ? "s" : ""} reported as possible minor or non-consensual content (hidden until reviewed)</span>
          <span className="shrink-0 pl-3">Oldest {ago(urgent[0].created_at)} →</span>
        </Link>
      )}
      <header className="border-b border-line pb-3">
        <div className="flex items-center justify-between">
          <Link href="/admin" className="font-display text-2xl text-accent-gradient">Veloura admin</Link>
          <span className="text-xs text-muted">{staff.role}</span>
        </div>
        <nav className="mt-3 flex gap-1 overflow-x-auto pb-1 text-sm">
          {NAV.filter((n) => !n.adminOnly || staff.role === "admin").map((n) => (
            <Link key={n.href} href={n.href} className="shrink-0 rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-white">{n.label}</Link>
          ))}
          <Link href="/" className="shrink-0 rounded-full px-3 py-1.5 text-muted hover:bg-card hover:text-white">Site</Link>
        </nav>
      </header>
      <div className="pt-6">{children}</div>
    </div>
  );
}
