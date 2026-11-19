import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { fileResponse } from "@/server/file-response";
import { ApiError, parseUuid, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireUser(request);
  const id = parseUuid((await params).id);
  const media = await prisma.mediaFile.findFirst({ where: { id, deletedAt: null }, select: { thumbnailPath: true } });
  if (!media) throw new ApiError(404, "Media not found", "not_found");
  if (!media.thumbnailPath) throw new ApiError(404, "No thumbnail yet", "thumbnail_not_ready");
  return fileResponse({ relativePath: media.thumbnailPath, mimeType: "image/jpeg", request, cacheSeconds: 86400 });
});
