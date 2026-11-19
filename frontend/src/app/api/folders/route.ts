import { z } from "zod";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ApiError, ok, readJson, route } from "@/server/http";
import { ancestorChain, cleanFolderName, createFolderSchema, MAX_FOLDER_DEPTH } from "@/lib/folders/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All folders (flat list with parent ids and item counts); the UI builds the tree. */
export const GET = route(async (request) => {
  await requireUser(request);
  const folders = await prisma.folder.findMany({
    orderBy: [{ name: "asc" }],
    include: { _count: { select: { children: true, media: { where: { deletedAt: null } } } } },
  });
  return ok({
    folders: folders.map((folder) => ({
      id: folder.id, name: folder.name, parentId: folder.parentId, description: folder.description,
      createdAt: folder.createdAt, childCount: folder._count.children, mediaCount: folder._count.media,
    })),
  });
});

export const POST = route(async (request) => {
  await requireUser(request, "editor");
  const parsed = createFolderSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Invalid folder details", "invalid_body", z.flattenError(parsed.error).fieldErrors);
  const name = cleanFolderName(parsed.data.name);
  if (!name) throw new ApiError(400, "Folder name is required", "invalid_body");
  const parentId = parsed.data.parentId ?? null;

  if (parentId !== null) {
    const all = await prisma.folder.findMany({ select: { id: true, parentId: true } });
    const parentOf = new Map(all.map((folder) => [folder.id, folder.parentId]));
    if (!parentOf.has(parentId)) throw new ApiError(404, "Parent folder not found", "folder_not_found");
    if (ancestorChain(parentId, parentOf).length >= MAX_FOLDER_DEPTH) throw new ApiError(400, `Folders can be nested up to ${MAX_FOLDER_DEPTH} levels`, "too_deep");
  }
  const clash = await prisma.folder.findFirst({ where: { parentId, name } });
  if (clash) throw new ApiError(409, "A folder with that name already exists here", "folder_exists");

  const folder = await prisma.folder.create({ data: { name, parentId, description: parsed.data.description ?? null } });
  return ok({ folder }, 201);
});
