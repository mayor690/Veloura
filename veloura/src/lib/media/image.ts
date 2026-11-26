"use client";
import { MAX_IMAGE_BYTES } from "./limits";

const MAX_SIDE = 2048;

/**
 * Resize and re-encode in the browser before upload. This keeps files small (cheap R2 storage, fast mobile uploads)
 * and strips EXIF metadata such as GPS location, which matters for an anonymous platform.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; mime: string }> {
  if (!file.type.startsWith("image/")) throw new Error("That file is not an image.");
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("We couldn't read that image. Try a JPEG, PNG or WebP.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const encode = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  let blob = await encode("image/webp", 0.85);
  if (!blob || blob.type !== "image/webp") blob = await encode("image/jpeg", 0.88); // browsers without WebP encoding
  if (!blob) throw new Error("We couldn't process that image.");
  if (blob.size > MAX_IMAGE_BYTES) throw new Error("That image is too large even after compression.");
  return { blob, mime: blob.type };
}
