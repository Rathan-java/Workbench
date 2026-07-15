/**
 * Centralised structured logging (Winston).
 *
 * Two transports on purpose:
 *  - console  → human-readable in dev, JSON in prod (Azure App Service and any
 *               log shipper wants one JSON object per line, not pretty colours).
 *  - files    → daily-rotated, retained for LOG_RETENTION_DAYS, with a separate
 *               error-only stream so on-call greps one file, not thirty.
 *
 * Every log line carries the request's correlationId (see requestContext.js),
 * so a single failed user action can be reconstructed across middleware,
 * service, repository and job boundaries.
 */
import path from 'node:path';
import fs from 'node:fs';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { env } from './env.js';
import { getCorrelationId } from '../core/requestContext.js';

const logDir = path.resolve(process.cwd(), env.LOG_DIR);
fs.mkdirSync(logDir, { recursive: true });

/** Attaches the ambient correlation id to every record without callers passing it. */
const withCorrelation = winston.format((info) => {
  const correlationId = getCorrelationId();
  if (correlationId) info.correlationId = correlationId;
  return info;
});

/** Never let a stack trace or a password land in a log file. */
const REDACTED_KEYS = new Set([
  'password',
  'newPassword',
  'currentPassword',
  'confirmPassword',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'otp',
  'otpHash',
  'authorization',
  'cookie',
]);

const redact = winston.format((info) => {
  const walk = (value, depth = 0) => {
    if (depth > 6 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACTED_KEYS.has(k) ? '[REDACTED]' : walk(v, depth + 1);
    }
    return out;
  };
  return walk(info);
});

const consoleFormat = env.isProd
  ? winston.format.combine(winston.format.timestamp(), winston.format.json())
  : winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
      winston.format.printf(({ timestamp, level, message, correlationId, stack, ...meta }) => {
        const cid = correlationId ? ` \x1b[90m[${String(correlationId).slice(0, 8)}]\x1b[0m` : '';
        const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} ${level}${cid} ${stack || message}${rest}`;
      }),
    );

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  defaultMeta: { service: 'ara-workbench-api', env: env.NODE_ENV },
  format: winston.format.combine(
    withCorrelation(),
    redact(),
    winston.format.errors({ stack: true }),
    winston.format.timestamp(),
  ),
  transports: [
    new winston.transports.Console({ format: consoleFormat, handleExceptions: true }),
    new DailyRotateFile({
      dirname: logDir,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${env.LOG_RETENTION_DAYS}d`,
      zippedArchive: true,
      format: winston.format.json(),
    }),
    new DailyRotateFile({
      level: 'error',
      dirname: logDir,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: `${env.LOG_RETENTION_DAYS}d`,
      zippedArchive: true,
      format: winston.format.json(),
    }),
  ],
  exitOnError: false,
});

/** Morgan-style stream, kept so any middleware expecting `.write` works. */
export const loggerStream = {
  write: (message) => logger.http(message.trim()),
};

export default logger;
