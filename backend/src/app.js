/**
 * The Express application.
 *
 * MIDDLEWARE ORDER IS LOAD-BEARING. Read the numbered comments before moving
 * anything — several of these only work if they run before something else.
 */
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';

import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { isDatabaseHealthy } from './config/prisma.js';
import { mountSwagger } from './config/swagger.js';
import { requestContextMiddleware } from './middleware/requestContext.middleware.js';
import { apiLimiter } from './middleware/rateLimit.middleware.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import { enforcePasswordChange } from './middleware/auth.middleware.js';
import { authenticateStatic } from './middleware/staticAuth.middleware.js';
import { UPLOAD_ROOT } from './middleware/upload.middleware.js';
import { ok, failure, HTTP } from './core/ApiResponse.js';
import { assertPermissionsWired } from './core/permissions.js';
import apiRoutes from './routes/index.js';

// Fails the boot if a permission was declared but wired to no role — dead
// permissions silently deny access, which is a miserable bug to chase.
assertPermissionsWired();

export const createApp = () => {
  const app = express();

  // 1. TRUST PROXY — must be first. Behind Azure App Service / nginx, `req.ip`
  //    is the proxy's address unless we trust the X-Forwarded-For chain. Every
  //    rate limiter keyed on IP and every audit row's IP would otherwise be the
  //    load balancer's, which makes both useless.
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by'); // free version disclosure, no reason to ship it

  // 2. CONTEXT — before everything, so every log line and audit row downstream
  //    carries the correlation id.
  app.use(requestContextMiddleware);

  // 3. SECURITY HEADERS.
  app.use(
    helmet({
      // The API serves JSON and file downloads, never HTML that executes script,
      // so the CSP here is deliberately absolute: nothing may be loaded or run.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' }, // the SPA loads avatars from here
      hsts: env.isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  // 4. CORS — an explicit allow-list, and `credentials: true` because the refresh
  //    token travels as a cookie. Note that `origin: true` (reflect anything)
  //    combined with credentials is a catastrophic pairing and is never used here.
  app.use(
    cors({
      origin: (origin, callback) => {
        // No Origin header: same-origin, curl, or a server-to-server call. Allow.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);

        logger.warn('CORS: blocked an unlisted origin', { origin });
        return callback(new Error('Not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
      exposedHeaders: ['x-correlation-id', 'Content-Disposition'],
      maxAge: 86400,
    }),
  );

  // 5. BODY PARSING. The 1 MB cap is a deliberate DoS control — nothing this API
  //    accepts legitimately approaches it, and a 100 MB JSON body will happily
  //    eat the process's heap while it is being parsed.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());

  // 6. HTTP PARAMETER POLLUTION. `?status=OPEN&status=CLOSED` arrives as an array
  //    and can slip past a validator that expects a string. hpp collapses it.
  app.use(hpp({ whitelist: ['userIds'] }));

  app.use(compression());

  // --- probes (before auth and before the rate limiter) --------------------

  /**
   * @openapi
   * /healthz:
   *   get:
   *     tags: [System]
   *     summary: Liveness probe
   *     description: "Is the process up? Deliberately does NOT touch the database — a liveness probe that fails during a brief DB blip would have the orchestrator kill a perfectly healthy process."
   *     security: []
   *     responses:
   *       200: { description: Alive }
   */
  app.get('/healthz', (_req, res) =>
    res.status(200).json({ status: 'ok', uptime: process.uptime(), version: '1.0.0' }),
  );

  /**
   * @openapi
   * /readyz:
   *   get:
   *     tags: [System]
   *     summary: Readiness probe
   *     description: "Can this instance serve traffic? Checks the database. Azure removes an instance from rotation when this fails."
   *     security: []
   *     responses:
   *       200: { description: Ready }
   *       503: { description: Not ready — the database is unreachable }
   */
  app.get('/readyz', async (_req, res) => {
    const dbHealthy = await isDatabaseHealthy();
    if (!dbHealthy) {
      return failure(res, {
        status: HTTP.SERVICE_UNAVAILABLE,
        code: 'NOT_READY',
        message: 'The database is unreachable',
      });
    }
    return ok(res, { status: 'ready', database: 'up' });
  });

  // --- static: avatars -----------------------------------------------------

  // Authenticated — an employee's photo is personal data, not a public URL. But
  // an <img> tag cannot send a Bearer header, so this route authenticates with
  // the httpOnly refresh cookie instead. See staticAuth.middleware.js for why
  // that is the right trade rather than simply serving the files openly.
  app.use(
    '/uploads',
    authenticateStatic,
    express.static(UPLOAD_ROOT, {
      maxAge: '7d',
      immutable: true, // filenames contain a UUID, so a given URL never changes content
      // Never let a file be interpreted as HTML/JS, even if one somehow got past
      // the magic-byte check on upload.
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "default-src 'none'");
      },
      dotfiles: 'deny',
      index: false,
    }),
  );

  // --- docs ----------------------------------------------------------------

  mountSwagger(app);

  // --- the API -------------------------------------------------------------

  app.use(env.API_PREFIX, apiLimiter, enforcePasswordChange, apiRoutes);

  app.get('/', (_req, res) =>
    ok(res, {
      name: env.APP_NAME,
      version: '1.0.0',
      docs: env.SWAGGER_ENABLED ? '/api-docs' : null,
      api: env.API_PREFIX,
    }),
  );

  // --- terminators ---------------------------------------------------------

  app.use(notFoundHandler);
  app.use(errorHandler); // MUST be last — Express identifies it by its arity of 4

  return app;
};

export default createApp;
