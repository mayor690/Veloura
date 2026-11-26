import type { ReactNode } from "react";

export function Stat({ label, value, sub, tone = "default" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "warn" | "danger" }) {
  const ring = tone === "danger" ? "border-rose/60" : tone === "warn" ? "border-amber-400/50" : "border-line";
  return (
    <div className={`rounded-2xl border ${ring} bg-card p-4`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
    </div>
  );
}

const TONES = {
  default: "bg-line text-muted",
  good: "bg-emerald-500/15 text-emerald-300",
  warn: "bg-amber-500/15 text-amber-300",
  danger: "bg-rose/15 text-rose",
  info: "bg-purple/15 text-purple",
} as const;

export function Badge({ tone = "default", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function BarChart({ title, data, format }: { title: string; data: { label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="rounded-2xl border border-line bg-card p-4">
      <p className="text-sm font-medium">{title}</p>
      <div className="mt-3 flex h-28 items-end gap-1" role="img" aria-label={title}>
        {data.map((d) => (
          <div key={d.label} title={`${d.label}: ${format(d.value)}`} className="flex-1 rounded-t bg-accent-gradient/90"
               style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value > 0 ? 2 : 0, backgroundImage: "linear-gradient(180deg,#a855f7,#f43f5e)" }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export const inputCls = "h-11 rounded-xl border border-line bg-ink px-3 text-sm text-white outline-none focus:border-purple";
export const btn = "h-11 rounded-xl px-4 text-sm font-semibold";
