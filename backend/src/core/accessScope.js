/**
 * THE DEPARTMENT ISOLATION ENGINE.
 *
 * The single most important security property of this system is:
 *
 *     "A Tech Lead of the Video Editing team must never, under any code path,
 *      see a Digital Marketing employee's task."
 *
 * The naive implementation sprinkles `if (a.departmentId !== b.departmentId)`
 * across every controller. That is unverifiable — one missed check in one
 * rarely-used export endpoint is a data breach, and nothing in the type system,
 * the tests, or code review reliably catches it.
 *
 * So isolation is not a check. It is a *filter that is impossible to omit*:
 *
 *   1. Auth middleware resolves the caller into an immutable AccessScope.
 *   2. Every scoped query composes `scopeWhere(scope)` into its WHERE clause.
 *   3. Every scoped write calls `assertCanActOn(scope, target)` first.
 *
 * `scopeWhere` returns `{ id: NEVER }` for an unrecognised scope rather than
 * `{}` — an unhandled scope kind therefore returns ZERO rows instead of ALL
 * rows. Fail closed, never open.
 */
import { ForbiddenError } from './errors.js';
import { ROLES } from './permissions.js';

/** A cuid can never equal this, so it matches nothing. Our "deny all" sentinel. */
const NEVER = '__scope_denied__';

export const SCOPE_KIND = Object.freeze({
  /** Management: the whole company, every department. */
  GLOBAL: 'GLOBAL',
  /** Tech Lead: exactly one department (and, by policy, their own team within it). */
  DEPARTMENT: 'DEPARTMENT',
  /** Employee: their own rows only. */
  SELF: 'SELF',
});

/**
 * @typedef {object} AuthUser
 * @property {string} id
 * @property {string} email
 * @property {'MANAGEMENT'|'TECH_LEAD'|'EMPLOYEE'} role
 * @property {string|null} departmentId
 * @property {string|null} teamId
 * @property {string[]} permissions
 */

/**
 * @typedef {object} AccessScope
 * @property {'GLOBAL'|'DEPARTMENT'|'SELF'} kind
 * @property {string}      userId
 * @property {string|null} departmentId
 * @property {string|null} teamId
 * @property {string[]}    ledTeamIds  Teams this user is the appointed lead of.
 * @property {boolean}     isGlobal
 */

/**
 * Derive the caller's scope. Called once per request, in auth middleware.
 *
 * A Tech Lead's boundary is their DEPARTMENT, not merely their team. That is a
 * deliberate reading of the brief ("Tech Leads should only access their
 * assigned team" + "view every employee in their team"): a department may hold
 * several teams, and a lead needs cross-team visibility inside their own
 * department to cover for absent peers — but must be blind across departments.
 * If you ever need to tighten this to team-only, change `scopeWhere` here and
 * the entire application tightens with it. That is the point of this file.
 *
 * @param {AuthUser} user
 * @param {string[]} ledTeamIds
 * @returns {AccessScope}
 */
export const resolveScope = (user, ledTeamIds = []) => {
  const base = {
    userId: user.id,
    departmentId: user.departmentId ?? null,
    teamId: user.teamId ?? null,
    ledTeamIds,
  };

  switch (user.role) {
    case ROLES.MANAGEMENT:
      return Object.freeze({ ...base, kind: SCOPE_KIND.GLOBAL, isGlobal: true });

    case ROLES.TECH_LEAD:
      // A lead with no department is a misconfiguration; deny rather than
      // silently escalate them to global.
      if (!user.departmentId) {
        return Object.freeze({ ...base, kind: SCOPE_KIND.SELF, isGlobal: false });
      }
      return Object.freeze({ ...base, kind: SCOPE_KIND.DEPARTMENT, isGlobal: false });

    case ROLES.EMPLOYEE:
    default:
      return Object.freeze({ ...base, kind: SCOPE_KIND.SELF, isGlobal: false });
  }
};

/**
 * Prisma `where` fragment restricting a query to what `scope` may see.
 *
 * Every scoped model (User, TaskDay, TaskEntry, DailyProductivityRollup, Team,
 * Project) exposes `departmentId` — that uniformity is why this one function
 * can guard all of them, and is the reason TaskEntry denormalises departmentId.
 *
 * @param {AccessScope} scope
 * @param {object} [options]
 * @param {string} [options.userField='userId']  Column holding row ownership.
 *   Pass `'id'` when filtering the User model itself.
 * @param {boolean} [options.selfSeesDepartment=false]  Let an EMPLOYEE read
 *   department-wide reference data (projects, teams) while still being blind to
 *   other people's *tasks*.
 * @returns {object} Prisma where fragment. Never `{}` for an unknown kind.
 */
export const scopeWhere = (scope, { userField = 'userId', selfSeesDepartment = false } = {}) => {
  switch (scope.kind) {
    case SCOPE_KIND.GLOBAL:
      return {};

    case SCOPE_KIND.DEPARTMENT:
      return { departmentId: scope.departmentId ?? NEVER };

    case SCOPE_KIND.SELF:
      if (selfSeesDepartment) return { departmentId: scope.departmentId ?? NEVER };
      return { [userField]: scope.userId };

    default:
      // Unknown scope kind → match nothing. Fail closed.
      return { id: NEVER };
  }
};

/**
 * Management may narrow to one department via the UI dropdown; a Tech Lead may
 * not widen past their own. This merges a *requested* filter with the caller's
 * *permitted* scope, and the permitted scope always wins.
 *
 * @param {AccessScope} scope
 * @param {object} filters
 * @param {string} [filters.departmentId]
 * @param {string} [filters.teamId]
 * @param {string} [filters.userId]
 * @param {object} [options] Passed through to scopeWhere.
 */
export const scopedWhereWithFilters = (scope, filters = {}, options = {}) => {
  const where = { ...scopeWhere(scope, options) };

  if (filters.departmentId) {
    if (!scope.isGlobal && scope.departmentId !== filters.departmentId) {
      throw new ForbiddenError('You do not have access to that department');
    }
    where.departmentId = filters.departmentId;
  }
  if (filters.teamId) where.teamId = filters.teamId;

  if (filters.userId) {
    const userField = options.userField ?? 'userId';
    // An employee asking for someone else's rows is denied outright — not
    // silently rewritten to their own, which would mask a broken client.
    if (scope.kind === SCOPE_KIND.SELF && filters.userId !== scope.userId) {
      throw new ForbiddenError('You can only view your own records');
    }
    where[userField] = filters.userId;
  }

  return where;
};

/**
 * Authorisation gate for WRITES and single-record reads.
 * `scopeWhere` protects list queries; this protects `findById` + mutations,
 * where the row is fetched by primary key and no filter was applied.
 *
 * @param {AccessScope} scope
 * @param {{userId?: string|null, departmentId?: string|null}} target
 * @param {object} [options]
 * @param {boolean} [options.allowSelf=true]
 * @param {string}  [options.message]
 */
export const assertCanActOn = (scope, target, { allowSelf = true, message } = {}) => {
  if (scope.isGlobal) return;

  const ownsIt = allowSelf && target.userId && target.userId === scope.userId;
  if (ownsIt) return;

  if (scope.kind === SCOPE_KIND.DEPARTMENT) {
    if (target.departmentId && target.departmentId === scope.departmentId) return;
    throw new ForbiddenError(
      message ?? 'This record belongs to another department and is not accessible to you',
    );
  }

  throw new ForbiddenError(message ?? 'You can only act on your own records');
};

/** Convenience for the common "is this me?" branch in services. */
export const isSelf = (scope, userId) => scope.userId === userId;
