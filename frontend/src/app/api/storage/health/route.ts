import { requireUser } from "@/server/auth";
import { fail, ok, route } from "@/server/http";
import { checkStorage, diskUsage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Is the media drive mounted, trusted (marker file) and writable right now? */
export const GET = route(async (request) => {
  await requireUser(request);
  const check = await checkStorage();
  if (!check.ok) return fail(503, check.message, "storage_unavailable", { drive: check.drive, reason: check.reason });
  const usage = await diskUsage(check.root);
  return ok({ drive: check.drive, mounted: true, writable: true, ...usage });
});
