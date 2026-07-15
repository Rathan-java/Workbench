/**
 * Rate limiting.
 *
 * Three tiers, because one global limit is always either too loose for the
 * login endpoint or too tight for the dashboard:
 *
 *   apiLimiter    — broad abuse protection on everything.
 *   authLimiter   — brute-force protection. Keyed on IP *plus* the submitted
 *                   email, so one attacker cannot lock out a whole office NAT,
 *                   and cannot evade the limit by rotating target accounts.
 *   otpLimiter    — the OTP endpoints are the softest target in the system
 *                   (6 digits = 10^6 keyspace); they get the tightest budget.
 *
 * NOTE ON SCALE-OUT: this uses the default in-memory store, which means each
 * App Service instance keeps its own counters — with N instances the effective
 * limit is N×. That is acceptable for the broad limiter but NOT for auth, which
 * is why the auth flow *also* has a database-backed account lockout
 * (users.failedLoginCount / lockedUntil) that is authoritative and shared. Swap
 * in rate-limit-redis when a cache is provisioned.
 */
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { failure, HTTP } from '../core/ApiResponse.js';
import { logger } from '../config/logger.js';

/**
 * Normalise the client IP for use as a rate-limit key.
 *
 * IPv6 matters here. A single customer is routinely handed a /64 — that is
 * 18 quintillion addresses. Keying the limiter on the full /128 means an
 * attacker rotates the low 64 bits and every request lands in a fresh bucket,
 * so the limiter does nothing at all. We truncate IPv6 to its /64 prefix, which
 * is the smallest unit that maps to one subscriber.
 */
const ipKey = (ip) => {
  if (!ip) return 'unknown';
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4-mapped IPv6
  if (!address.includes(':')) return address; // plain IPv4
  return address.split(':').slice(0, 4).join(':'); // IPv6 → /64
};

const onLimitReached = (req, _res, _next, options) => {
  logger.warn('Rate limit exceeded', {
    path: req.originalUrl,
    ip: req.ip,
    limit: options.limit,
  });
  return failure(_res, {
    status: HTTP.TOO_MANY_REQUESTS,
    code: 'RATE_LIMITED',
    message: options.message,
  });
};

const base = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: onLimitReached,
};

export const apiLimiter = rateLimit({
  ...base,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.RATE_LIMIT_MAX,
  message: 'Too many requests. Please slow down and try again shortly.',
  // Authenticated users get their own bucket; a busy office behind one public IP
  // must not throttle itself.
  keyGenerator: (req) => req.user?.id ?? ipKey(req.ip),
  skip: (req) => req.path === '/healthz' || req.path === '/readyz',
});

export const authLimiter = rateLimit({
  ...base,
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: env.AUTH_RATE_LIMIT_MAX,
  message: 'Too many authentication attempts. Please try again later.',
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '')
      .toLowerCase()
      .slice(0, 190);
    return `${ipKey(req.ip)}:${email}`;
  },
  skipSuccessfulRequests: true, // a legitimate user who logs in is not "using up" the budget
});

export const otpLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many verification attempts. Please request a new code.',
  keyGenerator: (req) => {
    const email = String(req.body?.email ?? '')
      .toLowerCase()
      .slice(0, 190);
    return `otp:${ipKey(req.ip)}:${email}`;
  },
});

/** Exports are expensive (full table scans + file generation). Budget them. */
export const exportLimiter = rateLimit({
  ...base,
  windowMs: 5 * 60 * 1000,
  limit: 10,
  message: 'Too many export requests. Please wait a few minutes.',
  keyGenerator: (req) => req.user?.id ?? ipKey(req.ip),
});
