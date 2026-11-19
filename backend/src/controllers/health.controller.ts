import type { RequestHandler } from "express";
import type { HealthDto } from "@tmh/shared/api-types";
import { sendOk } from "../http/respond";
import type { StorageAdapter } from "../storage";

/**
 * GET /api/health: public liveness check. Reports only up/down states: no paths, sizes or counts.
 * Firestore stays "not_configured" until Phase 2 wires the Firebase Admin SDK and pings it here.
 */
export function healthController(storage: StorageAdapter): RequestHandler {
  return async (_req, res) => {
    const storageOk = await storage.verifyStorageAvailability().then((result) => result.ok, () => false);
    const body: HealthDto = {
      server: "up",
      storage: storageOk ? "up" : "down",
      firestore: "not_configured",
      time: new Date().toISOString(),
    };
    sendOk(res, body, storageOk ? 200 : 503);
  };
}
