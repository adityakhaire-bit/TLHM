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
