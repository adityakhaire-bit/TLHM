import { requireUser } from "@/server/auth";
import { ok, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async (request) => ok({ user: await requireUser(request) }));
