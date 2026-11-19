import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ok, parseUuid, route } from "@/server/http";
import { mediaInclude, serializeMedia } from "@/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Processing status of an uploaded file (polled by the upload screen). */
export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireUser(request);
  const id = parseUuid((await params).id);
  const media = await prisma.mediaFile.findUniqueOrThrow({ where: { id }, include: mediaInclude });
  const serialized = serializeMedia(media);
  return ok({ id, processingStatus: serialized.processingStatus, uploadStatus: serialized.uploadStatus, jobs: serialized.jobs, media: serialized });
});
