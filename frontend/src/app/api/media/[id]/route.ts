import { z } from "zod";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ApiError, ok, parseUuid, readJson, route } from "@/server/http";
import { mediaInclude, serializeMedia, setMediaTags } from "@/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function loadLive(id: string) {
  const media = await prisma.mediaFile.findFirst({ where: { id, deletedAt: null }, include: mediaInclude });
  if (!media) throw new ApiError(404, "Media not found", "not_found");
  return media;
}

export const GET = route<Context>(async (request, { params }) => {
  await requireUser(request);
  return ok({ media: serializeMedia(await loadLive(parseUuid((await params).id))) });
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
  folderId: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().max(64)).max(30).optional(),
}).refine((value) => Object.keys(value).length > 0, "Nothing to update");

/** Edit metadata, tags, or move the media to another folder. */
export const PATCH = route<Context>(async (request, { params }) => {
  await requireUser(request, "editor");
  const id = parseUuid((await params).id);
  await loadLive(id);
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Invalid changes", "invalid_body", z.flattenError(parsed.error).fieldErrors);
  const { tags, folderId, category, ...fields } = parsed.data;
  if (folderId) {
    const folder = await prisma.folder.findUnique({ where: { id: folderId }, select: { id: true } });
    if (!folder) throw new ApiError(404, "Folder not found", "folder_not_found");
  }
  await prisma.$transaction(async (tx) => {
    await tx.mediaFile.update({
      where: { id },
      data: {
        ...fields,
        ...(category !== undefined ? { category: category || null } : {}),
        ...(folderId !== undefined ? { folderId } : {}),
      },
    });
    if (tags) await setMediaTags(tx, id, tags);
  });
  return ok({ media: serializeMedia(await loadLive(id)) });
});

/**
 * Removes the media from the library (admin only). This is a soft delete: the original file stays on the SSD
 * and the record can be restored by uploading the same file again. Nothing is permanently deleted here.
 */
export const DELETE = route<Context>(async (request, { params }) => {
  await requireUser(request, "admin");
  const id = parseUuid((await params).id);
  await loadLive(id);
  await prisma.mediaFile.update({ where: { id }, data: { deletedAt: new Date() } });
  return ok({ id, deleted: true, originalKept: true });
});
