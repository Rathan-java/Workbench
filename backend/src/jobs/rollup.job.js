/**
 * Nightly productivity rollup.
 *
 * WHY THIS EXISTS
 * Every Management dashboard wants "compliance over the last 90 days, by
 * department, by team, by employee". Computed from task_entries that is a scan
 * and aggregate over hundreds of thousands of rows — per chart, per manager, per
 * page load. It is fine on day one with 40 rows and unusable at month six.
 *
 * So once a night we collapse each employee-day into a single pre-aggregated row.
 * Dashboards then read a few hundred rows off an index. The fact table is still
 * there for drill-down and export; the rollup is purely an acceleration layer.
 *
 * IDEMPOTENT BY CONSTRUCTION
 * The job upserts on (userId, workDate). Re-running it for the same date — after
 * a failure, or manually to backfill — produces exactly the same result. A rollup
 * job you cannot safely re-run is a rollup job you will be afraid to touch at 2am.
 */
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { withLock } from './lock.js';
import { toWorkDate, todayWorkDate, formatWorkDate, eachWorkDate, dayjs } from '../utils/date.js';

const JOB_NAME = 'productivity-rollup';

/**
 * Recompute the rollup for a single date.
 * Exported so it can be called for a backfill, and so the tests can call it
 * directly without going through cron.
 *
 * @param {Date|string} date
 */
export const rollupDate = async (date) => {
  const workDate = toWorkDate(date);

  const days = await prisma.taskDay.findMany({
    // `userId: not null` skips the timesheets of DELETED employees.
    //
    // Their work is preserved (see user.service.destroy) and their rollup rows
    // were preserved along with it — but there is no live user to recompute
    // against, and the upsert below keys on (userId, workDate), which cannot take
    // a NULL. Recomputing them would be pointless anyway: a departed employee's
    // history cannot change.
    where: { workDate, userId: { not: null } },
    select: {
      id: true,
      userId: true,
      departmentId: true,
      teamId: true,
      filledSlots: true,
      expectedSlots: true,
    },
  });

  if (!days.length) {
    logger.debug('Rollup: no task days for date', { date: formatWorkDate(workDate) });
    return 0;
  }

  // Two GROUP BYs for the whole date, not one query per employee. With 300
  // employees the naive version is 600 round trips; this is two.
  //
  // There is no status GROUP BY any more. There used to be six counters here
  // (notStarted/inProgress/completed/blocked/onHold/testing) and the day status
  // stopped existing they all collapsed to the same number — six columns holding
  // filledSlots, which is not analytics, it is noise with a schema.
  //
  // What replaced it is the one aggregate a raw hour count genuinely cannot
  // give you: how many DISTINCT projects a person was pulled across in a day.
  // Eight hours on one project and eight hours across six projects are very
  // different days, and only one of them is a person doing focused work.
  const [projectRows, lateRows] = await Promise.all([
    prisma.taskEntry.groupBy({
      by: ['userId', 'projectId'],
      where: { workDate, userId: { not: null } },
      _count: { _all: true },
    }),
    prisma.taskEntry.groupBy({
      by: ['userId'],
      where: { workDate, isLate: true, userId: { not: null } },
      _count: { _all: true },
    }),
  ]);

  // groupBy(userId, projectId) yields one row per (person, project) pair, so the
  // number of rows for a person IS their distinct project count.
  /** @type {Map<string, number>} */
  const projectsByUser = new Map();
  for (const row of projectRows) {
    projectsByUser.set(row.userId, (projectsByUser.get(row.userId) ?? 0) + 1);
  }

  const lateByUser = new Map(lateRows.map((r) => [r.userId, r._count._all]));

  let written = 0;

  // Chunked so a 500-employee company does not open 500 concurrent upserts and
  // exhaust the connection pool.
  const CHUNK = 50;
  for (let i = 0; i < days.length; i += CHUNK) {
    const chunk = days.slice(i, i + CHUNK);

    await prisma.$transaction(
      chunk.map((day) => {
        const filled = day.filledSlots;
        const expected = day.expectedSlots;

        const data = {
          workDate,
          userId: day.userId,
          departmentId: day.departmentId,
          teamId: day.teamId,
          expectedSlots: expected,
          filledSlots: filled,
          lateSlots: lateByUser.get(day.userId) ?? 0,
          projectsTouched: projectsByUser.get(day.userId) ?? 0,
          complianceRate: expected > 0 ? Math.round((filled / expected) * 1000) / 10 : 0,
          computedAt: new Date(),
        };

        return prisma.dailyProductivityRollup.upsert({
          where: { userId_workDate: { userId: day.userId, workDate } },
          create: data,
          update: data,
        });
      }),
    );

    written += chunk.length;
  }

  logger.debug('Rollup written', { date: formatWorkDate(workDate), rows: written });
  return written;
};

/**
 * The nightly run.
 *
 * Recomputes YESTERDAY and TODAY, not just yesterday. Today because a manager
 * looking at a trend chart at 09:00 should see this morning's data; yesterday
 * because a Tech Lead may have corrected an entry after midnight, and the rollup
 * must reflect the correction rather than the pre-correction snapshot.
 */
export const runRollup = () =>
  withLock(JOB_NAME, 20 * 60, async () => {
    const today = todayWorkDate();
    const yesterday = dayjs.utc(today).subtract(1, 'day').toDate();

    const [y, t] = await Promise.all([rollupDate(yesterday), rollupDate(today)]);

    return `Rolled up ${y + t} employee-days (${formatWorkDate(yesterday)}, ${formatWorkDate(today)})`;
  });

/**
 * Backfill. Used once after deployment to populate the rollup from existing task
 * data, and available for disaster recovery.
 *
 * @param {string} from YYYY-MM-DD
 * @param {string} to   YYYY-MM-DD
 */
export const backfillRollups = async (from, to) => {
  const dates = eachWorkDate(toWorkDate(from), toWorkDate(to));
  logger.info('Backfilling rollups', { from, to, days: dates.length });

  let total = 0;
  for (const date of dates) {
    total += await rollupDate(date);
  }

  logger.info('Backfill complete', { rows: total });
  return total;
};

export const ROLLUP_JOB_NAME = JOB_NAME;
