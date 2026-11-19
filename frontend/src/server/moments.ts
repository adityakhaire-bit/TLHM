import type { Prisma } from "@/generated/prisma/client";
import { expandQuery } from "./ai-vocabulary";
import { prisma } from "./db";

const segmentInclude = {
  analysis: { select: { media: { select: { id: true, title: true, originalFilename: true, thumbnailPath: true, duration: true, deletedAt: true } } } },
  attributes: { select: { category: true, value: true, color: true, pattern: true, personLabel: true } },
} satisfies Prisma.VideoSegmentInclude;

const live = { analysis: { media: { deletedAt: null } } } satisfies Prisma.VideoSegmentWhereInput;

function groupWhere(group: string[]): Prisma.VideoSegmentWhereInput {
  return { OR: group.map((word) => ({ searchText: { contains: word } })) };
}

/**
 * Finds exact moments (video segments) whose AI metadata matches every meaningful word of the query,
 * using synonyms ("tee" = "t-shirt"). Runs only against the database: no AI call per search.
 * Words that match nothing at all (e.g. a name the AI never saw) are ignored and reported back.
 */
export async function searchMoments(query: string, limit = 40) {
  const groups = expandQuery(query);
  if (!groups.length) return { moments: [], ignored: [] as string[], total: 0 };

  const counts = await Promise.all(groups.map((group) => prisma.videoSegment.count({ where: { AND: [live, groupWhere(group)] } })));
  const usable = groups.filter((_, index) => counts[index] > 0);
  const ignored = groups.filter((_, index) => counts[index] === 0).map((group) => group[1] ?? group[0]);
  if (!usable.length) return { moments: [], ignored, total: 0 };

  const where: Prisma.VideoSegmentWhereInput = { AND: [live, ...usable.map(groupWhere)] };
  const [total, segments] = await Promise.all([
    prisma.videoSegment.count({ where }),
    prisma.videoSegment.findMany({ where, include: segmentInclude, orderBy: [{ mediaId: "asc" }, { startMs: "asc" }], take: limit }),
  ]);

  const moments = segments.map((segment) => {
    const media = segment.analysis.media;
    const matched = segment.attributes
      .filter((attribute) => usable.some((group) => group.some((word) => [attribute.value, attribute.color ?? ""].some((text) => text.includes(word)))))
      .map((attribute) => [attribute.color, attribute.pattern, attribute.value].filter(Boolean).join(" "));
    return {
      segmentId: segment.id,
      mediaId: media.id,
      title: media.title,
      filename: media.originalFilename,
      thumbnail: media.thumbnailPath ? `/api/media/${media.id}/thumbnail` : null,
      startMs: segment.startMs,
      endMs: segment.endMs,
      description: segment.description,
      shotType: segment.shotType,
      matched: [...new Set(matched)].slice(0, 8),
    };
  });
  return { moments, ignored, total };
}
