/**
 * Runtime settings.
 *
 * The line I draw: anything an administrator should be able to change WITHOUT a
 * redeploy lives in the database (reminder grace period, how many days back an
 * employee may edit, whether daily submission is mandatory). Anything that is
 * infrastructure or a secret stays in environment variables (DB URL, JWT keys,
 * SMTP host). Putting the JWT secret in a settings table would let an admin UI
 * compromise the whole system; putting the reminder grace period in an env var
 * means a two-minute policy tweak needs a release.
 *
 * Cached in-process with a short TTL — these are read on every task write and
 * every job tick, and they change perhaps monthly.
 */
import { prisma } from '../../config/prisma.js';
import { SETTING_KEY } from '../../config/constants.js';
import { NotFoundError, BadRequestError } from '../../core/errors.js';
import * as audit from '../audit/audit.service.js';
import { logger } from '../../config/logger.js';
import { fullName } from '../../utils/name.js';

const DEFAULTS = Object.freeze({
  [SETTING_KEY.REMINDERS_ENABLED]: {
    value: true,
    category: 'notifications',
    description: 'Send hourly reminders to employees who have not logged the previous hour.',
  },
  [SETTING_KEY.REMINDER_GRACE_MINUTES]: {
    // 2 hours. An employee who is heads-down on one problem should not be nagged
    // — nor marked late — for not stopping to fill in a form the moment the clock
    // ticks over. Past two hours it is a genuine gap, and both the employee and
    // their Tech Lead hear about it.
    value: 120,
    category: 'notifications',
    description:
      'Grace period, in minutes, after an hour ends. Past this, the hour counts as overdue: the employee is notified, and their Tech Lead and Management are alerted. Any entry saved after it is flagged as a late update.',
  },
  [SETTING_KEY.UPDATE_REQUIRED_HOURS]: {
    // Deliberately LONGER than the 2-hour reminder grace. Two thresholds, two
    // audiences: 2 hours earns a private nudge from the system; 3 hours puts your
    // name on the CEO's dashboard. Collapsing them into one would mean every
    // ordinary slip is escalated to the top, and the escalation stops meaning
    // anything within a week.
    value: 3,
    category: 'tasks',
    description:
      'Hours an employee may go without logging a finished hour before the dashboard lists them under "Update required". Longer than the reminder grace period on purpose: 2 hours is a private nudge, 3 hours reaches the CEO dashboard.',
  },
  [SETTING_KEY.ESCALATE_TO_LEAD]: {
    value: true,
    category: 'notifications',
    description:
      'Alert the Tech Lead when someone in their department passes the grace period with an hour still unfilled.',
  },
  [SETTING_KEY.ESCALATE_TO_MANAGEMENT]: {
    value: true,
    category: 'notifications',
    description:
      'Alert Management when employees pass the grace period with hours still unfilled.',
  },
  [SETTING_KEY.LEAD_DIGEST_ENABLED]: {
    value: true,
    category: 'notifications',
    description: 'Email Tech Leads a list of team members with missing updates.',
  },
  [SETTING_KEY.MANAGEMENT_SUMMARY_ENABLED]: {
    value: true,
    category: 'notifications',
    description: 'Email Management a daily company-wide activity summary.',
  },
  [SETTING_KEY.AUTOSAVE_DEBOUNCE_MS]: {
    value: 1200,
    category: 'tasks',
    description: 'How long the task grid waits after the last keystroke before auto-saving.',
  },
  [SETTING_KEY.ALLOW_BACKDATED_EDIT_DAYS]: {
    value: 2,
    category: 'tasks',
    description:
      'How many days back an employee may still edit their own task sheet. Tech Leads and Management are not bound by this.',
  },
  [SETTING_KEY.REQUIRE_DAILY_SUBMISSION]: {
    value: true,
    category: 'tasks',
    description: 'Require employees to submit their sheet for approval at the end of each day.',
  },
  [SETTING_KEY.AUTO_APPROVE_ENABLED]: {
    value: true,
    category: 'tasks',
    description:
      'Automatically approve a submitted task sheet that no Tech Lead has reviewed within the auto-approve window. Prevents an employee’s record being held hostage to a busy or absent lead.',
  },
  [SETTING_KEY.AUTO_APPROVE_HOURS]: {
    // A full working day. A lead has ample time to review; past it, the sheet is
    // the employee's honest record and should not stay frozen because nobody got
    // to it. Auto-approval is clearly marked in the audit trail, so a lead can
    // still reopen and correct it afterwards.
    value: 24,
    category: 'tasks',
    description:
      'Hours a submitted sheet waits for review before it auto-approves. The clock starts at submission and resets if the sheet is sent back and resubmitted.',
    validate: (v) => Number.isInteger(v) && v >= 1 && v <= 168,
  },
  [SETTING_KEY.AI_ANALYSIS_INTERVAL_HOURS]: {
    // The single lever over what the analyser costs. The job wakes hourly during
    // working hours but only does anything once this many hours have passed, and
    // the window it reads always matches this number — so raising it cuts API
    // calls proportionally WITHOUT leaving hours unexamined. Bounded at 1 (an
    // hourly cadence is the most anyone could defend paying for) and at 12 (past
    // a working day it is no longer monitoring, it is a daily report).
    value: 2,
    category: 'ai',
    description:
      'How often the AI work-alignment analyser runs, in hours. The window it examines always matches, so no logged hour goes unexamined. Raising this is the most direct way to reduce AI cost.',
    validate: (v) => Number.isInteger(v) && v >= 1 && v <= 12,
  },
});

const cache = new Map();
const TTL_MS = 60 * 1000;

/**
 * @template T
 * @param {string} key
 * @param {T} [fallback]
 * @returns {Promise<T>}
 */
export const get = async (key, fallback) => {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const row = await prisma.systemSetting.findUnique({ where: { key } });
  const value = row ? row.value : (fallback ?? DEFAULTS[key]?.value);

  cache.set(key, { value, at: Date.now() });
  return value;
};

/** Fetch several at once — one query instead of N. Used by the jobs. */
export const getMany = async (keys) => {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: keys } } });
  const found = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    keys.map((k) => [k, found.has(k) ? found.get(k) : DEFAULTS[k]?.value]),
  );
};

export const list = async () => {
  const rows = await prisma.systemSetting.findMany({
    include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });

  // Surface defaults that have never been persisted, so the settings screen
  // shows the complete, real configuration rather than an empty table.
  const persisted = new Set(rows.map((r) => r.key));
  const virtual = Object.entries(DEFAULTS)
    .filter(([key]) => !persisted.has(key))
    .map(([key, def]) => ({
      key,
      value: def.value,
      description: def.description,
      category: def.category,
      updatedAt: null,
      updatedBy: null,
      isDefault: true,
    }));

  const mapped = rows.map((r) => ({
    key: r.key,
    value: r.value,
    description: r.description ?? DEFAULTS[r.key]?.description ?? null,
    category: r.category,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy
      ? { id: r.updatedBy.id, fullName: fullName(r.updatedBy) }
      : null,
    isDefault: false,
  }));

  return [...mapped, ...virtual].sort(
    (a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
  );
};

export const set = async (key, value, actor) => {
  if (!Object.hasOwn(DEFAULTS, key)) {
    // Only known keys. An open key-value store in an admin UI is a great way to
    // ship a typo'd setting that silently does nothing forever.
    throw new NotFoundError(`Setting "${key}"`, { code: 'UNKNOWN_SETTING' });
  }

  const before = await prisma.systemSetting.findUnique({ where: { key } });
  const def = DEFAULTS[key];

  // A known key is not the same as a sane value. Without this, "analyse every 0
  // hours" is accepted and the job runs on every single tick against a zero-width
  // window — a setting that silently does nothing except spend money.
  if (def.validate && !def.validate(value)) {
    throw new BadRequestError(`"${JSON.stringify(value)}" is not a valid value for ${key}`, {
      code: 'INVALID_SETTING_VALUE',
    });
  }

  const row = await prisma.systemSetting.upsert({
    where: { key },
    create: {
      key,
      value,
      description: def.description,
      category: def.category,
      updatedById: actor.id,
    },
    update: { value, updatedById: actor.id },
  });

  cache.delete(key);

  audit.record({
    action: 'SETTING_UPDATED',
    entityType: 'SystemSetting',
    entityId: key,
    summary: `Setting "${key}" changed to ${JSON.stringify(value)}`,
    before: { value: before?.value ?? def.value },
    after: { value },
  });

  logger.info('Setting updated', { key, by: actor.id });
  return row;
};

/** Seed-time: persist the defaults so the settings screen is not empty on day 1. */
export const ensureDefaults = async () => {
  for (const [key, def] of Object.entries(DEFAULTS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: def.value, description: def.description, category: def.category },
      update: {}, // never overwrite an administrator's choice
    });
  }
};

export const SETTING_DEFAULTS = DEFAULTS;
