import { emailSignUp } from "@/server/email-auth";
import { route } from "@/server/http";

export const runtime = "nodejs";

/** Create an account (Firebase) and email a confirmation link. The browser only talks to this server; the server talks to Firebase. */
export const POST = route(emailSignUp);
