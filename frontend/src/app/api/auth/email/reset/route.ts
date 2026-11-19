import { emailPasswordReset } from "@/server/email-auth";
import { route } from "@/server/http";

export const runtime = "nodejs";

/** Send a password reset email. The browser only talks to this server; the server talks to Firebase. */
export const POST = route(emailPasswordReset);
