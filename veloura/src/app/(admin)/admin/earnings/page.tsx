import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { btn } from "@/components/admin/ui";
import { naira } from "@/lib/constants";
import { runEarningsNow } from "./actions";

type Run = { earn_date: string; revenue_kobo: number; share_pct: number; carry_in_kobo: number; pool_kobo: number; distributed_kobo: number; carry_out_kobo: number; total_points: number; weight_view: number; weight_reaction: number; weight_comment: number; ran_at: string };
type Line = { post_id: string | null; creator_id: string; views: number; reactions: number; comments: number; points: number; amount_kobo: number; posts: { title: string | null } | null; profiles: { username: string } | null };

export default async function Earnings({ searchParams }: { searchParams: Promise<{ date?: string; ran?: string; e?: string }> }) {
  if (!(await requireAdmin())) notFound();
  const sp = await searchParams;
  const admin = supabaseAdmin();
  const { data } = await admin.from("earnings_runs").select("*").order("earn_date", { ascending: false }).limit(30);
  const runs = (data ?? []) as Run[];
  const picked = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : runs[0]?.earn_date;
  const { data: lines } = picked
    ? await admin.from("earnings_ledger")
        .select("post_id,creator_id,views,reactions,comments,points,amount_kobo,posts(title),profiles!earnings_ledger_creator_id_fkey(username)")
        .eq("earn_date", picked).order("amount_kobo", { ascending: false }).limit(50)
    : { data: [] };

  return (
    <div className="grid gap-5">
      <h1 className="font-display text-3xl">Creator earnings</h1>
      <p className="rounded-xl border border-line bg-card p-4 text-sm text-muted">
        Every night at 00:30 Lagos time, the creator share of the previous day&apos;s unlock revenue is split across posts by points
        (premium view, reaction, approved comment; weights in Settings) and credited to the authors. If nobody earned points that day, the
        pool carries over to the next day. Authors&apos; own activity and banned users never count. See docs/EARNINGS.md.
      </p>
      {sp.ran && <p className="rounded-xl bg-emerald-500/15 p-3 text-sm text-emerald-300">Done. {sp.ran} day(s) paid.</p>}
      {sp.e && <p className="rounded-xl bg-rose/15 p-3 text-sm text-rose">The run failed. Check the logs; it is safe to try again.</p>}
      <form action={runEarningsNow}><button className={`${btn} border border-line`}>Run now for any unpaid finished days</button></form>

      <div className="overflow-x-auto rounded-2xl border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-card text-xs text-muted"><tr>
            {["Day", "Revenue", "Pool", "Paid out", "Carried", "Points"].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
          </tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.earn_date} className={`border-t border-line ${r.earn_date === picked ? "bg-purple/10" : ""}`}>
                <td className="px-3 py-2"><Link href={`/admin/earnings?date=${r.earn_date}`} className="text-purple underline">{r.earn_date}</Link></td>
                <td className="px-3 py-2">{naira(r.revenue_kobo)}</td>
                <td className="px-3 py-2">{naira(r.pool_kobo)}{r.carry_in_kobo > 0 && <span className="text-xs text-muted"> (incl. {naira(r.carry_in_kobo)} carried)</span>}</td>
                <td className="px-3 py-2">{naira(r.distributed_kobo)}</td>
                <td className="px-3 py-2">{r.carry_out_kobo > 0 ? naira(r.carry_out_kobo) : "-"}</td>
                <td className="px-3 py-2">{Number(r.total_points)} <span className="text-xs text-muted">({r.weight_view}/{r.weight_reaction}/{r.weight_comment})</span></td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={6} className="px-3 py-4 text-muted">No runs yet. The first one happens after the first full day.</td></tr>}
          </tbody>
        </table>
      </div>

      {picked && (
        <section>
          <h2 className="font-semibold">Breakdown for {picked}</h2>
          <ul className="mt-3 grid gap-2 text-sm">
            {((lines ?? []) as unknown as Line[]).map((l, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2">
                <span>{l.posts?.title ?? "Removed post"} <span className="text-muted">· @{l.profiles?.username}</span></span>
                <span className="text-xs text-muted">{l.views} views · {l.reactions} reactions · {l.comments} comments · {Number(l.points)} pts</span>
                <span className="font-semibold">{naira(l.amount_kobo)}</span>
              </li>
            ))}
            {!lines?.length && <li className="text-muted">Nobody earned points that day.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
