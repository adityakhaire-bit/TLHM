import { createApp } from "./app";
import { getConfig, loadEnvFile } from "./config/env";
import { createStorage } from "./storage";

async function main() {
  loadEnvFile();
  const config = getConfig();
  const storage = createStorage(config);
  const app = createApp(config, storage);

  const availability = await storage.verifyStorageAvailability();
  const server = app.listen(config.BACKEND_PORT, config.BACKEND_HOST, () => {
    console.log(`[tmh-backend] listening on http://${config.BACKEND_HOST}:${config.BACKEND_PORT} (CORS: ${config.allowedOrigins.join(", ")})`);
    console.log(`[tmh-backend] storage: ${availability.ok ? `ok on "${availability.driveName}"` : `UNAVAILABLE: ${availability.message}`}`);
    console.log(`[tmh-backend] firestore: ${config.FIREBASE_PROJECT_ID ? "project configured (Admin SDK wired in Phase 2)" : "not configured yet (Phase 2)"}`);
  });
  // Large uploads and downloads can take a long time on a LAN; do not cut them off.
  server.requestTimeout = 0;
  server.headersTimeout = 60_000;

  const shutdown = (signal: string) => {
    console.log(`[tmh-backend] ${signal} received, closing`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(`[tmh-backend] failed to start: ${(error as Error).message}`);
  process.exit(1);
});
