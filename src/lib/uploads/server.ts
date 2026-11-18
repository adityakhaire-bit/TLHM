import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getR2Config } from "@/lib/r2/client";

export async function getUploadContext(assetId: string) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: "Supabase is not configured", status: 503 as const };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Authentication required", status: 401 as const };
  const r2 = getR2Config();
  if (!r2) return { error: "Cloudflare R2 is not configured", status: 503 as const };
  const { data: profile } = await supabase.from("profiles").select("role, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !["admin", "manager", "contributor", "editor"].includes(profile.role)) {
    return { error: "Your account does not have upload access", status: 403 as const };
  }
  const { data: asset } = await supabase.from("assets").select("id, object_key, file_size_bytes, mime_type, status, uploaded_by, folder_id").eq("id", assetId).maybeSingle();
  if (!asset) return { error: "Upload not found", status: 404 as const };
  if (asset.uploaded_by !== user.id && !["admin", "manager"].includes(profile.role)) {
    return { error: "You cannot manage this upload", status: 403 as const };
  }
  if (asset.status !== "uploading") return { error: "This asset is no longer being uploaded", status: 409 as const };
  const { data: session } = await supabase.from("upload_sessions").select("provider_upload_id, expected_bytes, part_size_bytes, state, expires_at").eq("asset_id", asset.id).maybeSingle();
  if (!session) return { error: "Upload session not found", status: 404 as const };
  if (session.state !== "uploading" || new Date(session.expires_at).getTime() < Date.now()) {
    return { error: "Upload session has expired or is no longer active", status: 409 as const };
  }
  return { supabase, user, r2, asset, session, profile };
}
