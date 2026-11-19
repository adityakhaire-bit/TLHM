import { z } from "zod";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ApiError, ok, parseId, readJson, route } from "@/server/http";
import { ancestorChain, cleanFolderName, MAX_FOLDER_DEPTH, updateFolderSchema } from "@/lib/folders/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

/** Rename, move (re-parent) or describe a folder. Moves that would create a loop or exceed 8 levels are rejected. */
export const PATCH = route<Context>(async (request, { params }) => {
  await requireUser(request, "editor");
  const id = parseId((await params).id, "folder id");
  const parsed = updateFolderSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Invalid folder update", "invalid_body", z.flattenError(parsed.error).fieldErrors);

  const all = await prisma.folder.findMany({ select: { id: true, parentId: true, name: true } });
  const current = all.find((folder) => folder.id === id);
  if (!current) throw new ApiError(404, "Folder not found", "not_found");
  const parentOf = new Map(all.map((folder) => [folder.id, folder.parentId]));

  const name = parsed.data.name !== undefined ? cleanFolderName(parsed.data.name) : current.name;
  if (!name) throw new ApiError(400, "Folder name is required", "invalid_body");
  const parentId = parsed.data.parentId !== undefined ? parsed.data.parentId : current.parentId;

  if (parentId !== null) {
    if (!parentOf.has(parentId)) throw new ApiError(404, "Destination folder not found", "folder_not_found");
    if (ancestorChain(parentId, parentOf).includes(id)) throw new ApiError(400, "A folder cannot be moved inside itself", "folder_cycle");
    // Depth of destination + depth of the deepest branch under this folder.
    const childrenOf = new Map<number, number[]>();
    for (const folder of all) if (folder.parentId !== null) childrenOf.set(folder.parentId, [...(childrenOf.get(folder.parentId) ?? []), folder.id]);
    const subtreeDepth = (folderId: number): number => 1 + Math.max(0, ...(childrenOf.get(folderId) ?? []).map(subtreeDepth));
    if (ancestorChain(parentId, parentOf).length + subtreeDepth(id) > MAX_FOLDER_DEPTH) {
      throw new ApiError(400, `Folders can be nested up to ${MAX_FOLDER_DEPTH} levels`, "too_deep");
    }
  }
  if (all.some((folder) => folder.id !== id && folder.parentId === parentId && folder.name.toLowerCase() === name.toLowerCase())) {
    throw new ApiError(409, "A folder with that name already exists there", "folder_exists");
  }

  const folder = await prisma.folder.update({
    where: { id },
    data: { name, parentId, ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}) },
  });
  return ok({ folder });
});

/** Deletes an EMPTY folder only. Folders containing sub-folders or media are refused; media is never deleted here. */
export const DELETE = route<Context>(async (request, { params }) => {
  await requireUser(request, "editor");
  const id = parseId((await params).id, "folder id");
  const folder = await prisma.folder.findUnique({
    where: { id },
    include: { _count: { select: { children: true, media: { where: { deletedAt: null } } } } },
  });
  if (!folder) throw new ApiError(404, "Folder not found", "not_found");
  if (folder._count.children > 0 || folder._count.media > 0) {
    throw new ApiError(409, `“${folder.name}” is not empty (${folder._count.media} media, ${folder._count.children} sub-folders). Move or remove its contents first.`, "folder_not_empty");
  }
  await prisma.$transaction([
    // Items removed from the library earlier keep their files; they just lose this folder reference.
    prisma.mediaFile.updateMany({ where: { folderId: id, deletedAt: { not: null } }, data: { folderId: null } }),
    prisma.folder.delete({ where: { id } }),
  ]);
  return ok({ id, deleted: true });
});
