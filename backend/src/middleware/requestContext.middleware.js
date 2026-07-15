/**
 * Establishes the per-request ambient context and access log.
 * Must be the FIRST middleware — everything downstream (logger, audit, errors)
 * assumes a correlation id exists.
 */
import { randomUUID } from 'node:crypto';
import { runWithContext } from '../core/requestContext.js';
import { logger } from '../config/logger.js';

/** Honour an upstream correlation id (Azure Front Door / API Gateway) if present. */
const incomingId = (req) =>
  req.get('x-correlation-id') || req.get('x-request-id') || randomUUID();

export const requestContextMiddleware = (req, res, next) => {
  const correlationId = incomingId(req);
  const context = {
    correlationId,
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 255),
  };

  // Echo it back so a user reporting "it broke" can hand support one id that
  // pinpoints their exact request across every log line and audit row.
  res.setHeader('x-correlation-id', correlationId);

  runWithContext(context, () => {
    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';

      logger.log(level, `${req.method} ${req.originalUrl} ${res.statusCode}`, {
        method: req.method,
        path: req.route?.path ?? req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        userId: req.user?.id,
        ip: req.ip,
      });
    });

    next();
  });
};

export default requestContextMiddleware;
