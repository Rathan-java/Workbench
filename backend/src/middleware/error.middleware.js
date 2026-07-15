/**
 * The single exit point for every error in the application.
 *
 * Principles:
 *  - Expected failures (AppError) → their own status + message, logged as warn.
 *  - Prisma failures              → translated to domain errors. A raw
 *    `PrismaClientKnownRequestError` leaking to a client exposes table and
 *    column names, which is free reconnaissance for an attacker.
 *  - Anything else                → 500 with a generic message and a correlation
 *    id. The stack goes to the log, never to the wire.
 */
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import multer from 'multer';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { AppError, ValidationError, NotFoundError, ConflictError } from '../core/errors.js';
import { failure, HTTP } from '../core/ApiResponse.js';
import { getCorrelationId } from '../core/requestContext.js';

/** Turns Prisma's error codes into errors the client can actually act on. */
const translatePrisma = (error) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const fields = /** @type {string[]} */ (error.meta?.target) ?? [];
        const label = fields.filter((f) => f !== 'id').join(', ') || 'value';
        return new ConflictError(`A record with this ${label} already exists`, {
          code: 'DUPLICATE_RECORD',
          details: { fields },
        });
      }
      case 'P2003':
        return new ConflictError(
          'This record is referenced by other data and cannot be changed or removed',
          { code: 'FOREIGN_KEY_CONSTRAINT' },
        );
      case 'P2025':
        return new NotFoundError('Record', { code: 'RECORD_NOT_FOUND' });
      case 'P2014':
        return new ConflictError('This change would break a required relation', {
          code: 'RELATION_VIOLATION',
        });
      default:
        return null; // fall through to 500 — an unmapped code is a bug worth a stack trace
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // Always our bug (a malformed query), never the client's.
    return null;
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return new AppError('The service is temporarily unavailable', 503, {
      code: 'DATABASE_UNAVAILABLE',
    });
  }

  return null;
};

const translateMulter = (error) => {
  if (!(error instanceof multer.MulterError)) return null;
  if (error.code === 'LIMIT_FILE_SIZE') {
    return new AppError(`File is too large. Maximum size is ${env.MAX_AVATAR_SIZE_MB} MB.`, 413, {
      code: 'FILE_TOO_LARGE',
    });
  }
  return new AppError('File upload failed', 400, { code: `UPLOAD_${error.code}` });
};

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity (4).
export const errorHandler = (err, req, res, _next) => {
  let error = err;

  if (error instanceof ZodError) {
    error = new ValidationError(
      error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }

  error = translatePrisma(error) ?? translateMulter(error) ?? error;

  if (error instanceof AppError) {
    logger.warn(`${error.code}: ${error.message}`, {
      status: error.statusCode,
      path: req.originalUrl,
      method: req.method,
      userId: req.user?.id,
      details: error.details,
    });

    return failure(res, {
      status: error.statusCode,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }

  // Unknown → this is a bug. Full stack to the log; nothing but a ticket number
  // to the client.
  logger.error('Unhandled error', {
    message: err?.message,
    stack: err?.stack,
    name: err?.name,
    path: req.originalUrl,
    method: req.method,
    userId: req.user?.id,
  });

  return failure(res, {
    status: HTTP.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong on our side. Please try again.',
    details: env.isProd
      ? { correlationId: getCorrelationId() }
      : { correlationId: getCorrelationId(), debug: err?.message, stack: err?.stack?.split('\n') },
  });
};

export const notFoundHandler = (req, res) =>
  failure(res, {
    status: HTTP.NOT_FOUND,
    code: 'ROUTE_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
