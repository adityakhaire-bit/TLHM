import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { listMedia } from "@/server/library";
import { parseSearchParams } from "@/server/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same as GET /api/media; kept as a separate, self-describing search endpoint. */
export const GET = route(async (request) => {
  await requireUser(request);
  return ok(await listMedia(parseSearchParams(new URL(request.url))));
});
