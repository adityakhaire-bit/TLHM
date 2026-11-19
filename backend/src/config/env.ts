import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

/** Loads the single repository-level .env (../.env relative to backend/). Safe to call more than once. */
export function loadEnvFile() {
  loadDotenv({ path: path.resolve(__dirname, "../../../.env"), quiet: true });
}

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // HTTP server. Bound to localhost by default; set BACKEND_HOST=0.0.0.0 to serve the office LAN.
  BACKEND_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  BACKEND_HOST: z.string().default("127.0.0.1"),
  // Comma-separated list of browser origins allowed to call the API (CORS). Never "*".
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),

  // External SSD storage root. Never assumed to be mounted; checked before every write.
  MEDIA_STORAGE_ROOT: z.string().min(1, "MEDIA_STORAGE_ROOT is required (e.g. /Volumes/Extreme SSD/TMH-Media)"),
  // Optional overrides; default to sub-folders of MEDIA_STORAGE_ROOT (same volume, so moves are atomic).
  UPLOAD_TEMP_DIR: z.string().optional(),
  LOG_DIR: z.string().optional(),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 ** 3),
  STORAGE_RESERVE_BYTES: z.coerce.number().int().nonnegative().default(5 * 1024 ** 3),

  FFMPEG_PATH: z.string().default("/opt/homebrew/bin/ffmpeg"),
  FFPROBE_PATH: z.string().default("/opt/homebrew/bin/ffprobe"),

  // Firebase (Phase 2). Service-account JSON lives OUTSIDE the repository.
  FIREBASE_PROJECT_ID: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),

  // Optional cloud storage (future). The MVP only uses the local SSD adapter.
  CLOUD_STORAGE_ENABLED: z.enum(["true", "false"]).default("false"),
});

export type BackendConfig = z.infer<typeof schema> & {
  allowedOrigins: string[];
  uploadTempDir: string;
  logDir: string;
};

/** Reads and validates configuration from process.env. Throws a readable error listing every problem. */
export function getConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid backend configuration (.env):\n${problems}`);
  }
  const values = parsed.data;
  const root = path.resolve(values.MEDIA_STORAGE_ROOT);
  const allowedOrigins = values.FRONTEND_ORIGIN.split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
  if (allowedOrigins.includes("*")) throw new Error("FRONTEND_ORIGIN must list explicit origins, not *");
  return {
    ...values,
    MEDIA_STORAGE_ROOT: root,
    allowedOrigins,
    uploadTempDir: path.resolve(values.UPLOAD_TEMP_DIR ?? path.join(root, "uploads-temp")),
    logDir: path.resolve(values.LOG_DIR ?? path.join(root, "logs")),
  };
}
