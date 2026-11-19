import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ApiError, ok, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["queued", "running", "completed", "failed"] as const;

/** Processing jobs, newest first. ?status=queued|running|completed|failed&limit=50 */
export const GET = route(async (request) => {
  await requireUser(request);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  if (status && !STATUSES.includes(status as (typeof STATUSES)[number])) throw new ApiError(400, "Invalid status", "invalid_query");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 200);
  const jobs = await prisma.processingJob.findMany({
    where: status ? { status: status as (typeof STATUSES)[number] } : {},
    orderBy: { id: "desc" },
    take: limit,
    include: { media: { select: { id: true, title: true, originalFilename: true, mediaType: true } } },
  });
  return ok({ jobs });
});
