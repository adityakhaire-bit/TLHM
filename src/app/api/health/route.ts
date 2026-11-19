import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { checkStorage } from "@/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public liveness check. Reports only up/down states, no paths or counts. */
export async function GET() {
  const [database, storage] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    checkStorage().then((check) => check.ok).catch(() => false),
  ]);
  const healthy = database && storage;
  return NextResponse.json(
    { ok: healthy, data: { server: "up", database: database ? "up" : "down", storage: storage ? "up" : "down", time: new Date().toISOString() } },
    { status: healthy ? 200 : 503 },
  );
}
