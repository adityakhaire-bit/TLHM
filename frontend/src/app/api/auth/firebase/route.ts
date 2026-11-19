import { firebaseSignIn } from "@/server/firebase-session";
import { route } from "@/server/http";

export const runtime = "nodejs";

/** Sign in with a Firebase ID token from Google or email + password (verified email, allowed domain). */
export const POST = route(firebaseSignIn);
