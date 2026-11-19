import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ok, route } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All user accounts (admin only). Never returns password hashes. */
export const GET = route(async (request) => {
  await requireUser(request, "admin");
  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    select: {
      id: true, username: true, displayName: true, email: true, role: true, isActive: true,
      lastLoginAt: true, createdAt: true, firebaseUid: true, passwordHash: true, avatarUrl: true,
    },
  });
  return ok({
    users: users.map(({ firebaseUid, passwordHash, ...user }) => ({
      ...user,
      signInMethods: [...(passwordHash ? ["password"] : []), ...(firebaseUid ? ["google"] : [])],
    })),
  });
});
