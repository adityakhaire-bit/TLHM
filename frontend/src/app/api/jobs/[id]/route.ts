import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ok, parseId, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireUser(request);
  const id = parseId((await params).id, "job id");
  const job = await prisma.processingJob.findUniqueOrThrow({
    where: { id },
    include: { media: { select: { id: true, title: true, originalFilename: true, mediaType: true, processingStatus: true } } },
  });
  return ok({ job });
});
