"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Flag, X } from "lucide-react";
import { reportPost } from "@/app/(public)/actions";

const REASONS: [string, string][] = [
  ["possible_minor", "Someone shown may be under 18"],
  ["non_consensual", "Shared without consent, or intimate content of someone who didn't agree"],
  ["illegal", "Illegal content"],
  ["personal_info", "Shows someone's personal information"],
  ["spam", "Spam or scam"],
  ["other", "Something else"],
];

export function ReportButton({ postId, loggedIn, className = "" }: { postId: string; loggedIn: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const r = await reportPost(postId, reason, details);
      if ("ok" in r) setMsg({ ok: true, text: r.urgent ? "Thank you. This post has been hidden while our team reviews it." : "Thank you. Our team will review it." });
      else setMsg({ ok: false, text: r.error });
    });

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setMsg(null); }} aria-label="Report this post"
              className={`flex items-center gap-1 rounded-full bg-ink/70 px-2.5 py-1 text-xs text-muted hover:text-white ${className}`}>
        <Flag size={12} /> Report
      </button>
      {open && (
        <div className="fixed inset-0 z-50 grid items-end bg-black/70 backdrop-blur-sm md:place-items-center" onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="safe-bottom max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl border border-line bg-card p-6 md:max-w-md md:rounded-3xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Report this post</h2>
              <button onClick={() => setOpen(false)} aria-label="Close"><X /></button>
            </div>
            {!loggedIn ? (
              <div className="mt-5 grid gap-3">
                <p className="text-sm text-muted">Log in to send a report. Reports are anonymous to the person who posted.</p>
                <Link href="/login" className="grid h-12 place-items-center rounded-xl bg-accent-gradient font-semibold">Log in</Link>
              </div>
            ) : msg?.ok ? (
              <p className="mt-5 text-sm text-emerald-300">{msg.text}</p>
            ) : (
              <div className="mt-4 grid gap-3">
                <p className="text-sm text-muted">Reports are anonymous to the person who posted.</p>
                <fieldset className="grid gap-2">
                  {REASONS.map(([v, l]) => (
                    <label key={v} className="flex cursor-pointer items-start gap-2 rounded-xl border border-line px-3 py-2.5 text-sm has-[:checked]:border-purple has-[:checked]:bg-purple/15">
                      <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} className="mt-0.5" /> {l}
                    </label>
                  ))}
                </fieldset>
                <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} rows={3} placeholder="Anything we should know? (optional)"
                          className="rounded-xl border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-purple" />
                {msg && <p className="text-sm text-rose">{msg.text}</p>}
                <button disabled={!reason || pending} onClick={submit} className="h-12 rounded-xl bg-accent-gradient font-semibold disabled:opacity-40">
                  {pending ? "Sending" : "Send report"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
