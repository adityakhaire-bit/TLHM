import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "./env";

function createClient() {
  const url = new URL(getEnv().DATABASE_URL);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    connectionLimit: 10,
    // MySQL 8 default auth plugin (caching_sha2_password) over a local TCP connection.
    allowPublicKeyRetrieval: true,
  });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { tmhPrisma?: PrismaClient };

function client(): PrismaClient {
  if (!globalForPrisma.tmhPrisma) globalForPrisma.tmhPrisma = createClient();
  return globalForPrisma.tmhPrisma;
}

/**
 * Single shared Prisma client, created on first use (so builds and imports never need a database),
 * and reused across Next.js hot reloads in development.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = client();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
