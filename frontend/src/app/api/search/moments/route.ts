import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ApiError, ok, route } from "@/server/http";
import { searchMoments } from "@/server/moments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/search/moments?q=talking in a black t-shirt — exact video moments from AI metadata. */
export const GET = route(async (request) => {
  await requireUser(request);
  const q = z.string().trim().min(1).max(200).safeParse(new URL(request.url).searchParams.get("q"));
  if (!q.success) throw new ApiError(400, "Type something to search for", "invalid_query");
  return ok(await searchMoments(q.data));
});
