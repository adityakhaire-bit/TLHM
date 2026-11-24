import { z } from "zod";

/**
 * Server configuration, read from .env. Values are read lazily (on each call) so scripts
 * and tests can set process.env before first use.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  MEDIA_STORAGE_ROOT: z.string().min(1, "MEDIA_STORAGE_ROOT is required"),
  FFMPEG_PATH: z.string().default("/opt/homebrew/bin/ffmpeg"),
  FFPROBE_PATH: z.string().default("/opt/homebrew/bin/ffprobe"),
  MYSQLDUMP_PATH: z.string().default("/opt/homebrew/bin/mysqldump"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 ** 3),
  // Space always kept free on the SSD so it never fills completely.
  STORAGE_RESERVE_BYTES: z.coerce.number().int().nonnegative().default(5 * 1024 ** 3),
  APP_ORIGIN: z.string().default("http://localhost:3000"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  BACKUP_KEEP: z.coerce.number().int().min(2).default(30),
  CLOUD_STORAGE_ENABLED: z.enum(["true", "false"]).default("false"),
  // Google sign-in (Firebase Authentication). Empty ALLOWED_EMAIL_DOMAINS = Google sign-in disabled.
  FIREBASE_PROJECT_ID: z.string().optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().default(""),
  // AI video analysis (Google Gemini). Empty key = AI analysis switched off.
  GEMINI_API_KEY: z.string().trim().default(""),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.5-flash-lite"),
  // Models to try, in order, when the main one is overloaded (comma separated).
  GEMINI_FALLBACK_MODELS: z.string().default("gemini-3.1-flash-lite"),
  GEMINI_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  // "true": every new video is analysed automatically right after upload (in parallel with its preview).
  AI_AUTO_ANALYZE: z.enum(["true", "false"]).default("true"),
  // "true": computers on the office network (192.168.x.x etc.) can browse view-only without signing in.
  // Admins can switch this from the "Share with team" page (that choice is saved and wins over .env).
  LAN_GUEST_ACCESS: z.enum(["true", "false"]).default("true"),
});

export type ServerEnv = z.infer<typeof schema>;

export function getEnv(): ServerEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid server configuration in .env (${fields})`);
  }
  return parsed.data;
}
