import { Router } from "express";
import type { BackendConfig } from "../config/env";
import { healthController } from "../controllers/health.controller";
import type { StorageAdapter } from "../storage";

/**
 * API routes. Phase 1 exposes only the public health check. Every other endpoint in docs/API.md
 * is added in Phase 2 behind Firebase ID-token verification (middleware/auth.ts), never unauthenticated.
 */
export function apiRouter(_config: BackendConfig, storage: StorageAdapter) {
  const router = Router();
  router.get("/health", healthController(storage));
  return router;
}
