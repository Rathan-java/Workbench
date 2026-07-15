/**
 * DISTRIBUTED LOCK FOR SCHEDULED JOBS.
 *
 * THE BUG THIS PREVENTS
 * `node-cron` runs inside the application process. Azure App Service scales out.
 * With three instances, every cron expression fires three times: three copies of
 * every reminder email, three Tech Lead digests, and — worst — three concurrent
 * 180-day DELETE transactions racing each other on the same rows.
 *
 * Almost every Node "enterprise starter" ships this bug, because it only appears
 * the day you scale past one instance, which is also the day you have real users.
 *
 * THE MECHANISM
 * A single atomic UPDATE. `updateMany` on a row whose lock has expired either
 * affects 1 row (we won, we hold the lock) or 0 rows (someone else holds it).
 * MySQL's row-level locking makes that read-modify-write atomic — there is no
 * check-then-act window for a second instance to slip through.
 *
 * The lease has a TTL, so an instance that is OOM-killed mid-job does not hold
 * the lock forever; the next tick after expiry picks it up.
 */
import { randomUUID } from 'node:crypto';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';

/** Identifies THIS process, so a crashed instance's lock is recognisable. */
const OWNER = `${process.env.WEBSITE_INSTANCE_ID ?? 'local'}-${process.pid}-${randomUUID().slice(0, 8)}`;

/**
 * @param {string} name        Job name; also the primary key of the lock row.
 * @param {number} ttlSeconds  Must exceed the job's worst-case runtime.
 * @returns {Promise<boolean>} true if THIS process now holds the lock.
 */
export const acquireLock = async (name, ttlSeconds) => {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlSeconds * 1000);

  // Ensure the row exists. `create` racing another instance throws P2002, which
  // is fine — it means the row now exists, which is all we needed.
  try {
    await prisma.schedulerLock.create({
      data: { name, lockedUntil: new Date(0), owner: 'none' },
    });
  } catch {
    /* already exists — expected on every run after the first */
  }

  // THE ATOMIC STEP. Only one instance can match `lockedUntil < now`.
  const { count } = await prisma.schedulerLock.updateMany({
    where: { name, lockedUntil: { lt: now } },
    data: { lockedUntil, owner: OWNER },
  });

  if (count === 0) {
    logger.debug('Job lock held by another instance; skipping', { job: name });
    return false;
  }

  logger.debug('Job lock acquired', { job: name, owner: OWNER, ttlSeconds });
  return true;
};

/**
 * Release early so a fast job does not block the next tick for its whole TTL.
 * Guarded by `owner` — a process whose lease already expired and was taken over
 * must not release someone else's lock.
 */
export const releaseLock = async (name, { ok = true, note } = {}) => {
  await prisma.schedulerLock.updateMany({
    where: { name, owner: OWNER },
    data: {
      lockedUntil: new Date(0),
      lastRunAt: new Date(),
      lastRunOk: ok,
      lastRunNote: note?.slice(0, 500) ?? null,
    },
  });
};

/**
 * Run `fn` at most once across the whole cluster.
 * Every job in this system goes through here — there is no other entry point.
 *
 * @param {string} name
 * @param {number} ttlSeconds
 * @param {() => Promise<string|void>} fn Returns a short note for the lock row.
 */
export const withLock = async (name, ttlSeconds, fn) => {
  const acquired = await acquireLock(name, ttlSeconds);
  if (!acquired) return { skipped: true };

  const startedAt = Date.now();

  try {
    const note = await fn();
    const durationMs = Date.now() - startedAt;

    logger.info('Job completed', { job: name, durationMs, note });
    await releaseLock(name, { ok: true, note: typeof note === 'string' ? note : undefined });

    return { skipped: false, ok: true, durationMs };
  } catch (error) {
    logger.error('Job failed', { job: name, error: error.message, stack: error.stack });
    await releaseLock(name, { ok: false, note: error.message });
    // Swallowed on purpose: an unhandled rejection inside a cron tick kills the
    // whole API process. A failed reminder job must not take down task logging.
    return { skipped: false, ok: false, error: error.message };
  }
};

export const LOCK_OWNER = OWNER;
