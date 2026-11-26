import "server-only";
import { S3Client } from "@aws-sdk/client-s3";

export const r2Configured = () =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);

let client: S3Client | undefined;

export function r2(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "auto", // required by the SDK, ignored by R2
      // EU-jurisdiction buckets use https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com: set R2_ENDPOINT for those.
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // Recent AWS SDK versions add CRC32 checksums by default; R2 rejects them (501 NotImplemented).
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export const bucket = () => process.env.R2_BUCKET!;
