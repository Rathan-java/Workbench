/**
 * Environment configuration — validated once, at boot, with Zod.
 *
 * WHY THIS FILE EXISTS
 * The worst class of production incident is the one where a missing env var
 * surfaces three hours after deploy, inside a request handler, as
 * `undefined is not a function`. We fail fast instead: if the environment is
 * not valid, the process refuses to start and prints exactly what is wrong.
 *
 * Nothing anywhere else in the codebase may read `process.env` directly.
 */
import { z } from 'zod';

const bool = (fallback) =>
  z
    .enum(['true', 'false'])
    .default(String(fallback))
    .transform((v) => v === 'true');

const int = (fallback, min = 0) => z.coerce.number().int().min(min).default(fallback);

const schema = z.object({
  // --- runtime -------------------------------------------------------------
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(4000, 1),
  API_PREFIX: z.string().default('/api/v1'),
  APP_NAME: z.string().default('Ara Workbench'),
  /** Public URL of the SPA. Used in emails and CORS. */
  CLIENT_URL: z.string().url().default('http://localhost:5173'),
  /** Comma-separated allow-list. CLIENT_URL is always implicitly included. */
  CORS_ORIGINS: z.string().default(''),
  /** Behind Azure App Service / nginx we sit behind a proxy — required for
   *  correct client IPs in rate limiting and audit logs. */
  TRUST_PROXY: int(1),

  // --- database ------------------------------------------------------------
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // --- auth ----------------------------------------------------------------
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be >= 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be >= 32 chars'),
  /** Short-lived by design; the refresh cookie does the heavy lifting. */
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: int(7, 1),
  BCRYPT_SALT_ROUNDS: int(12, 10),
  /**
   * Minimum password length. Set to 6 per requirement.
   * Floor of 6 is enforced here so nobody can accidentally configure a 1-character
   * password policy. See the note in auth.dto.js — 6 is short, and the composition
   * rules are load-bearing at that length.
   */
  PASSWORD_MIN_LENGTH: int(6, 6),
  REFRESH_COOKIE_NAME: z.string().default('aw_rt'),
  /** Leave empty for localhost; set to the apex domain in production. */
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool(false),

  // --- brute force / lockout ----------------------------------------------
  MAX_FAILED_LOGINS: int(5, 1),
  ACCOUNT_LOCK_MINUTES: int(15, 1),

  // --- OTP -----------------------------------------------------------------
  OTP_LENGTH: int(6, 4),
  OTP_TTL_MINUTES: int(5, 1),
  OTP_MAX_ATTEMPTS: int(5, 1),
  /** Window between the "verify OTP" and "set new password" calls. */
  OTP_RESET_TOKEN_TTL_MINUTES: int(10, 1),

  // --- rate limiting -------------------------------------------------------
  RATE_LIMIT_WINDOW_MINUTES: int(15, 1),
  RATE_LIMIT_MAX: int(300, 10),
  AUTH_RATE_LIMIT_MAX: int(10, 1),

  // --- mail ----------------------------------------------------------------
  MAIL_ENABLED: bool(true),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: int(1025, 1),
  /**
   * IMPLICIT TLS from the first byte — port 465 ONLY.
   * Port 587 uses STARTTLS and needs this FALSE. Setting it true on 587 makes the
   * client wait forever for a handshake the server never starts; it looks like a
   * network fault and it is not. This is the #1 SMTP misconfiguration.
   */
  SMTP_SECURE: bool(false),
  /** Upgrade to TLS via STARTTLS. This is what makes port 587 encrypted. */
  SMTP_REQUIRE_TLS: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Only for an internal relay with a self-signed cert. NEVER for a public provider. */
  SMTP_ALLOW_SELF_SIGNED: bool(false),
  /** Logs the full SMTP conversation. Turn on when mail is failing and you cannot see why. */
  SMTP_DEBUG: bool(false),
  MAIL_FROM_NAME: z.string().default('Ara Workbench'),
  MAIL_FROM_ADDRESS: z.string().email().default('no-reply@ara-workbench.local'),

  // --- uploads -------------------------------------------------------------
  UPLOAD_DIR: z.string().default('storage/uploads'),
  MAX_AVATAR_SIZE_MB: int(2, 1),

  // --- logging -------------------------------------------------------------
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),
  LOG_DIR: z.string().default('storage/logs'),
  LOG_RETENTION_DAYS: int(30, 1),

  // --- jobs ----------------------------------------------------------------
  /** Master switch. Set false on any instance that must never run cron
   *  (e.g. a dedicated read replica or a one-off migration container). */
  SCHEDULER_ENABLED: bool(true),
  /** The 180-day rule from the brief — configurable, because "180" is a
   *  business policy, and business policies change without a redeploy. */
  TASK_RETENTION_DAYS: int(180, 1),
  RETENTION_BATCH_SIZE: int(1000, 100),
  CRON_TIMEZONE: z.string().default('Asia/Kolkata'),
  CRON_RETENTION_CLEANUP: z.string().default('5 0 * * *'), // 00:05 daily
  CRON_ROLLUP: z.string().default('20 0 * * *'), // 00:20 daily
  CRON_HOURLY_REMINDER: z.string().default('50 * * * *'), // :50 every hour
  CRON_LEAD_DIGEST: z.string().default('30 13,18 * * 1-5'),
  CRON_MANAGEMENT_SUMMARY: z.string().default('0 19 * * 1-5'),

  // --- seed ----------------------------------------------------------------
  SEED_ADMIN_EMAIL: z.string().email().default('admin@ara-workbench.local'),
  SEED_ADMIN_PASSWORD: z.string().min(12).default('ChangeMe@Admin123'),
  SEED_ADMIN_FIRST_NAME: z.string().default('System'),
  SEED_ADMIN_LAST_NAME: z.string().default('Administrator'),
  /** Populates realistic teams/projects/tasks for demo + load testing. */
  SEED_DEMO_DATA: bool(false),

  // --- docs ----------------------------------------------------------------
  SWAGGER_ENABLED: bool(true),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // Intentionally console.error, not the logger: the logger depends on env.
  console.error(`\n✖ Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

/** @typedef {z.infer<typeof schema>} Env */

const raw = parsed.data;

export const env = Object.freeze({
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  isDev: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: [
    raw.CLIENT_URL,
    ...raw.CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ],
});

// A production deployment that ships the default admin password is a breach
// waiting to happen. Refuse to boot.
if (env.isProd && env.SEED_ADMIN_PASSWORD === 'ChangeMe@Admin123') {
  console.error('\n✖ SEED_ADMIN_PASSWORD must be changed before running in production.\n');
  process.exit(1);
}
if (env.isProd && !env.COOKIE_SECURE) {
  console.error('\n✖ COOKIE_SECURE must be true in production (refresh token cookie).\n');
  process.exit(1);
}

export default env;
