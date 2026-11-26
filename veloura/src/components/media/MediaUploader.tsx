"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Video, Camera, X } from "lucide-react";
import { abortUpload } from "@/app/media/actions";
import { MAX_IMAGES, validateMediaMeta, type MediaKind } from "@/lib/media/limits";
import { prepareImage } from "@/lib/media/image";
import { probeVideo } from "@/lib/media/video";
import { uploadFile } from "@/lib/media/uploader";
import { VideoRecorder } from "./VideoRecorder";

type Item = {
  key: string; kind: MediaKind; name: string; previewUrl: string;
  progress: number; status: "uploading" | "done" | "error"; error?: string; uploadId?: string;
};

export function MediaUploader({ onChange }: { onChange: (s: { ids: string[]; busy: boolean }) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const controllers = useRef<Map<string, AbortController>>(new Map());
  const imgInput = useRef<HTMLInputElement>(null);
  const vidInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onChange({ ids: items.filter((i) => i.status === "done" && i.uploadId).map((i) => i.uploadId!), busy: items.some((i) => i.status === "uploading") });
  }, [items, onChange]);

  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const run = async (item: Item, blob: Blob, meta: Parameters<typeof uploadFile>[1], resumeKey?: string) => {
    const ctrl = new AbortController();
    controllers.current.set(item.key, ctrl);
    try {
      const id = await uploadFile(blob, meta, (pct) => patch(item.key, { progress: pct }), { resumeKey, signal: ctrl.signal });
      patch(item.key, { status: "done", progress: 100, uploadId: id });
    } catch (e) {
      if (!(e instanceof DOMException)) patch(item.key, { status: "error", error: e instanceof Error ? e.message : "Upload failed" });
    } finally {
      controllers.current.delete(item.key);
    }
  };

  const addImages = async (files: FileList | null) => {
    setNotice(null);
    if (!files) return;
    const room = MAX_IMAGES - items.filter((i) => i.kind === "image").length;
    if (room <= 0) return setNotice(`You can add up to ${MAX_IMAGES} images.`);
    for (const file of Array.from(files).slice(0, room)) {
      const key = crypto.randomUUID();
      try {
        const { blob, mime } = await prepareImage(file);
        const item: Item = { key, kind: "image", name: file.name, previewUrl: URL.createObjectURL(blob), progress: 0, status: "uploading" };
        setItems((xs) => [...xs, item]);
        void run(item, blob, { kind: "image", mime, size: blob.size });
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "That image couldn't be added.");
      }
    }
    if (imgInput.current) imgInput.current.value = "";
  };

  const addVideo = async (file: File, known?: { durationMs: number; width: number; height: number }) => {
    setNotice(null);
    if (items.some((i) => i.kind === "video")) return setNotice("Remove the current video before adding another.");
    try {
      const probe = known ?? (await probeVideo(file));
      const meta = { kind: "video" as const, mime: file.type, size: file.size, ...probe };
      const bad = validateMediaMeta(meta);
      if (bad) return setNotice(bad);
      if (probe.width > probe.height) setNotice("Tip: vertical (9:16) video looks best on phones.");
      const item: Item = { key: crypto.randomUUID(), kind: "video", name: file.name, previewUrl: URL.createObjectURL(file), progress: 0, status: "uploading" };
      setItems((xs) => [...xs, item]);
      void run(item, file, meta, known ? undefined : `${file.name}:${file.size}:${file.lastModified}`);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "That video couldn't be added.");
    } finally {
      if (vidInput.current) vidInput.current.value = "";
    }
  };

  const remove = (item: Item) => {
    controllers.current.get(item.key)?.abort();
    if (item.uploadId) void abortUpload(item.uploadId);
    URL.revokeObjectURL(item.previewUrl);
    setItems((xs) => xs.filter((x) => x.key !== item.key));
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => imgInput.current?.click()} className="flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm"><ImagePlus size={16} /> Add photos</button>
        <button type="button" onClick={() => vidInput.current?.click()} className="flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm"><Video size={16} /> Upload video</button>
        <button type="button" onClick={() => setRecording(true)} className="flex h-11 items-center gap-2 rounded-xl border border-line px-4 text-sm"><Camera size={16} /> Record video</button>
      </div>
      <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => void addImages(e.target.files)} />
      <input ref={vidInput} type="file" accept="video/mp4,video/quicktime,video/webm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addVideo(f); }} />
      <p className="text-xs text-muted">Up to {MAX_IMAGES} photos and 1 video (max 45 seconds, 80 MB, MP4/MOV/WebM, 1080p, vertical works best).</p>
      {notice && <p className="text-sm text-rose">{notice}</p>}

      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {items.map((it) => (
            <li key={it.key} className="relative aspect-square overflow-hidden rounded-xl border border-line bg-ink">
              {it.kind === "image"
                ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={it.previewUrl} alt="" className="size-full object-cover" />
                : <video src={it.previewUrl} muted playsInline className="size-full object-cover" />}
              {it.status === "uploading" && (
                <div className="absolute inset-x-0 bottom-0 bg-black/70 p-1.5">
                  <div className="h-1.5 overflow-hidden rounded bg-line"><div className="h-full bg-accent-gradient transition-[width]" style={{ width: `${it.progress}%` }} /></div>
                </div>
              )}
              {it.status === "error" && <div className="absolute inset-0 grid place-items-center bg-black/80 p-2 text-center text-xs text-rose">{it.error}</div>}
              {it.kind === "video" && <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px]">VIDEO</span>}
              <button type="button" onClick={() => remove(it)} aria-label="Remove" className="absolute right-1 top-1 rounded-full bg-black/70 p-1"><X size={14} /></button>
            </li>
          ))}
        </ul>
      )}

      {recording && (
        <VideoRecorder
          onClose={() => setRecording(false)}
          onRecorded={(file, info) => { setRecording(false); void addVideo(file, info); }}
        />
      )}
    </div>
  );
}
