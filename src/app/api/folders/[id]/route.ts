import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { slugifyFolderName, updateFolderSchema } from "@/lib/folders/validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  const parsed = updateFolderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid folder update", details: parsed.error.flatten() }, { status: 400 });
  const patch = { ...parsed.data, ...(parsed.data.name ? { slug: slugifyFolderName(parsed.data.name) } : {}) };
  const { data, error } = await supabase.from("folders").update(patch).eq("id", id).select("id, name, slug, parent_id, collection_id, description, icon, color, sort_order, is_archived, is_private, require_approval, updated_at").maybeSingle();
  if (error) return NextResponse.json({ error: error.message.includes("nesting is limited") ? "Folders can be nested up to 8 levels" : "Unable to update folder. Check your role and folder access." }, { status: error.code === "23505" ? 409 : 403 });
  if (!data) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  return NextResponse.json({ folder: data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Invalid folder id" }, { status: 400 });
  // Archive only: retain folder and asset associations so no data is lost by an accidental delete.
  const { data, error } = await supabase.from("folders").update({ is_archived: true }).eq("id", id).select("id, name, is_archived").maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to archive folder. Administrator access is required." }, { status: 403 });
  if (!data) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  return NextResponse.json({ folder: data });
}
