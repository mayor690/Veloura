"use client";
import { abortUpload, completeUpload, getUploadParts, initUpload } from "@/app/media/actions";
import type { MediaMeta } from "./limits";

type Progress = (pct: number) => void;
type Opts = { resumeKey?: string; signal?: AbortSignal };

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

function xhrPut(url: string, body: Blob, headers: Record<string, string>, onLoaded: (n: number) => void, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onLoaded(e.loaded); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Upload timed out"));
    if (signal) {
      if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", () => { xhr.abort(); reject(new DOMException("Aborted", "AbortError")); });
    }
    xhr.send(body);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

async function putPartWithRetry(url: string, blob: Blob, onLoaded: (n: number) => void, signal?: AbortSignal) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      onLoaded(0);
      return await xhrPut(url, blob, {}, onLoaded, signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      last = e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw last instanceof Error ? last : new Error("Upload failed");
}

async function uploadParts(id: string, file: Blob, onProgress: Progress, signal?: AbortSignal) {
  for (let round = 0; round < 3; round++) {
    const p = await getUploadParts(id);
    if ("error" in p) throw new Error(p.error);

    const bytesOf = (n: number) => (n < p.partCount ? p.partSize : file.size - p.partSize * (p.partCount - 1));
    const done = new Set(p.done);
    const missing = Array.from({ length: p.partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
    const base = p.done.reduce((s, n) => s + bytesOf(n), 0);
    const loaded: Record<number, number> = {};
    const report = () => onProgress(Math.min(99, ((base + Object.values(loaded).reduce((a, b) => a + b, 0)) / file.size) * 100));
    report();

    const queue = [...missing];
    const worker = async () => {
      while (queue.length) {
        const n = queue.shift()!;
        const start = (n - 1) * p.partSize;
        const slice = file.slice(start, start + bytesOf(n));
        await putPartWithRetry(p.urls[String(n)], slice, (l) => { loaded[n] = l; report(); }, signal);
        loaded[n] = bytesOf(n);
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, missing.length) }, worker));

    const c = await completeUpload(id);
    if ("ok" in c) return;
    if (!c.retry) throw new Error(c.error);
  }
  throw new Error("The upload couldn't be completed. Please try again.");
}

/**
 * Uploads straight from the browser to Cloudflare R2. Images use one presigned PUT. Videos over 8 MiB use multipart
 * with 3 parallel parts, per-part retries, and resume: after a dropped connection or a page reload, only the missing
 * parts are sent. Returns the media_uploads id to attach to a post.
 */
export async function uploadFile(file: Blob, meta: MediaMeta, onProgress: Progress, opts: Opts = {}): Promise<string> {
  const storeKey = opts.resumeKey && meta.kind === "video" ? `veloura:upload:${opts.resumeKey}` : null;

  if (storeKey) {
    const saved = store.get(storeKey);
    if (saved) {
      const p = await getUploadParts(saved);
      if (!("error" in p)) {
        try {
          await uploadParts(saved, file, onProgress, opts.signal);
          store.del(storeKey);
          onProgress(100);
          return saved;
        } catch (e) {
          if (isAbort(e)) throw e;
        }
      }
      store.del(storeKey);
    }
  }

  const init = await initUpload(meta);
  if ("error" in init) throw new Error(init.error);

  try {
    if (init.mode === "single") {
      await xhrPut(init.url, file, { "Content-Type": meta.mime }, (l) => onProgress(Math.min(99, (l / file.size) * 100)), opts.signal);
      const c = await completeUpload(init.id);
      if (!("ok" in c)) throw new Error(c.error);
    } else {
      if (storeKey) store.set(storeKey, init.id);
      await uploadParts(init.id, file, onProgress, opts.signal);
    }
  } catch (e) {
    if (isAbort(e)) { void abortUpload(init.id); if (storeKey) store.del(storeKey); }
    throw e;
  }
  if (storeKey) store.del(storeKey);
  onProgress(100);
  return init.id;
}
