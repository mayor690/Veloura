"use client";
import { useState, useTransition } from "react";
import { addComment } from "@/app/(public)/engage-actions";

export function CommentForm({ postId }: { postId: string }) {
  const [body, setBody] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      const r = await addComment(postId, body);
      if ("ok" in r) { setBody(""); setNote({ ok: true, text: "Thanks! Your comment will appear once it has been reviewed." }); }
      else setNote({ ok: false, text: r.error });
    });
  return (
    <div className="grid gap-2">
      <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} rows={3} placeholder="Add a comment"
        className="rounded-xl border border-line bg-ink px-3 py-2 text-sm outline-none focus:border-purple" />
      {note && <p className={`text-sm ${note.ok ? "text-emerald-300" : "text-rose"}`}>{note.text}</p>}
      <button disabled={pending || body.trim().length < 2} onClick={submit} className="h-11 rounded-xl bg-accent-gradient font-semibold disabled:opacity-40">
        {pending ? "Sending" : "Post comment"}
      </button>
    </div>
  );
}
