/**
 * Authentication + authorisation middleware.
 *
 * `authenticate` populates:
 *   req.user   — identity + permissions
 *   req.scope  — the AccessScope that every downstream query MUST compose in
 *
 * `authorize(...permissions)` gates by capability, never by role literal.
 */
import { prisma } from '../config/prisma.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { UnauthenticatedError, ForbiddenError } from '../core/errors.js';
import { permissionsForUser } from '../core/permissions.js';
import { resolveScope } from '../core/accessScope.js';
import { setCurrentUser } from '../core/requestContext.js';
import { USER_STATUS } from '../config/constants.js';
import { asyncHandler } from '../core/asyncHandler.js';

const bearerToken = (req) => {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
};

/**
 * Verifies the access token AND re-checks the user against the database.
 *
 * WHY hit the DB on every request instead of trusting the JWT outright?
 * Because a stateless token cannot know that the user was deactivated ninety
 * seconds ago, moved department, or was demoted from Tech Lead. In a system
 * whose entire security model is "which department may I see", a fifteen-minute
 * window of stale authorisation is not acceptable. The lookup is a single
 * primary-key hit on an indexed table — a fraction of a millisecond — and it is
 * the correct trade.
 */
export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) {
    throw new UnauthenticatedError('Authentication required', { code: 'TOKEN_MISSING' });
  }

  const payload = verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      status: true,
      departmentId: true,
      teamId: true,
      avatarPath: true,
      timezone: true,
      mustChangePassword: true,
      passwordChangedAt: true,
      department: { select: { id: true, code: true, name: true, colorHex: true } },
      ledTeams: { select: { id: true }, where: { isActive: true } },
    },
  });

  if (!user) throw new UnauthenticatedError('Account no longer exists');

  if (user.status !== USER_STATUS.ACTIVE) {
    throw new UnauthenticatedError('Your account is not active. Contact your administrator.', {
      code: 'ACCOUNT_INACTIVE',
    });
  }

  // Bounded revocation: any token minted before the last password change /
  // forced logout is dead, even though it has not expired yet.
  const pwdChangedAtSec = Math.floor(user.passwordChangedAt.getTime() / 1000);
  if (payload.pwdAt !== undefined && payload.pwdAt < pwdChangedAtSec) {
    throw new UnauthenticatedError('Your session is no longer valid. Please sign in again.', {
      code: 'TOKEN_REVOKED',
    });
  }

  const authUser = {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    departmentId: user.departmentId,
    teamId: user.teamId,
    department: user.department,
    avatarPath: user.avatarPath,
    timezone: user.timezone,
    mustChangePassword: user.mustChangePassword,
    permissions: permissionsForUser(user),
  };

  req.user = authUser;
  req.scope = resolveScope(authUser, user.ledTeams.map((t) => t.id));
  setCurrentUser(authUser);

  next();
});

/**
 * Capability gate. Pass one or more permissions; the caller needs ALL of them.
 *
 *   router.post('/:id/approve', authorize(PERMISSIONS.TASK_APPROVE), ctrl.approve)
 *
 * Note this answers "may you approve *anything*". "May you approve *this*" is
 * the AccessScope's job, enforced in the service. Both must pass.
 */
export const authorize =
  (...required) =>
  (req, _res, next) => {
    if (!req.user) return next(new UnauthenticatedError());

    const granted = new Set(req.user.permissions);
    const missing = required.filter((p) => !granted.has(p));

    if (missing.length) {
      return next(
        new ForbiddenError('You do not have permission to perform this action', {
          code: 'MISSING_PERMISSION',
          details: { required: missing },
        }),
      );
    }
    next();
  };

/** Any one of the listed permissions is sufficient. */
export const authorizeAny =
  (...allowed) =>
  (req, _res, next) => {
    if (!req.user) return next(new UnauthenticatedError());
    const granted = new Set(req.user.permissions);
    if (allowed.some((p) => granted.has(p))) return next();
    return next(
      new ForbiddenError('You do not have permission to perform this action', {
        code: 'MISSING_PERMISSION',
        details: { requiredAnyOf: allowed },
      }),
    );
  };

/**
 * Blocks the app until a forced password change is done, while still allowing
 * the endpoints needed to *perform* that change. Without this, an admin-reset
 * user can keep using their temporary password indefinitely.
 */
const PASSWORD_CHANGE_ALLOWLIST = ['/auth/change-password', '/auth/logout', '/auth/me'];

export const enforcePasswordChange = (req, _res, next) => {
  if (!req.user?.mustChangePassword) return next();
  if (PASSWORD_CHANGE_ALLOWLIST.some((p) => req.path.startsWith(p))) return next();

  return next(
    new ForbiddenError('You must change your password before continuing', {
      code: 'PASSWORD_CHANGE_REQUIRED',
    }),
  );
};
