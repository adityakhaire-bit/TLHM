import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createFolderSchema, slugifyFolderName } from "@/lib/folders/validation";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const parent = searchParams.get("parent_id");
  const collection = searchParams.get("collection_id");
  const all = searchParams.get("all") === "true";
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 100), 1), 200);
  let query = supabase.from("folders").select("id, name, slug, parent_id, collection_id, description, icon, color, sort_order, is_archived, is_private, require_approval, created_at, updated_at").eq("is_archived", false).order("sort_order").order("name").limit(limit);
  if (all) query = query.order("parent_id", { nullsFirst: true });
  else query = parent ? query.eq("parent_id", parent) : query.is("parent_id", null);
  if (collection) query = query.eq("collection_id", collection);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Unable to load folders" }, { status: 500 });
  return NextResponse.json({ folders: data });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 }); }
  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid folder details", details: parsed.error.flatten() }, { status: 400 });
  const { data, error } = await supabase.from("folders").insert({
    ...parsed.data,
    slug: slugifyFolderName(parsed.data.name),
    created_by: user.id,
  }).select("id, name, slug, parent_id, collection_id, description, icon, color, sort_order, is_archived, is_private, require_approval, created_at, updated_at").single();
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "A folder with that name already exists at this level" }, { status: 409 });
    if (error.message.includes("nesting is limited")) return NextResponse.json({ error: "Folders can be nested up to 8 levels" }, { status: 400 });
    return NextResponse.json({ error: "Unable to create folder. Check your role and parent folder access." }, { status: 403 });
  }
  return NextResponse.json({ folder: data }, { status: 201 });
}
