import { queueAnalysis } from "@/server/ai-analysis";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { geminiConfigured } from "@/server/gemini";
import { ApiError, ok, parseUuid, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

async function load(id: string) {
  const media = await prisma.mediaFile.findFirst({ where: { id, deletedAt: null }, select: { id: true, mediaType: true } });
  if (!media) throw new ApiError(404, "Media not found", "not_found");
  const [job, analysis] = await Promise.all([
    prisma.processingJob.findFirst({ where: { mediaId: id, jobType: "analyze" }, orderBy: { id: "desc" }, select: { id: true, status: true, attempts: true, errorMessage: true, runAfter: true, startedAt: true } }),
    prisma.mediaAnalysis.findUnique({
      where: { mediaId: id },
      omit: { rawJson: true, searchText: true },
      include: {
        segments: { orderBy: { startMs: "asc" }, omit: { searchText: true }, include: { attributes: { select: { category: true, value: true, color: true, pattern: true, bodyRegion: true, personLabel: true } } } },
        transcript: { orderBy: { startMs: "asc" }, select: { startMs: true, endMs: true, speaker: true, text: true } },
      },
    }),
  ]);
  return { configured: geminiConfigured(), supported: media.mediaType === "video", job, analysis };
}

/** AI metadata for one media item, plus the state of its analysis job. */
export const GET = route<Context>(async (request, { params }) => {
  await requireUser(request);
  return ok(await load(parseUuid((await params).id)));
});

/** Queue (re-)analysis. Editors and admins. */
export const POST = route<Context>(async (request, { params }) => {
  await requireUser(request, "editor");
  const id = parseUuid((await params).id);
  const state = await load(id);
  if (!state.configured) throw new ApiError(503, "AI analysis is switched off: add GEMINI_API_KEY to .env and restart", "ai_disabled");
  if (!state.supported) throw new ApiError(400, "AI analysis currently supports videos only", "unsupported");
  await queueAnalysis(id);
  return ok(await load(id), 202);
});
