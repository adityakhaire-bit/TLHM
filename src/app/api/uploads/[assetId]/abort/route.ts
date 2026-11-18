import { AbortMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getUploadContext } from "@/lib/uploads/server";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const upload = await getUploadContext(assetId);
  if ("error" in upload) return NextResponse.json({ error: upload.error }, { status: upload.status });
  try {
    await upload.r2.client.send(new AbortMultipartUploadCommand({
      Bucket: upload.r2.bucket,
      Key: upload.asset.object_key,
      UploadId: upload.session.provider_upload_id,
    }));
    const [sessionResult, assetResult] = await Promise.all([
      upload.supabase.from("upload_sessions").update({ state: "aborted" }).eq("asset_id", assetId),
      upload.supabase.from("assets").update({ status: "failed" }).eq("id", assetId),
    ]);
    if (sessionResult.error || assetResult.error) return NextResponse.json({ error: "Upload was aborted, but the database state did not fully update" }, { status: 500 });
    return NextResponse.json({ assetId, status: "aborted" });
  } catch {
    return NextResponse.json({ error: "Could not abort this upload" }, { status: 502 });
  }
}
