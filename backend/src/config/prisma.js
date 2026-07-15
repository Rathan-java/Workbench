/**
 * The single PrismaClient instance for the process.
 *
 * Two things worth knowing:
 *
 *  1. `--watch` in dev re-imports modules on every save. Without the globalThis
 *     cache below you leak a connection pool per reload and exhaust MySQL's
 *     max_connections within about twenty file saves.
 *
 *  2. Slow-query logging is wired here, not sprinkled through repositories. Any
 *     query over SLOW_QUERY_MS is logged with its SQL so an index regression
 *     shows up in the logs before it shows up in a support ticket.
 */
import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from './logger.js';

const SLOW_QUERY_MS = 300;

const createClient = () => {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'warn' },
      { emit: 'event', level: 'error' },
    ],
    errorFormat: env.isProd ? 'minimal' : 'pretty',
  });

  client.$on('query', (e) => {
    if (e.duration >= SLOW_QUERY_MS) {
      logger.warn('Slow query detected', {
        durationMs: e.duration,
        query: e.query,
        params: env.isProd ? undefined : e.params,
      });
    } else if (env.LOG_LEVEL === 'debug') {
      logger.debug('prisma:query', { durationMs: e.duration, query: e.query });
    }
  });

  client.$on('warn', (e) => logger.warn('prisma:warn', { message: e.message }));
  client.$on('error', (e) => logger.error('prisma:error', { message: e.message }));

  return client;
};

const globalRef = globalThis;
export const prisma = globalRef.__araWorkbenchPrisma ?? createClient();
if (!env.isProd) globalRef.__araWorkbenchPrisma = prisma;

export const connectDatabase = async () => {
  await prisma.$connect();
  logger.info('Database connected');
};

export const disconnectDatabase = async () => {
  await prisma.$disconnect();
  logger.info('Database disconnected');
};

/** Readiness probe: Azure needs a real query, not just "the object exists". */
export const isDatabaseHealthy = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    logger.error('Database health check failed', { error: error.message });
    return false;
  }
};

export default prisma;
