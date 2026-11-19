import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ok, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tags and categories in use (for filters and autocomplete). */
export const GET = route(async (request) => {
  await requireUser(request);
  const [tags, categories] = await Promise.all([
    prisma.tag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { media: true } } }, take: 500 }),
    prisma.mediaFile.groupBy({ by: ["category"], where: { deletedAt: null, category: { not: null } }, _count: { _all: true }, orderBy: { category: "asc" } }),
  ]);
  return ok({
    tags: tags.map((tag) => ({ name: tag.name, count: tag._count.media })),
    categories: categories.map((group) => ({ name: group.category as string, count: group._count._all })),
  });
});
