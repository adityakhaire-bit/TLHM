import { UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextResponse } from "next/server";
import { z } from "zod";
import { UPLOAD_URL_TTL_SECONDS } from "@/lib/r2/client";
import { getUploadContext } from "@/lib/uploads/server";

export const runtime = "nodejs";
const bodySchema = z.object({ partNumber: z.number().int().min(1).max(10000) });

export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const upload = await getUploadContext(assetId);
  if ("error" in upload) return NextResponse.json({ error: upload.error }, { status: upload.status });
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid part number" }, { status: 400 });
  const maxParts = Math.ceil(upload.session.expected_bytes / upload.session.part_size_bytes);
  if (parsed.data.partNumber > maxParts) return NextResponse.json({ error: "Part number is outside the expected file size" }, { status: 400 });
  const expectedPartBytes = Math.min(
    upload.session.part_size_bytes,
    upload.session.expected_bytes - (parsed.data.partNumber - 1) * upload.session.part_size_bytes,
  );
  try {
    const url = await getSignedUrl(upload.r2.client, new UploadPartCommand({
      Bucket: upload.r2.bucket,
      Key: upload.asset.object_key,
      UploadId: upload.session.provider_upload_id,
      PartNumber: parsed.data.partNumber,
      ContentLength: expectedPartBytes,
    }), { expiresIn: UPLOAD_URL_TTL_SECONDS });
    return NextResponse.json({ url, expiresInSeconds: UPLOAD_URL_TTL_SECONDS });
  } catch {
    return NextResponse.json({ error: "Could not create a temporary upload link" }, { status: 502 });
  }
}
