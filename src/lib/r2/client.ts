import { S3Client } from "@aws-sdk/client-s3";

export const UPLOAD_PART_SIZE = 64 * 1024 * 1024;
export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const MAX_UPLOAD_BYTES = 9_000_000_000;

export type R2Config = { accountId: string; bucket: string; client: S3Client };

export function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  const endpoint = process.env.R2_S3_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`;
  return {
    accountId,
    bucket,
    client: new S3Client({
      region: "auto",
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    }),
  };
}
