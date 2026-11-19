import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { fileResponse } from "@/server/file-response";
import { ApiError, parseUuid, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloads the original (default) or the proxy, streamed from the SSD with Range support for resuming.
 * The file is saved under its original filename; internal paths are never exposed.
 *   ?variant=original | proxy
 */
async function handler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireUser(request);
  const id = parseUuid((await params).id);
  const variant = new URL(request.url).searchParams.get("variant") ?? "original";
  if (variant !== "original" && variant !== "proxy") throw new ApiError(400, "variant must be 'original' or 'proxy'", "invalid_variant");

  const media = await prisma.mediaFile.findFirst({
    where: { id, deletedAt: null },
    select: { originalFilename: true, mimeType: true, originalPath: true, proxyPath: true, mediaType: true },
  });
  if (!media) throw new ApiError(404, "Media not found", "not_found");

  if (variant === "original") {
    return fileResponse({ relativePath: media.originalPath, mimeType: media.mimeType, request, downloadName: media.originalFilename });
  }
  if (!media.proxyPath) throw new ApiError(409, "This file has no proxy (yet).", "proxy_not_ready");
  const base = media.originalFilename.replace(/\.[^.]{1,8}$/, "");
  const ext = media.mediaType === "video" ? "mp4" : "m4a";
  return fileResponse({
    relativePath: media.proxyPath,
    mimeType: media.mediaType === "video" ? "video/mp4" : "audio/mp4",
    request,
    downloadName: `${base} (proxy).${ext}`,
  });
}

export const GET = route(handler);
export const HEAD = route(handler);
