import cors from "cors";
import express from "express";
import type { BackendConfig } from "./config/env";
import { errorHandler, notFound } from "./middleware/errors";
import { apiRouter } from "./routes";
import type { StorageAdapter } from "./storage";

/** Builds the Express app (no listening), so tests can start it on a random port. */
export function createApp(config: BackendConfig, storage: StorageAdapter) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", "loopback");

  // CORS: only the configured frontend origin(s). Credentials allowed for signed-in requests.
  app.use(cors({
    origin(origin, callback) {
      // Requests without an Origin header (curl, server-to-server, same-origin GETs) are not CORS requests.
      if (!origin || config.allowedOrigins.includes(origin)) callback(null, true);
      else callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type", "Range", "X-File-Name", "X-Folder-Id", "X-Category", "X-Tags"],
    exposedHeaders: ["Content-Range", "Content-Length", "Accept-Ranges", "Content-Disposition"],
    maxAge: 600,
  }));

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // JSON bodies are small metadata only; media uploads are streamed separately (Phase 2), never parsed here.
  app.use("/api", express.json({ limit: "1mb" }));
  app.use("/api", apiRouter(config, storage));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
