import { randomUUID } from "node:crypto";
import { AbortMultipartUploadCommand, CreateMultipartUploadCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getR2Config, UPLOAD_PART_SIZE } from "@/lib/r2/client";
import { classifyMediaType, initiateUploadSchema } from "@/lib/uploads/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const r2 = getR2Config();
  if (!r2) return NextResponse.json({ error: "Cloudflare R2 is not configured" }, { status: 503 });

  const { data: profile, error: profileError } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (profileError || !profile?.is_active || !["admin", "manager", "contributor", "editor"].includes(profile.role)) {
    return NextResponse.json({ error: "Your account does not have upload access" }, { status: 403 });
  }

  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  const parsed = initiateUploadSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid upload details", details: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;

  if (input.folderId) {
    const { data: folder, error } = await supabase.from("folders").select("id, collection_id, require_approval").eq("id", input.folderId).maybeSingle();
    if (error || !folder) return NextResponse.json({ error: "Folder not found or you do not have access" }, { status: 403 });
    if (input.collectionId && folder.collection_id && input.collectionId !== folder.collection_id) {
      return NextResponse.json({ error: "The selected collection does not match the folder" }, { status: 400 });
    }
    if (!input.collectionId && folder.collection_id) input.collectionId = folder.collection_id;
  }

  const assetId = randomUUID();
  const objectKey = `assets/${user.id}/${assetId}/source`;
  let providerUploadId: string | undefined;
  try {
    const initiated = await r2.client.send(new CreateMultipartUploadCommand({
      Bucket: r2.bucket,
      Key: objectKey,
      ContentType: input.mimeType,
      Metadata: { assetid: assetId, uploadedby: user.id },
    }));
    providerUploadId = initiated.UploadId;
    if (!providerUploadId) throw new Error("R2 did not return a multipart upload id");

    const { error: assetError } = await supabase.from("assets").insert({
      id: assetId,
      folder_id: input.folderId ?? null,
      collection_id: input.collectionId ?? null,
      title: input.title,
      description: input.description ?? null,
      original_filename: input.filename,
      object_key: objectKey,
      storage_provider: "r2",
      mime_type: input.mimeType,
      media_type: classifyMediaType(input.mimeType),
      file_size_bytes: input.sizeBytes,
      status: "uploading",
      uploaded_by: user.id,
    });
    if (assetError) throw new Error(assetError.code === "42501" ? "You do not have permission to upload to this folder" : "Could not create the asset record");

    const { error: sessionError } = await supabase.rpc("reserve_upload_session", {
      p_asset_id: assetId,
      p_provider_upload_id: providerUploadId,
      p_expected_bytes: input.sizeBytes,
      p_part_size_bytes: UPLOAD_PART_SIZE,
    });
    if (sessionError) {
      await supabase.from("assets").update({ status: "failed" }).eq("id", assetId);
      throw new Error(sessionError.message.includes("storage_budget_exceeded")
        ? "The workspace storage budget is full. Ask an administrator to review storage usage."
        : "Could not reserve upload space. Check the workspace storage limit and database migration.");
    }

    return NextResponse.json({
      assetId,
      partSizeBytes: UPLOAD_PART_SIZE,
      partCount: Math.ceil(input.sizeBytes / UPLOAD_PART_SIZE),
      expiresInSeconds: 24 * 60 * 60,
    }, { status: 201 });
  } catch (error) {
    if (providerUploadId) {
      try { await r2.client.send(new AbortMultipartUploadCommand({ Bucket: r2.bucket, Key: objectKey, UploadId: providerUploadId })); } catch { /* Expiration cleanup can remove abandoned multipart uploads. */ }
    }
    const message = error instanceof Error ? error.message : "Could not start the upload";
    const status = message.includes("permission") ? 403 : message.includes("budget") || message.includes("storage limit") ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
