import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { fileResponse } from "@/server/file-response";
import { ApiError, parseUuid, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams the lightweight preview with Range support (seeking). Videos and audio play from the proxy only;
 * originals are never streamed for normal browsing. Images are shown directly.
 */
async function handler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const id = parseUuid((await params).id);
  const media = await prisma.mediaFile.findFirst({
    where: { id, deletedAt: null },
    select: { mediaType: true, mimeType: true, originalPath: true, proxyPath: true },
  });
  if (!media) throw new ApiError(404, "Media not found", "not_found");
  if (media.mediaType === "image") {
    return fileResponse({ relativePath: media.originalPath, mimeType: media.mimeType, request, cacheSeconds: 3600 });
  }
  if (!media.proxyPath) throw new ApiError(409, "The preview is still being generated. Try again shortly.", "preview_not_ready");
  return fileResponse({ relativePath: media.proxyPath, mimeType: media.mediaType === "video" ? "video/mp4" : "audio/mp4", request, cacheSeconds: 3600 });
}

export const GET = route(handler);
export const HEAD = route(handler);
