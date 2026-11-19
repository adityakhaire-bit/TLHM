import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { listMedia } from "@/server/library";
import { parseSearchParams } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Media library with search, filters, sorting and pagination (see docs/API.md for parameters). */
export const GET = route(async (request) => {
  await requireUser(request);
  return ok(await listMedia(parseSearchParams(new URL(request.url))));
});
