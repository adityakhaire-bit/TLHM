import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ApiError, ok, parseId, route } from "@/server/http";
import { retryJob } from "@/server/jobs";

export const runtime = "nodejs";

/** Re-queue a failed processing job. The original file is untouched either way. */
export const POST = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  await requireUser(request, "editor");
  const id = parseId((await params).id, "job id");
  const job = await prisma.processingJob.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (job.status !== "failed") throw new ApiError(409, "Only failed jobs can be retried", "not_failed");
  return ok({ job: await retryJob(id) });
});
