import Link from "next/link";
import { Lock, LockOpen, Flame, Heart, HeartHandshake, Wallet, GraduationCap, Store, Briefcase } from "lucide-react";
import { naira, timeLeft } from "@/lib/constants";

const ICONS: Record<string, typeof Flame> = {
  "spicy-confessions": Flame,
  "sex-tips": Heart,
  "relationship-tips": HeartHandshake,
  "money-tips": Wallet,
  "exam-prep": GraduationCap,
  "market-prices": Store,
  "daily-gigs": Briefcase,
};

type Props = {
  slug: string;
  name: string;
  description: string | null;
  price: number;
  expires: string | null;
  index: number;
};

export function CategoryCard({ slug, name, description, price, expires, index }: Props) {
  const Icon = ICONS[slug] ?? Flame;
  const unlocked = !!expires;
  const tone = index % 2 === 0 ? "from-purple/30" : "from-rose/30";
  return (
    <Link
      href={`/c/${slug}`}
      className="group relative flex min-h-44 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-card p-4 transition active:scale-[.98] md:hover:-translate-y-1 md:hover:border-purple/60"
    >
      <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tone} to-transparent opacity-60`} />
      <div className="relative flex items-start justify-between">
        <span className="grid size-10 place-items-center rounded-xl bg-ink/60 text-purple">
          <Icon size={20} />
        </span>
        {unlocked ? <LockOpen size={16} className="text-emerald-400" /> : <Lock size={16} className="text-muted" />}
      </div>
      <div className="relative">
        <h3 className="font-semibold leading-snug">{name}</h3>
        <p className="mt-1 line-clamp-2 text-xs text-muted">{description}</p>
        <span
          className={`mt-3 inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
            unlocked ? "bg-emerald-500/15 text-emerald-300" : "bg-ink/70 text-rose"
          }`}
        >
          {unlocked ? `Unlocked, ${timeLeft(new Date(expires!))}` : `${naira(price)} / day`}
        </span>
      </div>
    </Link>
  );
}
