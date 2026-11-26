import test from "node:test";
import assert from "node:assert/strict";
import { MiB, PART_SIZE, expectedPartBytes, planUpload, validateMediaMeta, videoResolutionOk } from "./limits";
import { mimeMatches, sniffMime } from "./sniff";

const bytes = (...n: number[]) => Uint8Array.from([...n, ...Array(32).fill(0)]);
const withAscii = (at: number, s: string, len = 32) => {
  const b = new Uint8Array(len);
  for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
  return b;
};

test("sniffMime recognises the allowed formats", () => {
  assert.equal(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
  assert.equal(sniffMime(bytes(0x89, 0x50, 0x4e, 0x47)), "image/png");
  assert.equal(sniffMime(bytes(0x1a, 0x45, 0xdf, 0xa3)), "video/webm");
  const webp = withAscii(0, "RIFF"); webp.set([87, 69, 66, 80], 8);
  assert.equal(sniffMime(webp), "image/webp");
  const mp4 = withAscii(4, "ftyp"); mp4.set([..."isom"].map((c) => c.charCodeAt(0)), 8);
  assert.equal(sniffMime(mp4), "video/mp4");
  const mov = withAscii(4, "ftyp"); mov.set([..."qt  "].map((c) => c.charCodeAt(0)), 8);
  assert.equal(sniffMime(mov), "video/quicktime");
});

test("sniffMime rejects disguised or unsupported files", () => {
  const heic = withAscii(4, "ftyp"); heic.set([..."heic"].map((c) => c.charCodeAt(0)), 8);
  assert.equal(sniffMime(heic), null);
  assert.equal(sniffMime(new TextEncoder().encode("<html><script>alert(1)</script></html>")), null);
  assert.equal(sniffMime(new Uint8Array(4)), null);
});

test("mimeMatches", () => {
  assert.ok(mimeMatches("video/mp4", "video/quicktime"));
  assert.ok(mimeMatches("image/png", "image/png"));
  assert.ok(!mimeMatches("image/png", "image/jpeg"));
  assert.ok(!mimeMatches("video/mp4", null));
});

test("planUpload: images are single PUTs, an 80 MB video is exactly 10 parts", () => {
  assert.deepEqual(planUpload("image", 3 * MiB), { mode: "single" });
  assert.deepEqual(planUpload("video", PART_SIZE), { mode: "single" });
  assert.deepEqual(planUpload("video", 80 * MiB), { mode: "multipart", partSize: PART_SIZE, partCount: 10 });
  assert.deepEqual(planUpload("video", PART_SIZE + 1), { mode: "multipart", partSize: PART_SIZE, partCount: 2 });
});

test("expectedPartBytes sums to the file size", () => {
  const size = 50 * MiB + 123;
  const plan = planUpload("video", size) as { partSize: number; partCount: number };
  let total = 0;
  for (let n = 1; n <= plan.partCount; n++) total += expectedPartBytes(size, plan.partSize, plan.partCount, n);
  assert.equal(total, size);
});

test("resolution rule works for vertical and horizontal video", () => {
  assert.ok(videoResolutionOk(1080, 1920));
  assert.ok(videoResolutionOk(1920, 1080));
  assert.ok(!videoResolutionOk(2160, 3840));
  assert.ok(!videoResolutionOk(1440, 1440));
});

test("validateMediaMeta enforces the video limits", () => {
  const ok = { kind: "video" as const, mime: "video/mp4", size: 30 * MiB, durationMs: 44_000, width: 1080, height: 1920 };
  assert.equal(validateMediaMeta(ok), null);
  assert.match(validateMediaMeta({ ...ok, durationMs: 45_001 })!, /45 seconds/);
  assert.match(validateMediaMeta({ ...ok, size: 81 * MiB })!, /80 MB/);
  assert.match(validateMediaMeta({ ...ok, mime: "video/avi" })!, /MP4, MOV or WebM/);
  assert.match(validateMediaMeta({ ...ok, width: 2160, height: 3840 })!, /1080p/);
  assert.match(validateMediaMeta({ ...ok, durationMs: undefined })!, /length/);
  assert.equal(validateMediaMeta({ kind: "image", mime: "image/webp", size: MiB }), null);
  assert.match(validateMediaMeta({ kind: "image", mime: "image/gif", size: MiB })!, /JPEG, PNG or WebP/);
});
