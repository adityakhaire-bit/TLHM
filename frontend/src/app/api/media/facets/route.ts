import { requireUser } from "@/server/auth";
import { aiFacets } from "@/server/facets";
import { ok, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/media/facets — "Browse by AI" filter options (clothing, colours, poses, actions...) with clip counts. */
export const GET = route(async (request) => {
  await requireUser(request);
  return ok({ groups: await aiFacets() });
});
