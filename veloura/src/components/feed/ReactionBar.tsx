"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Flame, Heart, ThumbsUp, MessageCircle } from "lucide-react";
import { setReaction, type Engagement } from "@/app/(public)/engage-actions";

const KINDS = [
  { kind: "like", Icon: ThumbsUp, label: "Like" },
  { kind: "love", Icon: Heart, label: "Love" },
  { kind: "fire", Icon: Flame, label: "Fire" },
] as const;

export function ReactionBar({ postId, initial, loggedIn }: { postId: string; initial: Engagement; loggedIn: boolean }) {
  const [eng, setEng] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const click = (kind: (typeof KINDS)[number]["kind"]) => {
    if (!loggedIn || pending) return;
    const prev = eng;
    const next = prev.mine === kind ? null : kind;
    // optimistic update, reverted if the server says no
    const optimistic = { ...prev, mine: next } as Engagement;
    if (prev.mine) (optimistic as unknown as Record<string, number>)[prev.mine] -= 1;
    if (next) (optimistic as unknown as Record<string, number>)[next] += 1;
    setEng(optimistic);
    setError(null);
    start(async () => {
      const r = await setReaction(postId, next);
      if ("ok" in r) setEng(r.engagement);
      else { setEng(prev); setError(r.error); }
    });
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        {KINDS.map(({ kind, Icon, label }) => (
          <button key={kind} type="button" onClick={() => click(kind)} aria-pressed={eng.mine === kind} aria-label={label} disabled={!loggedIn}
            className={`flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm ${eng.mine === kind ? "border-purple bg-purple/20" : "border-line"} disabled:opacity-60`}>
            <Icon size={16} /> {eng[kind]}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 text-sm text-muted"><MessageCircle size={16} /> {eng.comments}</span>
      </div>
      {!loggedIn && <p className="mt-2 text-xs text-muted"><Link href="/login" className="text-purple underline">Log in</Link> to react.</p>}
      {error && <p className="mt-2 text-sm text-rose">{error}</p>}
    </div>
  );
}
