import { emailSignIn } from "@/server/email-auth";
import { route } from "@/server/http";

export const runtime = "nodejs";

/** Sign in with email + password (confirmed email, allowed domain). The browser only talks to this server; the server talks to Firebase. */
export const POST = route(emailSignIn);
