import { emailResendVerification } from "@/server/email-auth";
import { route } from "@/server/http";

export const runtime = "nodejs";

/** Send the confirmation email again. The browser only talks to this server; the server talks to Firebase. */
export const POST = route(emailResendVerification);
