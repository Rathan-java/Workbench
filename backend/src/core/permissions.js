/**
 * The permission system.
 *
 * THE RULE: no controller, service or repository in this codebase may ever
 * contain `if (user.role === 'MANAGEMENT')`. Role checks scattered through
 * business logic are unauditable — you cannot answer "who can approve a
 * timesheet?" without grepping the whole repo, and the day a fourth role
 * appears you touch two hundred files.
 *
 * Instead: capabilities are named, roles are bundles of capabilities, and
 * routes declare the capability they need. Answering "who can do X" is one
 * lookup in ROLE_PERMISSIONS. Adding a role is one entry in this file.
 */

/**
 * Capabilities, namespaced `resource:verb`.
 * Note these say nothing about *whose* data — that is the AccessScope's job
 * (see accessScope.js). Permission answers "may this role do this kind of
 * thing at all"; scope answers "to which rows".
 */
export const PERMISSIONS = Object.freeze({
  // --- own account ---------------------------------------------------------
  PROFILE_READ: 'profile:read',
  PROFILE_UPDATE: 'profile:update',
  PASSWORD_CHANGE: 'password:change',

  // --- tasks ---------------------------------------------------------------
  /** Read task data (scope decides whose). */
  TASK_READ: 'task:read',
  /** Create/update one's OWN entries. */
  TASK_WRITE_OWN: 'task:write:own',
  /** Create/update SOMEONE ELSE'S entries — a privileged, always-audited act. */
  TASK_WRITE_ANY: 'task:write:any',
  TASK_DELETE: 'task:delete',
  TASK_HISTORY_READ: 'task:history:read',
  TASK_SUBMIT: 'task:submit',
  TASK_APPROVE: 'task:approve',
  TASK_REJECT: 'task:reject',
  TASK_REMARK: 'task:remark',
  /** Edit a day whose approval state would normally lock it. */
  TASK_OVERRIDE_LOCK: 'task:override-lock',

  // --- organisation --------------------------------------------------------
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DEACTIVATE: 'user:deactivate',
  USER_RESET_PASSWORD: 'user:reset-password',
  /** HARD delete. Distinct from USER_DEACTIVATE because it is irreversible and
   *  destroys the person's task history — a different act, so a different key. */
  USER_DELETE: 'user:delete',
  ROLE_ASSIGN: 'role:assign',

  TEAM_READ: 'team:read',
  TEAM_MANAGE: 'team:manage',

  PROJECT_READ: 'project:read',
  PROJECT_MANAGE: 'project:manage',

  DEPARTMENT_READ: 'department:read',
  DEPARTMENT_MANAGE: 'department:manage',

  /** Append an overtime hour to the end of the grid. Employees hold this — the
   *  person who worked late is the person who knows they worked late. */
  TASK_ADD_OVERTIME: 'task:add-overtime',

  // --- assignments ---------------------------------------------------------
  /** Read assignments (scope decides whose — SELF sees only their own). */
  ASSIGNMENT_READ: 'assignment:read',
  /** Assign work to an employee. A lead/management act, always audited. */
  ASSIGNMENT_CREATE: 'assignment:create',
  /** Edit an assignment's brief (title, description, due date, priority). */
  ASSIGNMENT_UPDATE: 'assignment:update',
  /** The employee's move: mark their assigned task done and hand it back for
   *  review. Deliberately separate from CREATE/REVIEW — an employee may declare
   *  their own work finished, but may neither assign nor sign it off. */
  ASSIGNMENT_SUBMIT: 'assignment:submit',
  /** The lead's move: confirm a submitted assignment DONE, or reopen it. */
  ASSIGNMENT_REVIEW: 'assignment:review',
  /** Call off an assignment. Never deletes it — the hours logged against it and
   *  the trail of who assigned what both survive. */
  ASSIGNMENT_CANCEL: 'assignment:cancel',

  // --- insight -------------------------------------------------------------
  DASHBOARD_SELF: 'dashboard:self',
  DASHBOARD_TEAM: 'dashboard:team',
  DASHBOARD_GLOBAL: 'dashboard:global',
  REPORT_EXPORT: 'report:export',
  ANALYTICS_READ: 'analytics:read',

  // --- governance ----------------------------------------------------------
  AUDIT_READ: 'audit:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_MANAGE: 'settings:manage',
  NOTIFICATION_READ: 'notification:read',
});

const EMPLOYEE_PERMISSIONS = [
  PERMISSIONS.PROFILE_READ,
  PERMISSIONS.PROFILE_UPDATE,
  PERMISSIONS.PASSWORD_CHANGE,
  PERMISSIONS.TASK_READ,
  PERMISSIONS.TASK_WRITE_OWN,
  PERMISSIONS.TASK_HISTORY_READ,
  PERMISSIONS.TASK_SUBMIT,
  PERMISSIONS.TASK_ADD_OVERTIME,
  // An employee sees the work assigned to them and may declare it done — but the
  // assigning and the sign-off are a lead's job (added in TECH_LEAD below).
  PERMISSIONS.ASSIGNMENT_READ,
  PERMISSIONS.ASSIGNMENT_SUBMIT,
  PERMISSIONS.PROJECT_READ,
  PERMISSIONS.TEAM_READ,
  PERMISSIONS.DEPARTMENT_READ,
  PERMISSIONS.DASHBOARD_SELF,
  PERMISSIONS.NOTIFICATION_READ,
];

/**
 * A Tech Lead is an Employee (they log their own hours too — the brief says
 * "Update their own tasks") plus team oversight. Composing rather than
 * re-listing is what keeps these bundles honest as they grow.
 */
const TECH_LEAD_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  PERMISSIONS.TASK_WRITE_ANY,
  PERMISSIONS.TASK_APPROVE,
  PERMISSIONS.TASK_REJECT,
  PERMISSIONS.TASK_REMARK,
  PERMISSIONS.TASK_OVERRIDE_LOCK,
  // Assigning work, editing the brief, signing it off, and calling it off are all
  // the lead's remit — bounded to their own department by the scope engine.
  PERMISSIONS.ASSIGNMENT_CREATE,
  PERMISSIONS.ASSIGNMENT_UPDATE,
  PERMISSIONS.ASSIGNMENT_REVIEW,
  PERMISSIONS.ASSIGNMENT_CANCEL,
  PERMISSIONS.USER_READ,
  // A Tech Lead can issue a temporary password to an employee who is locked out
  // — the person is standing at their desk and cannot wait for Management. The
  // reach is not unlimited: the service runs assertCanActOn against the lead's
  // scope, so this only ever touches employees in the lead's OWN department. It
  // grants no ability to create, delete, or re-role anyone — only to hand back a
  // one-time password that forces a change at next sign-in.
  PERMISSIONS.USER_RESET_PASSWORD,
  PERMISSIONS.DASHBOARD_TEAM,
  PERMISSIONS.REPORT_EXPORT,
  PERMISSIONS.ANALYTICS_READ,
];

const MANAGEMENT_PERMISSIONS = [
  ...TECH_LEAD_PERMISSIONS,
  PERMISSIONS.TASK_DELETE,
  PERMISSIONS.USER_CREATE,
  PERMISSIONS.USER_UPDATE,
  PERMISSIONS.USER_DEACTIVATE,
  PERMISSIONS.USER_RESET_PASSWORD,
  PERMISSIONS.USER_DELETE,
  PERMISSIONS.ROLE_ASSIGN,
  PERMISSIONS.TEAM_MANAGE,
  PERMISSIONS.PROJECT_MANAGE,
  PERMISSIONS.DEPARTMENT_MANAGE,
  PERMISSIONS.DASHBOARD_GLOBAL,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.SETTINGS_READ,
  PERMISSIONS.SETTINGS_MANAGE,
];

export const ROLES = Object.freeze({
  MANAGEMENT: 'MANAGEMENT',
  TECH_LEAD: 'TECH_LEAD',
  EMPLOYEE: 'EMPLOYEE',
});

/** @type {Readonly<Record<keyof typeof ROLES, readonly string[]>>} */
export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.MANAGEMENT]: Object.freeze([...new Set(MANAGEMENT_PERMISSIONS)]),
  [ROLES.TECH_LEAD]: Object.freeze([...new Set(TECH_LEAD_PERMISSIONS)]),
  [ROLES.EMPLOYEE]: Object.freeze([...new Set(EMPLOYEE_PERMISSIONS)]),
});

/** Precomputed for O(1) checks on the hot path. */
const ROLE_PERMISSION_SETS = Object.fromEntries(
  Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => [role, new Set(perms)]),
);

/**
 * @param {string} role
 * @param {string} permission
 */
export const roleHasPermission = (role, permission) =>
  ROLE_PERMISSION_SETS[role]?.has(permission) ?? false;

/** @param {{role: string}} user */
export const permissionsForUser = (user) => ROLE_PERMISSIONS[user.role] ?? [];

/** Every permission must appear in at least one role, or it is dead code. */
export const assertPermissionsWired = () => {
  const assigned = new Set(Object.values(ROLE_PERMISSIONS).flat());
  const orphans = Object.values(PERMISSIONS).filter((p) => !assigned.has(p));
  if (orphans.length) {
    throw new Error(`Permissions declared but assigned to no role: ${orphans.join(', ')}`);
  }
};
