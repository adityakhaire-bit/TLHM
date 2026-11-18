import { CompleteMultipartUploadCommand, HeadObjectCommand, ListPartsCommand, type HeadObjectCommandOutput } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { getUploadContext } from "@/lib/uploads/server";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  const upload = await getUploadContext(assetId);
  if ("error" in upload) return NextResponse.json({ error: upload.error }, { status: upload.status });
  try {
    const findCompletedObject = async (): Promise<HeadObjectCommandOutput | null> => {
      try { return await upload.r2.client.send(new HeadObjectCommand({ Bucket: upload.r2.bucket, Key: upload.asset.object_key })); }
      catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404) return null;
        throw error;
      }
    };
    let metadata = await findCompletedObject();
    if (!metadata) {
      try {
        const parts: { PartNumber: number; ETag: string }[] = [];
        let marker: number | undefined;
        let totalBytes = 0;
        do {
          const listed = await upload.r2.client.send(new ListPartsCommand({
            Bucket: upload.r2.bucket,
            Key: upload.asset.object_key,
            UploadId: upload.session.provider_upload_id,
            PartNumberMarker: marker,
          }));
          for (const part of listed.Parts ?? []) {
            if (!part.PartNumber || !part.ETag || !part.Size) throw new Error("R2 returned incomplete part metadata");
            parts.push({ PartNumber: part.PartNumber, ETag: part.ETag });
            totalBytes += part.Size;
          }
          marker = listed.IsTruncated ? listed.NextPartNumberMarker : undefined;
        } while (marker !== undefined);

        const expectedParts = Math.ceil(upload.session.expected_bytes / upload.session.part_size_bytes);
        if (parts.length !== expectedParts || totalBytes !== upload.session.expected_bytes) {
          return NextResponse.json({ error: "Upload is incomplete. Retry missing parts before completing." }, { status: 409 });
        }
        parts.sort((a, b) => a.PartNumber - b.PartNumber);
        await upload.r2.client.send(new CompleteMultipartUploadCommand({
          Bucket: upload.r2.bucket,
          Key: upload.asset.object_key,
          UploadId: upload.session.provider_upload_id,
          MultipartUpload: { Parts: parts },
        }));
      } catch (error) {
        // A lost response can leave the object complete even though this request saw an error.
        metadata = await findCompletedObject();
        if (!metadata) throw error;
      }
      metadata ??= await findCompletedObject();
    }
    if (!metadata) throw new Error("R2 did not return the uploaded object");
    if (metadata.ContentLength !== upload.session.expected_bytes) throw new Error("Uploaded object size does not match the reservation");

    const { data: status, error: finalizeError } = await upload.supabase.rpc("finalize_asset_upload", { p_asset_id: assetId });
    if (finalizeError || (status !== "processing" && status !== "pending_review")) throw new Error("The file uploaded, but its asset record could not be finalized");
    return NextResponse.json({ assetId, status, sizeBytes: metadata.ContentLength });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not complete the upload";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
