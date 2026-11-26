import Link from "next/link";
import { Plus } from "lucide-react";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";
import { naira, timeLeft } from "@/lib/constants";
import { logout } from "@/app/(auth)/actions";

export default async function Dashboard() {
  const v = await getViewer();
  if (!v) redirect("/login");
  const active = Object.keys(v.categoryExpires).length + (v.fullPassExpires ? 1 : 0);
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <Link href="/" className="font-display text-2xl text-accent-gradient">Veloura</Link>
      <h1 className="mt-6 font-display text-3xl">@{v.username}</h1>
      <div className="mt-6 rounded-2xl border border-purple/40 bg-card p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Wallet balance</p>
            <p className="mt-1 text-3xl font-semibold">{naira(v.balanceKobo)}</p>
          </div>
          <Link href="/checkout/topup" className="flex h-12 shrink-0 items-center gap-1.5 rounded-xl bg-accent-gradient px-5 font-semibold">
            <Plus size={18} /> Top up
          </Link>
        </div>
        <p className="mt-3 text-xs text-muted">Pay by crypto or bank transfer. Your balance is used to unlock categories and send tips.</p>
      </div>
      <div className="mt-3 rounded-2xl border border-line bg-card p-5">
        <p className="text-sm text-muted">Active unlocks</p>
        <p className="mt-1 text-2xl font-semibold">{active}</p>
        {v.fullPassExpires && <p className="mt-2 text-sm text-emerald-300">Full Pass, {timeLeft(v.fullPassExpires)}</p>}
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/dashboard/create" className="grid h-12 place-items-center rounded-xl bg-accent-gradient font-semibold">New post</Link>
        <Link href="/dashboard/my-posts" className="grid h-12 place-items-center rounded-xl border border-line">My posts</Link>
        <Link href="/dashboard/earnings" className="grid h-12 place-items-center rounded-xl border border-line sm:col-span-2">Earnings and payouts</Link>
      </div>
      <form action={logout} className="mt-8">
        <button className="h-11 rounded-xl border border-line px-5 text-muted">Log out</button>
      </form>
    </main>
  );
}
