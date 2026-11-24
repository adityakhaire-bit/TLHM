import { z } from "zod";
import { requireUser } from "@/server/auth";
import { ApiError, ok, readJson, route } from "@/server/http";
import { lanGuestEnabled, setLanGuestEnabled } from "@/server/lan-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether people on the office Wi-Fi can browse without signing in. */
export const GET = route(async (request) => {
  await requireUser(request);
  return ok({ enabled: await lanGuestEnabled() });
});

/** Switch office Wi-Fi guest access on or off. Admins only. */
export const POST = route(async (request) => {
  await requireUser(request, "admin");
  const parsed = z.object({ enabled: z.boolean() }).safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "enabled must be true or false", "invalid_body");
  const { enabled } = parsed.data;
  await setLanGuestEnabled(enabled);
  return ok({ enabled });
});
