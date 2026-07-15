/**
 * Process bootstrap.
 *
 * The parts that matter:
 *
 *  - GRACEFUL SHUTDOWN. Azure sends SIGTERM and then kills the process. Without
 *    a handler, every in-flight request is severed mid-write and every deploy
 *    produces a handful of 502s and, worse, half-finished transactions. We stop
 *    accepting connections, let the in-flight ones finish, stop cron, close the
 *    DB pool, then exit.
 *
 *  - A HARD TIMEOUT ON THAT SHUTDOWN. If a request hangs, the process must still
 *    die, or the orchestrator's SIGKILL does it far less politely.
 *
 *  - FAIL FAST ON A BAD ENVIRONMENT. env.js already exits on invalid config; here
 *    we also refuse to serve if the database is unreachable at boot.
 */
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDatabase, disconnectDatabase } from './config/prisma.js';
import { verifyMailer } from './config/mailer.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

let server;
let shuttingDown = false;

const start = async () => {
  logger.info(`Starting ${env.APP_NAME}`, {
    env: env.NODE_ENV,
    node: process.version,
    pid: process.pid,
  });

  await connectDatabase();

  // Non-fatal: a dead SMTP server must not stop people logging their work.
  // Email is a courtesy; task monitoring is the product.
  await verifyMailer();

  const app = createApp();

  server = app.listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}${env.API_PREFIX}`);
    if (env.SWAGGER_ENABLED) logger.info(`API docs at http://localhost:${env.PORT}/api-docs`);
  });

  // Must exceed the Azure Front Door / nginx idle timeout, or the proxy will
  // reuse a connection that Node has already decided to close, producing
  // intermittent, unreproducible 502s.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  startScheduler();
};

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info(`${signal} received — shutting down gracefully`);

  // The safety net: if something refuses to close, die anyway rather than hang
  // until the orchestrator SIGKILLs us.
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    stopScheduler();

    if (server) {
      await new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      logger.info('HTTP server closed; in-flight requests completed');
    }

    await disconnectDatabase();

    clearTimeout(forceExit);
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', { error: error.message });
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * An unhandled rejection has left the process in an unknown state. Log it and
 * shut down cleanly rather than limping on and serving corrupted responses —
 * the orchestrator will start a fresh, healthy instance.
 */
process.on('unhandledRejection', (reason) => {
  logger.error('UNHANDLED REJECTION', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  shutdown('unhandledRejection');
});

process.on('uncaughtException', (error) => {
  logger.error('UNCAUGHT EXCEPTION', { message: error.message, stack: error.stack });
  shutdown('uncaughtException');
});

start().catch((error) => {
  logger.error('Failed to start', { message: error.message, stack: error.stack });
  process.exit(1);
});
