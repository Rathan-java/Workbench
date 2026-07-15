/**
 * Dropdown-ready mirrors of the backend enums
 * (backend/src/config/constants.js). The VALUES must match exactly — the API
 * validates them with Zod and will 422 on anything else.
 */

const toOptions = (map) =>
  Object.entries(map).map(([value, label]) => ({ value, label }));

/**
 * There is no TASK_STATUS and no TASK_PRIORITY, and there will not be one again.
 *
 * A task entry is a RECORD OF WORK ALREADY DONE — it is written against an hour
 * that has already been lived. Asking whether that hour is "In Progress" or
 * "Blocked" is a category error: the hour is over. And an hour that is already
 * spent cannot be re-prioritised — you cannot decide, after the fact, that
 * Tuesday 10:00 should have been Critical.
 *
 * The backend dropped both columns. The axis that survives is TaskDay.status
 * (DRAFT → SUBMITTED → APPROVED/REJECTED), which is an APPROVAL state, not a
 * work state — see DAY_STATUS below. The index management actually slices by is
 * the PROJECT the hour was spent on.
 */

export const DAY_STATUS = Object.freeze({
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
});
export const DAY_STATUSES = Object.freeze(toOptions(DAY_STATUS));

/**
 * DISPLAY labels. The wire values are the KEYS (see ROLE_VALUE below).
 *
 * TECH_LEAD reads 'Tech Lead / Team Lead' because the role is not specific to
 * engineering — the Digital Marketing, Social Media and Video Editing departments
 * all have one, and calling theirs a "Tech Lead" is nonsense. The stored enum
 * stays TECH_LEAD: renaming it would mean migrating every user row, every audit
 * record and every permission bundle to change a word on a screen.
 */
export const ROLE = Object.freeze({
  MANAGEMENT: 'Management',
  TECH_LEAD: 'Tech Lead / Team Lead',
  EMPLOYEE: 'Employee',
});
export const ROLES = Object.freeze(toOptions(ROLE));

export const USER_STATUS = Object.freeze({
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  LOCKED: 'Locked',
});
export const USER_STATUSES = Object.freeze(toOptions(USER_STATUS));

export const PROJECT_STATUS = Object.freeze({
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
});
export const PROJECT_STATUSES = Object.freeze(toOptions(PROJECT_STATUS));

export const EXPORT_FORMATS = Object.freeze([
  { value: 'EXCEL', label: 'Excel (.xlsx)' },
  { value: 'CSV', label: 'CSV' },
  { value: 'PDF', label: 'PDF' },
]);

/** A day in these states is read-only for its owner. */
export const LOCKED_DAY_STATUSES = Object.freeze(['SUBMITTED', 'APPROVED']);

/** Server caps pageSize at 200. */
export const PAGE_SIZE_OPTIONS = Object.freeze([10, 25, 50, 100]);
export const DEFAULT_PAGE_SIZE = 25;

export const TASK_DESCRIPTION_MIN = 3;
export const TASK_DESCRIPTION_MAX = 2000;
export const TASK_REMARKS_MAX = 1000;

/**
 * Permission strings, mirrored from backend/src/core/permissions.js.
 *
 * These drive which navigation items and buttons render. They are COSMETIC — the
 * API enforces the same rules independently, so a user who edits their bundle in
 * devtools or types a URL directly still gets a 403. Never treat a check here as
 * a security control; treat it as an affordance.
 */
export const PERMISSIONS = Object.freeze({
  PROFILE_READ: 'profile:read',
  PROFILE_UPDATE: 'profile:update',
  PASSWORD_CHANGE: 'password:change',

  TASK_READ: 'task:read',
  TASK_WRITE_OWN: 'task:write:own',
  TASK_WRITE_ANY: 'task:write:any',
  TASK_DELETE: 'task:delete',
  TASK_HISTORY_READ: 'task:history:read',
  TASK_SUBMIT: 'task:submit',
  TASK_APPROVE: 'task:approve',
  TASK_REJECT: 'task:reject',
  TASK_REMARK: 'task:remark',
  TASK_OVERRIDE_LOCK: 'task:override-lock',
  /** Append an overtime hour via the '+' at the end of the grid. Employees hold this. */
  TASK_ADD_OVERTIME: 'task:add-overtime',

  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',
  USER_DELETE: 'user:delete',
  USER_RESET_PASSWORD: 'user:reset-password',
  ROLE_ASSIGN: 'role:assign',

  TEAM_READ: 'team:read',
  TEAM_MANAGE: 'team:manage',

  PROJECT_READ: 'project:read',
  PROJECT_MANAGE: 'project:manage',

  DEPARTMENT_READ: 'department:read',
  DEPARTMENT_MANAGE: 'department:manage',

  DASHBOARD_SELF: 'dashboard:self',
  DASHBOARD_TEAM: 'dashboard:team',
  DASHBOARD_GLOBAL: 'dashboard:global',
  REPORT_EXPORT: 'report:export',
  ANALYTICS_READ: 'analytics:read',

  AUDIT_READ: 'audit:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_MANAGE: 'settings:manage',
  NOTIFICATION_READ: 'notification:read',
});

/** Field types the department-driven task form can render. */
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
 * ⚠ THE MAPS ABOVE ARE LABELS, NOT VALUES.
 *
 *     ROLE.TECH_LEAD === 'Tech Lead'      ← for DISPLAY
 *     ROLE_VALUE.TECH_LEAD === 'TECH_LEAD' ← for the WIRE
 *
 * Sending `?role=Tech Lead` to the API is a 422, and it is an easy mistake to
 * make because `ROLE.TECH_LEAD` reads exactly like the thing you want. These
 * frozen value maps exist so a query param or an equality check can never
 * accidentally reach for the human-readable string.
 *
 * Use ROLE[x] to render. Use ROLE_VALUE.X to compare or to send.
 */
const keysOf = (map) =>
  Object.freeze(Object.fromEntries(Object.keys(map).map((k) => [k, k])));

export const ROLE_VALUE = keysOf(ROLE);
export const USER_STATUS_VALUE = keysOf(USER_STATUS);
export const PROJECT_STATUS_VALUE = keysOf(PROJECT_STATUS);
export const DAY_STATUS_VALUE = keysOf(DAY_STATUS);

/** Mirrors backend PASSWORD_MIN_LENGTH. The API rejects anything shorter. */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 128;

/** Overtime hours are recorded but never required — see TimeSlot.isOvertime. */
export const OVERTIME_LABEL = 'Overtime';
