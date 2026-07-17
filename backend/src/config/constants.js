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

/**
 * ASSIGNMENT — the delivery state of a unit of *assigned* work.
 *
 * This is the forward-looking counterpart to a TaskEntry, and it is where the
 * work-status the entry deliberately lacks (design note 2) legitimately lives:
 * an assignment genuinely moves through states, an hour already lived does not.
 * Same table-of-legal-moves discipline as DAY_TRANSITIONS.
 */
export const ASSIGNMENT_STATUS = Object.freeze({
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
});
export const ASSIGNMENT_STATUSES = Object.freeze(Object.values(ASSIGNMENT_STATUS));

export const ASSIGNMENT_TRANSITIONS = Object.freeze({
  // Un-started work can begin, be submitted straight away, or be called off.
  // CANCEL is ONLY legal here — once work has begun (an hour has been logged),
  // the task can no longer be cancelled by anyone, including the creator: real
  // effort has been recorded against it and must not be thrown away. Stopping a
  // started task is a REOPEN-and-leave decision, not a cancellation.
  [ASSIGNMENT_STATUS.ASSIGNED]: [
    ASSIGNMENT_STATUS.IN_PROGRESS,
    ASSIGNMENT_STATUS.SUBMITTED,
    ASSIGNMENT_STATUS.CANCELLED,
  ],
  [ASSIGNMENT_STATUS.IN_PROGRESS]: [ASSIGNMENT_STATUS.SUBMITTED],
  // The lead's move: confirm it DONE, or send it back to be worked on (reopen).
  [ASSIGNMENT_STATUS.SUBMITTED]: [ASSIGNMENT_STATUS.DONE, ASSIGNMENT_STATUS.IN_PROGRESS],
  // Terminal for the employee. A lead can REOPEN a completed assignment — an
  // explicit, audited override, never a silent edit.
  [ASSIGNMENT_STATUS.DONE]: [ASSIGNMENT_STATUS.IN_PROGRESS],
  // A cancelled assignment can be restored to the backlog.
  [ASSIGNMENT_STATUS.CANCELLED]: [ASSIGNMENT_STATUS.ASSIGNED],
});

export const canAssignmentTransition = (from, to) =>
  (ASSIGNMENT_TRANSITIONS[from] ?? []).includes(to);

/**
 * "Open" — the assignment is still live and shows on the employee's plate and in
 * delivery counts. DONE and CANCELLED are closed.
 */
export const ASSIGNMENT_OPEN_STATUSES = Object.freeze([
  ASSIGNMENT_STATUS.ASSIGNED,
  ASSIGNMENT_STATUS.IN_PROGRESS,
  ASSIGNMENT_STATUS.SUBMITTED,
]);

/**
 * "Active" — work the employee is still expected to act on. This is the set that
 * drives the "required only if assigned" rule on the hourly grid: if the employee
 * has an assignment in one of these states, each hour must name one of them (or
 * be explicitly logged as "Other work"). SUBMITTED is excluded — they believe it
 * is finished and are waiting on review, so it should not force a tag.
 */
export const ASSIGNMENT_ACTIVE_STATUSES = Object.freeze([
  ASSIGNMENT_STATUS.ASSIGNED,
  ASSIGNMENT_STATUS.IN_PROGRESS,
]);

export const ASSIGNMENT_PRIORITY = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
});
export const ASSIGNMENT_PRIORITY_LIST = Object.freeze(Object.values(ASSIGNMENT_PRIORITY));

/** Assignment title/description limits — enforced identically by Zod and the UI. */
export const ASSIGNMENT_TITLE_MIN = 3;
export const ASSIGNMENT_TITLE_MAX = 200;
export const ASSIGNMENT_DESCRIPTION_MAX = 4000;

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
  /** A submitted sheet nobody reviews auto-approves after this many hours. */
  AUTO_APPROVE_ENABLED: 'tasks.autoApprove.enabled',
  AUTO_APPROVE_HOURS: 'tasks.autoApprove.hours',
});

/** The grace period, in minutes. Overridable in Settings; this is the fallback. */
export const DEFAULT_GRACE_MINUTES = 120;

export default {
  DAY_STATUS,
  DAY_STATUSES,
  DAY_TRANSITIONS,
  canTransition,
  LOCKED_DAY_STATUSES,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_TRANSITIONS,
  canAssignmentTransition,
  ASSIGNMENT_OPEN_STATUSES,
  ASSIGNMENT_ACTIVE_STATUSES,
  ASSIGNMENT_PRIORITY,
  ASSIGNMENT_PRIORITY_LIST,
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
