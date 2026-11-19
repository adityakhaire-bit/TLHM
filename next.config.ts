import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // This project is the workspace root (a stray lockfile exists in the parent folder).
  outputFileTracingRoot: __dirname,
  // FFmpeg/MySQL helpers are server-only Node code; keep the database driver out of bundling.
  serverExternalPackages: ["@prisma/adapter-mariadb", "mariadb"],
};

export default nextConfig;
