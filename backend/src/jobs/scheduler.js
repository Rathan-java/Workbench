/**
 * The scheduler.
 *
 * Every cron expression and every TTL is configuration, not a literal buried in
 * a call site — a business that moves its working day cannot be waiting on a
 * release to move its reminders with it.
 *
 * All five jobs go through withLock(), so running three App Service instances
 * produces exactly one execution of each. See lock.js.
 */
import cron from 'node-cron';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { runRetentionCleanup } from './retentionCleanup.job.js';
import { runRollup } from './rollup.job.js';
import { runAutoApproval } from './autoApproval.job.js';
import {
  runHourlyReminders,
  runLeadDigest,
  runManagementSummary,
  runUnsubmittedCheck,
} from './reminders.job.js';
import { prisma } from '../config/prisma.js';

/** @type {import('node-cron').ScheduledTask[]} */
const tasks = [];

const JOBS = [
  {
    name: 'retention-cleanup',
    schedule: () => env.CRON_RETENTION_CLEANUP,
    run: runRetentionCleanup,
    description: `Delete task data older than ${env.TASK_RETENTION_DAYS} days`,
  },
  {
    name: 'productivity-rollup',
    schedule: () => env.CRON_ROLLUP,
    run: runRollup,
    description: 'Materialise daily productivity aggregates',
  },
  {
    name: 'hourly-reminders',
    schedule: () => env.CRON_HOURLY_REMINDER,
    run: runHourlyReminders,
    description: 'Nudge employees who have not logged an elapsed hour',
  },
  {
    name: 'lead-digest',
    schedule: () => env.CRON_LEAD_DIGEST,
    run: runLeadDigest,
    description: 'Email each Tech Lead the list of employees who are behind',
  },
  {
    name: 'management-summary',
    schedule: () => env.CRON_MANAGEMENT_SUMMARY,
    run: runManagementSummary,
    description: 'Email Management the company-wide daily summary',
  },
  {
    name: 'unsubmitted-check',
    // 09:15 on weekdays — catches yesterday's sheets that were never submitted.
    schedule: () => '15 9 * * 1-5',
    run: runUnsubmittedCheck,
    description: 'Nudge employees whose previous sheet is still in draft',
  },
  {
    name: 'auto-approval',
    // Every hour at :40 — a sheet that crosses the window is approved within the
    // hour. Off-cadence from the other hourly jobs so they do not all fire at once.
    schedule: () => env.CRON_AUTO_APPROVE,
    run: runAutoApproval,
    description: 'Approve submitted sheets left unreviewed past the auto-approve window',
  },
];

export const startScheduler = () => {
  if (!env.SCHEDULER_ENABLED) {
    logger.warn('Scheduler is DISABLED (SCHEDULER_ENABLED=false). No cron jobs will run.');
    return;
  }

  for (const job of JOBS) {
    const expression = job.schedule();

    if (!cron.validate(expression)) {
      // Fail loudly. A silently-invalid cron expression means the retention job
      // never runs, and nobody notices until the database is 400 GB.
      logger.error('INVALID CRON EXPRESSION — job not scheduled', {
        job: job.name,
        expression,
      });
      continue;
    }

    const task = cron.schedule(
      expression,
      async () => {
        logger.debug('Cron tick', { job: job.name });
        // withLock already swallows and logs failures — an unhandled rejection
        // inside a cron callback would take the whole API process down with it.
        await job.run();
      },
      { scheduled: true, timezone: env.CRON_TIMEZONE },
    );

    tasks.push(task);
    logger.info('Job scheduled', {
      job: job.name,
      expression,
      timezone: env.CRON_TIMEZONE,
      description: job.description,
    });
  }

  logger.info(`Scheduler started with ${tasks.length} job(s)`, { timezone: env.CRON_TIMEZONE });
};

export const stopScheduler = () => {
  for (const task of tasks) task.stop();
  tasks.length = 0;
  logger.info('Scheduler stopped');
};

/** Ops visibility: what ran, when, and did it work. Surfaced on /admin/settings. */
export const getJobStatus = async () => {
  const locks = await prisma.schedulerLock.findMany();
  const lockByName = new Map(locks.map((l) => [l.name, l]));

  return JOBS.map((job) => {
    const lock = lockByName.get(job.name);
    return {
      name: job.name,
      description: job.description,
      schedule: job.schedule(),
      timezone: env.CRON_TIMEZONE,
      enabled: env.SCHEDULER_ENABLED,
      lastRunAt: lock?.lastRunAt ?? null,
      lastRunOk: lock?.lastRunOk ?? null,
      lastRunNote: lock?.lastRunNote ?? null,
      isRunning: lock ? lock.lockedUntil > new Date() : false,
    };
  });
};

/** Manual trigger, for the admin screen and for the test suite. */
export const runJobNow = async (name) => {
  const job = JOBS.find((j) => j.name === name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  logger.info('Job triggered manually', { job: name });
  return job.run();
};

export const JOB_NAMES = JOBS.map((j) => j.name);
