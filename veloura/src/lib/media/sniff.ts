// Identify a file from its first bytes so a renamed file cannot pass as an image or video.
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));
const IMAGE_BRANDS = ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "avif", "avis"];

export function sniffMime(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(b, 4, 8) === "ftyp") {
    const brand = ascii(b, 8, 12);
    if (IMAGE_BRANDS.includes(brand)) return null;           // HEIC/AVIF stills are not videos
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

/** MP4 and MOV share one container family, so either label is acceptable for the other. */
export function mimeMatches(declared: string, sniffed: string | null) {
  if (!sniffed) return false;
  if (declared === sniffed) return true;
  const iso = ["video/mp4", "video/quicktime"];
  return iso.includes(declared) && iso.includes(sniffed);
}
