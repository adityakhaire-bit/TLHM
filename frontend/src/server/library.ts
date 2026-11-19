import { prisma } from "./db";
import { mediaInclude, serializeMedia } from "./media";
import { buildMediaOrder, buildMediaWhere, type SearchParams } from "./search";

/** Paginated media list shared by GET /api/media and GET /api/search. */
export async function listMedia(params: SearchParams) {
  const where = buildMediaWhere(params);
  const [total, items] = await Promise.all([
    prisma.mediaFile.count({ where }),
    prisma.mediaFile.findMany({
      where,
      include: mediaInclude,
      orderBy: buildMediaOrder(params.sort),
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
  ]);
  return {
    items: items.map(serializeMedia),
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    // Lets the UI know it should keep polling for processing updates.
    processingCount: items.filter((item) => item.processingStatus === "pending" || item.processingStatus === "processing").length,
  };
}
