/**
 * THE 180-DAY RETENTION JOB.
 *
 * The brief: "Every day at 12:05 AM, delete task records older than exactly 180
 * days. Users, Projects, Teams, Audit Logs and Settings must never be deleted."
 *
 * Three things the naive implementation gets wrong, and how this one differs.
 *
 * 1. ONE BIG DELETE LOCKS THE TABLE.
 *    `DELETE FROM task_entries WHERE workDate < ?` against six months of rows is
 *    a single transaction holding gap locks across a huge range of the clustered
 *    index. On a live MySQL instance that can block every INSERT into that table
 *    for minutes. At 00:05 the night shift is still logging work.
 *    → We delete in batches of RETENTION_BATCH_SIZE (default 1,000), each its own
 *      short transaction, yielding between batches.
 *
 * 2. IT RUNS ON EVERY INSTANCE.
 *    See lock.js. Three App Service instances = three concurrent purges racing.
 *    → Guarded by the distributed lock.
 *
 * 3. IT DELETES SILENTLY.
 *    A retention job that destroys data without leaving a trace is unauditable —
 *    and "where did Q1 go?" is a very bad conversation to have with no answer.
 *    → We count what we removed and write an immutable audit row. The audit row
 *      itself is exempt from retention, by design.
 *
 * WHAT IS DELETED: TaskEntry, TaskEntryRevision, TaskDayTransition, TaskDay and
 * DailyProductivityRollup rows older than the cutoff — nothing else. Cascades in
 * the schema mean deleting a TaskDay takes its entries and revisions with it, but
 * we delete children first anyway so each batch is small and predictable.
 */
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { withLock } from './lock.js';
import { retentionCutoff, formatWorkDate } from '../utils/date.js';
import * as audit from '../modules/audit/audit.service.js';

const JOB_NAME = 'retention-cleanup';
const LOCK_TTL_SECONDS = 30 * 60;

/**
 * Delete rows matching `where` in batches, never in one shot.
 * Prisma has no "DELETE ... LIMIT", so we select a page of ids and delete those.
 */
const deleteInBatches = async (model, where, label) => {
  let deleted = 0;
  let batches = 0;

  for (;;) {
    const rows = await prisma[model].findMany({
      where,
      select: { id: true },
      take: env.RETENTION_BATCH_SIZE,
    });

    if (!rows.length) break;

    const { count } = await prisma[model].deleteMany({
      where: { id: { in: rows.map((r) => r.id) } },
    });

    deleted += count;
    batches += 1;

    logger.debug('Retention batch deleted', { label, batch: batches, count, totalSoFar: deleted });

    // Yield to the event loop so the API keeps serving requests between batches.
    // Without this the job monopolises the connection pool for its whole run.
    await new Promise((resolve) => setImmediate(resolve));

    if (rows.length < env.RETENTION_BATCH_SIZE) break;
  }

  return { deleted, batches };
};

export const runRetentionCleanup = () =>
  withLock(JOB_NAME, LOCK_TTL_SECONDS, async () => {
    const cutoff = retentionCutoff(env.TASK_RETENTION_DAYS);
    const cutoffLabel = formatWorkDate(cutoff);

    logger.info('Retention cleanup starting', {
      retentionDays: env.TASK_RETENTION_DAYS,
      cutoff: cutoffLabel,
      batchSize: env.RETENTION_BATCH_SIZE,
    });

    const olderThanCutoff = { workDate: { lt: cutoff } };

    // Children first, then parents. The FK cascade would handle it, but deleting
    // a parent whose children number in the tens of thousands makes ONE batch of
    // 1,000 parents into a delete of 7,000+ rows — exactly the long transaction
    // we are trying to avoid.
    const revisions = await deleteInBatches('taskEntryRevision', olderThanCutoff, 'revisions');
    const entries = await deleteInBatches('taskEntry', olderThanCutoff, 'entries');
    const rollups = await deleteInBatches('dailyProductivityRollup', olderThanCutoff, 'rollups');

    // Transitions hang off TaskDay and have no workDate of their own.
    const transitions = await prisma.taskDayTransition.deleteMany({
      where: { taskDay: olderThanCutoff },
    });

    const days = await deleteInBatches('taskDay', olderThanCutoff, 'days');

    const totals = {
      taskEntries: entries.deleted,
      taskEntryRevisions: revisions.deleted,
      taskDayTransitions: transitions.count,
      taskDays: days.deleted,
      productivityRollups: rollups.deleted,
    };

    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);

    // The trace that survives the data. Never itself deleted.
    audit.record({
      action: 'RETENTION_CLEANUP',
      entityType: 'System',
      summary: `Retention cleanup removed ${grandTotal.toLocaleString()} task records older than ${cutoffLabel} (${env.TASK_RETENTION_DAYS}-day policy). Users, teams, projects, settings and audit logs were not touched.`,
      after: { cutoff: cutoffLabel, retentionDays: env.TASK_RETENTION_DAYS, ...totals },
    });

    logger.info('Retention cleanup complete', { cutoff: cutoffLabel, ...totals });

    return `Removed ${grandTotal} records older than ${cutoffLabel}`;
  });

export const RETENTION_JOB_NAME = JOB_NAME;
