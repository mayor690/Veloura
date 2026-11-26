"use client";
import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { reportComment } from "@/app/(public)/engage-actions";

const REASONS: [string, string][] = [
  ["possible_minor", "Mentions or involves someone under 18"],
  ["non_consensual", "Shares someone's private content without consent"],
  ["illegal", "Illegal content"],
  ["personal_info", "Shows personal information"],
  ["spam", "Spam or scam"],
  ["other", "Something else"],
];

export function CommentReportButton({ commentId }: { commentId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const r = await reportComment(commentId, reason, "");
      if ("ok" in r) setMsg({ ok: true, text: r.urgent ? "Thank you. This comment has been hidden while our team reviews it." : "Thank you. Our team will review it." });
      else setMsg({ ok: false, text: r.error });
    });

  if (msg?.ok) return <span className="text-xs text-emerald-300">{msg.text}</span>;

  return (
    <div className="mt-2">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1 text-xs text-muted hover:text-white">
          <Flag size={11} /> Report
        </button>
      ) : (
        <div className="grid gap-2 rounded-xl border border-line bg-ink p-3">
          <p className="text-xs text-muted">Why are you reporting this comment? Reports are anonymous.</p>
          {REASONS.map(([v, l]) => (
            <label key={v} className="flex cursor-pointer items-start gap-2 text-xs">
              <input type="radio" name={`reason-${commentId}`} value={v} checked={reason === v} onChange={() => setReason(v)} className="mt-0.5" /> {l}
            </label>
          ))}
          {msg && <p className="text-xs text-rose">{msg.text}</p>}
          <div className="flex gap-2">
            <button type="button" disabled={!reason || pending} onClick={submit} className="h-9 rounded-lg bg-accent-gradient px-4 text-xs font-semibold disabled:opacity-40">
              {pending ? "Sending" : "Send report"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-9 rounded-lg border border-line px-4 text-xs text-muted">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
