import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // npm workspaces: dependencies are installed at the repository root.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Shared TypeScript sources (../shared) are compiled as part of the frontend.
  transpilePackages: ["@tmh/shared"],
  // Legacy MySQL layer (removed in Phase 2): keep the database driver out of bundling.
  serverExternalPackages: ["@prisma/adapter-mariadb", "mariadb"],
};

export default nextConfig;
