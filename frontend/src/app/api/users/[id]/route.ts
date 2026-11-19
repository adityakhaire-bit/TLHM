import { z } from "zod";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { ApiError, ok, parseId, readJson, route } from "@/server/http";

export const runtime = "nodejs";

const patchSchema = z.object({
  role: z.enum(["admin", "editor", "viewer"]).optional(),
  isActive: z.boolean().optional(),
  displayName: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email().max(255).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "Nothing to update");

/** Change a user's role, name, email or active state (admin only). */
export const PATCH = route<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const admin = await requireUser(request, "admin");
  const id = parseId((await params).id, "user id");
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) throw new ApiError(400, "Invalid changes", "invalid_body", z.flattenError(parsed.error).fieldErrors);
  const changes = parsed.data;

  if (id === admin.id && (changes.isActive === false || (changes.role && changes.role !== "admin"))) {
    throw new ApiError(400, "You cannot remove your own admin access. Ask another admin.", "self_lockout");
  }
  if (changes.role && changes.role !== "admin" || changes.isActive === false) {
    const target = await prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true, isActive: true } });
    if (target.role === "admin" && target.isActive) {
      const admins = await prisma.user.count({ where: { role: "admin", isActive: true } });
      if (admins <= 1) throw new ApiError(400, "There must always be at least one active admin", "last_admin");
    }
  }
  if (changes.email) {
    const clash = await prisma.user.findFirst({ where: { email: changes.email, NOT: { id } }, select: { id: true } });
    if (clash) throw new ApiError(409, "Another account already uses that email", "email_taken");
  }

  const user = await prisma.user.update({
    where: { id },
    data: changes,
    select: { id: true, username: true, displayName: true, email: true, role: true, isActive: true },
  });
  // Deactivating or changing a role signs the person out everywhere, so the change applies immediately.
  if (changes.isActive === false || changes.role) await prisma.session.deleteMany({ where: { userId: id } });
  return ok({ user });
});
