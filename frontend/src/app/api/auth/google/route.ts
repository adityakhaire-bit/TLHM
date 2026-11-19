import { firebaseSignIn } from "@/server/firebase-session";
import { route } from "@/server/http";

export const runtime = "nodejs";

/** Kept for compatibility: same as POST /api/auth/firebase (accepts Google and email + password tokens). */
export const POST = route(firebaseSignIn);
