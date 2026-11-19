import { destroySession, SESSION_COOKIE, sessionTokenFrom } from "@/server/auth";
import { ok, route } from "@/server/http";

export const runtime = "nodejs";

export const POST = route(async (request) => {
  await destroySession(sessionTokenFrom(request));
  const response = ok({ signedOut: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", expires: new Date(0) });
  return response;
});
