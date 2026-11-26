import "server-only";
import { randomUUID } from "crypto";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { bucket, r2 } from "./client";
import { EXT } from "@/lib/media/limits";

/** Random key. No user id, post id or filename, so a URL never reveals who uploaded what. */
export function newObjectKey(mime: string) {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return `m/${ym}/${randomUUID()}.${EXT[mime] ?? "bin"}`;
}

export const presignPut = (key: string, mime: string, ttl = 3600) =>
  getSignedUrl(r2(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: mime }), { expiresIn: ttl });

export const presignGet = (key: string, ttl = 1800) =>
  getSignedUrl(r2(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: ttl });

export const presignPart = (key: string, uploadId: string, partNumber: number, ttl = 3600) =>
  getSignedUrl(r2(), new UploadPartCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumber: partNumber }), {
    expiresIn: ttl,
  });

export async function createMultipart(key: string, mime: string) {
  const r = await r2().send(new CreateMultipartUploadCommand({ Bucket: bucket(), Key: key, ContentType: mime }));
  if (!r.UploadId) throw new Error("R2 did not return an UploadId");
  return r.UploadId;
}

export type PartInfo = { PartNumber: number; ETag: string; Size: number };

export async function listParts(key: string, uploadId: string): Promise<PartInfo[]> {
  const out: PartInfo[] = [];
  let marker: string | undefined;
  for (;;) {
    const r = await r2().send(
      new ListPartsCommand({ Bucket: bucket(), Key: key, UploadId: uploadId, PartNumberMarker: marker })
    );
    for (const p of r.Parts ?? []) {
      if (p.PartNumber && p.ETag) out.push({ PartNumber: p.PartNumber, ETag: p.ETag, Size: Number(p.Size ?? 0) });
    }
    if (!r.IsTruncated || !r.NextPartNumberMarker) break;
    marker = String(r.NextPartNumberMarker);
  }
  return out;
}

export const completeMultipart = (key: string, uploadId: string, parts: PartInfo[]) =>
  r2().send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket(),
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: [...parts].sort((a, b) => a.PartNumber - b.PartNumber).map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
      },
    })
  );

export const abortMultipart = (key: string, uploadId: string) =>
  r2().send(new AbortMultipartUploadCommand({ Bucket: bucket(), Key: key, UploadId: uploadId }));

export async function headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  try {
    const r = await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: Number(r.ContentLength ?? 0), contentType: r.ContentType };
  } catch (e) {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return null;
    throw e;
  }
}

/** First bytes of an object, for file-type sniffing. */
export async function readHead(key: string, n = 32): Promise<Uint8Array> {
  const r = await r2().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${n - 1}` }));
  return r.Body ? await r.Body.transformToByteArray() : new Uint8Array();
}

/** Single-object delete (DeleteObjects needs a checksum header that R2 rejects). Deleting is free on R2. */
export const deleteObject = (key: string) => r2().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));

/** Server-side upload for small admin-managed files (ad creatives). User media never goes through here. */
export const putObject = (key: string, body: Uint8Array, mime: string) =>
  r2().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: mime }));

/** True if the bucket exists and the credentials work. Used by the launch checks. */
export async function headBucket(): Promise<boolean> {
  try { await r2().send(new HeadBucketCommand({ Bucket: bucket() })); return true; } catch { return false; }
}
