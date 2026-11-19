import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";
import { getStorageStatus } from "@/server/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Storage dashboard: real drive capacity, media sizes, database counts, last backup, job counts. */
export const GET = route(async (request) => {
  await requireUser(request);
  return ok(await getStorageStatus());
});
