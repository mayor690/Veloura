import type { SignedMedia } from "@/lib/r2/media";

/* Server component: renders already-signed R2 URLs. Expires with the URL (30 minutes by default). */
export function MediaGallery({ items }: { items: Pick<SignedMedia, "id" | "type" | "url">[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-6 grid gap-3">
      {items.map((m) =>
        m.type === "video" ? (
          <video key={m.id} src={m.url} controls playsInline preload="metadata" controlsList="nodownload"
                 className="mx-auto max-h-[80vh] w-full max-w-sm rounded-2xl bg-black" />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img key={m.id} src={m.url} alt="" loading="lazy" className="w-full rounded-2xl" />
        )
      )}
    </div>
  );
}
