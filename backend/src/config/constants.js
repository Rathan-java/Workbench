/**
 * Domain constants. Single source of truth shared by validation, services and
 * the Swagger schema. The enum lists here must agree with schema.prisma.
 *
 * THERE IS NO TASK_STATUS AND NO TASK_PRIORITY, deliberately.
 * An employee writes an hour up after living it, so every entry is completed
 * work — a status column could only ever hold one value. And an hour that has
 * already happened cannot be re-prioritised. Both were fields that asked a
 * question with no real answer, which is how a form teaches people to click
 * through it without reading.
 *
 * The only status left in the system is DAY_STATUS: the approval state of a
 * whole timesheet, which is a genuine state machine with genuine transitions.
 */

export const DAY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});
export const DAY_STATUSES = Object.freeze(Object.values(DAY_STATUS));

/**
 * The approval state machine, declared as data.
 *
 * Encoding legal transitions in a table (rather than as `if` statements inside
 * an `approve()` method) means an illegal move is impossible by construction
 * and the whole workflow is one object a new engineer can read in ten seconds.
 */
export const DAY_TRANSITIONS = Object.freeze({
  [DAY_STATUS.DRAFT]: [DAY_STATUS.SUBMITTED],
  [DAY_STATUS.SUBMITTED]: [DAY_STATUS.APPROVED, DAY_STATUS.REJECTED, DAY_STATUS.DRAFT],
  [DAY_STATUS.REJECTED]: [DAY_STATUS.DRAFT, DAY_STATUS.SUBMITTED],
  // Terminal for the employee. A lead/management can REOPEN to DRAFT, which is
  // an explicit, audited override — never a silent edit.
  [DAY_STATUS.APPROVED]: [DAY_STATUS.DRAFT],
});

export const canTransition = (from, to) => (DAY_TRANSITIONS[from] ?? []).includes(to);

/** A day in these states is read-only for its owner. */
export const LOCKED_DAY_STATUSES = Object.freeze([DAY_STATUS.SUBMITTED, DAY_STATUS.APPROVED]);

export const ROLE = Object.freeze({
  MANAGEMENT: 'MANAGEMENT',
  TECH_LEAD: 'TECH_LEAD',
  EMPLOYEE: 'EMPLOYEE',
});
export const ROLE_LIST = Object.freeze(Object.values(ROLE));

export const USER_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  LOCKED: 'LOCKED',
});
export const USER_STATUS_LIST = Object.freeze(Object.values(USER_STATUS));

export const FIELD_TYPE = Object.freeze({
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  NUMBER: 'NUMBER',
  SELECT: 'SELECT',
  MULTISELECT: 'MULTISELECT',
  DATE: 'DATE',
  BOOLEAN: 'BOOLEAN',
  DURATION_MINUTES: 'DURATION_MINUTES',
  URL: 'URL',
});

/**
 * The four departments, by stable machine code.
 * These codes are referenced by the seed and by department-specific field
 * definitions. The *rows* are data — this object only names the seeded ones.
 */
export const DEPARTMENT_CODE = Object.freeze({
  TECH: 'TECH',
  DIGITAL_MARKETING: 'DIGITAL_MARKETING',
  SOCIAL_MEDIA: 'SOCIAL_MEDIA',
  VIDEO_EDITING: 'VIDEO_EDITING',
});

export const PROJECT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
});
export const PROJECT_STATUS_LIST = Object.freeze(Object.values(PROJECT_STATUS));

/** Task description limits — enforced identically by Zod and by the UI counter. */
export const TASK_DESCRIPTION_MIN = 3;
export const TASK_DESCRIPTION_MAX = 2000;
export const TASK_REMARKS_MAX = 1000;

/** Settings keys that live in the DB (runtime-tunable, no redeploy). */
export const SETTING_KEY = Object.freeze({
  REMINDERS_ENABLED: 'notifications.reminders.enabled',
  REMINDER_GRACE_MINUTES: 'notifications.reminders.graceMinutes',
  UPDATE_REQUIRED_HOURS: 'dashboard.updateRequiredHours',
  ESCALATE_TO_LEAD: 'notifications.escalate.toLead',
  ESCALATE_TO_MANAGEMENT: 'notifications.escalate.toManagement',
  LEAD_DIGEST_ENABLED: 'notifications.leadDigest.enabled',
  MANAGEMENT_SUMMARY_ENABLED: 'notifications.managementSummary.enabled',
  AUTOSAVE_DEBOUNCE_MS: 'tasks.autosave.debounceMs',
  ALLOW_BACKDATED_EDIT_DAYS: 'tasks.allowBackdatedEditDays',
  REQUIRE_DAILY_SUBMISSION: 'tasks.requireDailySubmission',
});

/** The grace period, in minutes. Overridable in Settings; this is the fallback. */
export const DEFAULT_GRACE_MINUTES = 120;

export default {
  DAY_STATUS,
  DAY_STATUSES,
  DAY_TRANSITIONS,
  canTransition,
  LOCKED_DAY_STATUSES,
  ROLE,
  ROLE_LIST,
  USER_STATUS,
  USER_STATUS_LIST,
  FIELD_TYPE,
  DEPARTMENT_CODE,
  PROJECT_STATUS,
  PROJECT_STATUS_LIST,
  SETTING_KEY,
};
