import { prisma } from "./db";

export type Facet = { key: string; label: string; count: number };
export type FacetGroup = { id: string; title: string; facets: Facet[] };

type Row = { category: string; value: string | null; color: string | null; n: bigint | number };

/**
 * "Browse by AI" filter options with the number of clips that contain each one.
 * key is the `attr` search parameter value: "category|value|color".
 */
export async function aiFacets(limit = 14): Promise<FacetGroup[]> {
  const live = "a.media_id IN (SELECT id FROM media_files WHERE deleted_at IS NULL)";
  const [attributes, colors, categories] = await Promise.all([
    prisma.$queryRawUnsafe<Row[]>(
      `SELECT a.category, a.value, IF(a.category = 'clothing', a.color, NULL) AS color, COUNT(DISTINCT a.media_id) AS n
       FROM analysis_attributes a WHERE ${live} AND a.category IN ('clothing', 'accessory', 'pose', 'action', 'shot', 'setting')
       GROUP BY a.category, a.value, IF(a.category = 'clothing', a.color, NULL) ORDER BY n DESC, a.value LIMIT 400`,
    ),
    prisma.$queryRawUnsafe<Row[]>(
      `SELECT 'clothing' AS category, NULL AS value, a.color, COUNT(DISTINCT a.media_id) AS n
       FROM analysis_attributes a WHERE ${live} AND a.category = 'clothing' AND a.color IS NOT NULL
       GROUP BY a.color ORDER BY n DESC LIMIT 30`,
    ),
    prisma.mediaFile.groupBy({ by: ["category"], where: { deletedAt: null, category: { not: null } }, _count: { _all: true }, orderBy: { _count: { category: "desc" } } }),
  ]);

  const facet = (row: Row): Facet => ({
    key: `${row.category}|${row.value ?? ""}|${row.color ?? ""}`,
    label: [row.color, row.value].filter(Boolean).join(" "),
    count: Number(row.n),
  });
  const pick = (category: string) => attributes.filter((row) => row.category === category).slice(0, limit).map(facet);

  return [
    { id: "category", title: "Category", facets: categories.map((row) => ({ key: `category:${row.category}`, label: row.category ?? "", count: row._count._all })) },
    { id: "clothing", title: "Clothing", facets: pick("clothing") },
    { id: "color", title: "Clothing colour", facets: colors.slice(0, limit).map(facet) },
    { id: "pose", title: "Pose", facets: pick("pose") },
    { id: "action", title: "Action", facets: pick("action") },
    { id: "shot", title: "Shot type", facets: pick("shot") },
    { id: "setting", title: "Setting", facets: pick("setting") },
    { id: "accessory", title: "Accessories", facets: pick("accessory") },
  ].filter((group) => group.facets.length > 0);
}
