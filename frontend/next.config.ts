import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // npm workspaces: dependencies are installed at the repository root.
  outputFileTracingRoot: path.join(__dirname, ".."),
  // Shared TypeScript sources (../shared) are compiled as part of the frontend.
  transpilePackages: ["@tmh/shared"],
  // Legacy MySQL layer (removed in Phase 2): keep the database driver out of bundling.
  serverExternalPackages: ["@prisma/adapter-mariadb", "mariadb", "firebase-admin"],
  // Let other computers on the office network use the development server (by Mac name or IP).
  // Comma-separated extra hosts can be added with DEV_ALLOWED_HOSTS in .env.
  allowedDevOrigins: ["*.local", "*.ts.net", "192.168.*.*", "10.*.*.*", "100.*.*.*",...(process.env.DEV_ALLOWED_HOSTS?.split(",").map((h) => h.trim()).filter(Boolean) ?? [])],
};

export default nextConfig;
