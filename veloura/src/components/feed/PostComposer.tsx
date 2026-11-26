"use client";
import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MediaUploader } from "@/components/media/MediaUploader";
import { createPost } from "@/app/(user)/dashboard/create/actions";

type Category = { id: string; name: string };

export function PostComposer({ categories, mediaEnabled = true }: { categories: Category[]; mediaEnabled?: boolean }) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState("");
  const [consent, setConsent] = useState(false);
  const [media, setMedia] = useState<{ ids: string[]; busy: boolean }>({ ids: [], busy: false });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const onMedia = useCallback((s: { ids: string[]; busy: boolean }) => setMedia(s), []);
  const empty = !body.trim() && media.ids.length === 0;
  const blocked = pending || media.busy || !consent || empty || !categoryId;

  const submit = () =>
    start(async () => {
      setError(null);
      const r = await createPost({ categoryId, title, body, preview, consent, uploadIds: media.ids });
      if ("error" in r) setError(r.error);
      else { router.push("/dashboard/my-posts"); router.refresh(); }
    });

  const field = "rounded-xl border border-line bg-ink px-4 text-white outline-none focus:border-purple";

  return (
    <div className="grid gap-5">
      <label className="grid gap-1.5 text-sm">
        <span className="text-muted">Category</span>
        <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`h-12 ${field}`}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-muted">Title (optional)</span>
        <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={`h-12 ${field}`} />
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-muted">Your post</span>
        <textarea value={body} maxLength={5000} rows={7} onChange={(e) => setBody(e.target.value)} className={`py-3 ${field}`} />
      </label>

      {mediaEnabled ? (
        <MediaUploader onChange={onMedia} />
      ) : (
        <p className="rounded-xl border border-line bg-card p-3 text-sm text-muted">Photo and video uploads are unavailable right now. You can still submit a text post.</p>
      )}

      <label className="grid gap-1.5 text-sm">
        <span className="text-muted">Short summary for the feed, shown only to people who have unlocked the category (optional)</span>
        <input value={preview} maxLength={200} onChange={(e) => setPreview(e.target.value)} className={`h-12 ${field}`} />
      </label>
      <p className="rounded-xl border border-line bg-card p-3 text-sm text-muted">Everything on Veloura is premium: readers pay to unlock your post, and you earn from the views, reactions and comments it gets.</p>

      <label className="flex items-start gap-2 rounded-xl border border-line bg-card p-3 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
        <span>I am 18 or older, everyone shown or described is an adult who agreed to this being shared, and I own this content.</span>
      </label>
      <p className="text-xs text-muted">All posts are reviewed before they appear. Photo metadata (such as location) is removed from images in your browser.</p>

      {error && <p className="text-sm text-rose">{error}</p>}
      <button disabled={blocked} onClick={submit} className="h-12 rounded-xl bg-accent-gradient font-semibold disabled:opacity-40">
        {media.busy ? "Uploading media" : pending ? "Submitting" : "Submit for review"}
      </button>
    </div>
  );
}
