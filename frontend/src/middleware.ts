import { NextResponse, type NextRequest } from "next/server";
import { isOfficeNetworkRequest } from "@/server/lan-detect";

const SESSION_COOKIE = "tmh_session";

/**
 * Quick redirect to /login for pages when there is no session cookie at all.
 * This is only a convenience: every page and API route validates the session against the
 * database itself (fail closed). API routes are excluded from the matcher on purpose, so large
 * upload bodies are streamed straight to the route instead of being buffered by middleware.
 */
export function middleware(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  // Office Wi-Fi visitors: the page itself decides (guest access may be switched off by an admin).
  if (isOfficeNetworkRequest(request.headers)) return NextResponse.next();
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!api/|login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
