// Pure module: used by the browser (pre-checks) and the server (authoritative checks).
export const MiB = 1024 * 1024;

export const MAX_VIDEO_BYTES = 80 * MiB;
export const MAX_VIDEO_MS = 45_000;
export const MAX_IMAGE_BYTES = 8 * MiB;       // images are re-encoded in the browser first, so this is generous
export const MAX_IMAGES = 6;
export const MAX_VIDEOS = 1;
export const MAX_MEDIA = MAX_IMAGES + MAX_VIDEOS;

/** R2 multipart parts must be >= 5 MiB (except the last) and all the same size. 80 MiB = exactly 10 parts. */
export const PART_SIZE = 8 * MiB;

export const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type MediaKind = "image" | "video";

export const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

export function planUpload(kind: MediaKind, size: number):
  | { mode: "single" }
  | { mode: "multipart"; partSize: number; partCount: number } {
  if (kind === "image" || size <= PART_SIZE) return { mode: "single" };
  return { mode: "multipart", partSize: PART_SIZE, partCount: Math.ceil(size / PART_SIZE) };
}

/** Bytes expected in a given 1-based part number. */
export function expectedPartBytes(size: number, partSize: number, partCount: number, n: number) {
  return n < partCount ? partSize : size - partSize * (partCount - 1);
}

/** "1080p max": the short side may not exceed 1080 and the long side may not exceed 1920. Works for 9:16 and 16:9. */
export const videoResolutionOk = (w: number, h: number) => Math.min(w, h) <= 1080 && Math.max(w, h) <= 1920;

export type MediaMeta = { kind: MediaKind; mime: string; size: number; durationMs?: number; width?: number; height?: number };

/** Returns a user-facing error message, or null when the file is acceptable. */
export function validateMediaMeta(m: MediaMeta): string | null {
  if (m.kind === "image") {
    if (!(IMAGE_MIMES as readonly string[]).includes(m.mime)) return "Images must be JPEG, PNG or WebP.";
    if (m.size > MAX_IMAGE_BYTES) return "That image is too large.";
    return null;
  }
  if (!(VIDEO_MIMES as readonly string[]).includes(m.mime)) return "Videos must be MP4, MOV or WebM.";
  if (m.size > MAX_VIDEO_BYTES) return "Videos can be at most 80 MB.";
  if (!m.durationMs || m.durationMs <= 0) return "We couldn't read this video's length.";
  if (m.durationMs > MAX_VIDEO_MS) return "Videos can be at most 45 seconds.";
  if (!m.width || !m.height) return "We couldn't read this video's size.";
  if (!videoResolutionOk(m.width, m.height)) return "Video resolution can be at most 1080p.";
  return null;
}
