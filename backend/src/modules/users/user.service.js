/**
 * User administration.
 *
 * Every mutation here is a privilege-relevant act, so every mutation:
 *   1. re-checks the caller's scope against the TARGET (not just the route),
 *   2. runs inside a transaction with its audit row, and
 *   3. blocks the handful of moves that would corrupt the security model —
 *      self-demotion, deactivating the last Management account, moving a Tech
 *      Lead out of the department whose team they still lead.
 *
 * These guards are the difference between an admin screen and a footgun.
 */
import { prisma } from '../../config/prisma.js';
import * as repo from './user.repository.js';
import { toUserDto, toUserOptionDto, USER_SELECT } from './user.dto.js';
import { fullName } from '../../utils/name.js';
import {
  NotFoundError,
  ConflictError,
  ForbiddenError,
  BadRequestError,
} from '../../core/errors.js';
import { assertCanActOn } from '../../core/accessScope.js';
import { hashPassword, generateOpaqueToken } from '../../utils/crypto.js';
import { ROLE, USER_STATUS } from '../../config/constants.js';
import * as audit from '../audit/audit.service.js';
import { sendMailSafe } from '../../config/mailer.js';
import { welcomeEmail } from '../notifications/email.templates.js';
import { logger } from '../../config/logger.js';

/**
 * A temporary password that satisfies the policy without a human inventing one.
 * base64url alone can miss a required class, so we append one of each.
 */
const generateTemporaryPassword = () =>
  `${generateOpaqueToken(9)}Aa1!`.slice(0, 20);

export const list = async (scope, query) => {
  const { items, total, page, pageSize } = await repo.findMany(scope, query);
  return { items: items.map(toUserDto), total, page, pageSize };
};

export const options = async (scope, filters) => {
  const users = await repo.findOptions(scope, filters);
  return users.map(toUserOptionDto);
};

export const getById = async (scope, id) => {
  const user = await repo.findById(id);
  if (!user) throw new NotFoundError('User');

  // `userId: user.id` so a person can always read their own record even when
  // their department differs (e.g. a Management account viewing itself).
  assertCanActOn(scope, { userId: user.id, departmentId: user.departmentId });

  return toUserDto(user);
};

/**
 * Guard: a Tech Lead may never create or edit a user outside their department,
 * and may never mint another Management account.
 * (Today only Management holds USER_CREATE, so this is defence in depth — the
 * kind that saves you when someone widens a permission bundle in two years.)
 */
const assertMayAssignRole = (scope, role) => {
  if (role === ROLE.MANAGEMENT && !scope.isGlobal) {
    throw new ForbiddenError('Only Management can create or promote Management accounts');
  }
};

const assertMayTargetDepartment = (scope, departmentId) => {
  if (scope.isGlobal) return;
  if (!departmentId || departmentId !== scope.departmentId) {
    throw new ForbiddenError('You can only manage users within your own department');
  }
};

export const create = async (scope, input, actor) => {
  assertMayAssignRole(scope, input.role);
  if (input.role !== ROLE.MANAGEMENT) assertMayTargetDepartment(scope, input.departmentId);

  const [emailTaken, codeTaken] = await Promise.all([
    repo.findByEmail(input.email),
    repo.findByEmployeeCode(input.employeeCode),
  ]);
  if (emailTaken) throw new ConflictError('A user with that email already exists', { code: 'EMAIL_TAKEN' });
  if (codeTaken) {
    throw new ConflictError('A user with that employee code already exists', {
      code: 'EMPLOYEE_CODE_TAKEN',
    });
  }

  // A team must live in the same department as the user placed into it, or the
  // whole isolation model develops a hole.
  if (input.teamId) await assertTeamMatchesDepartment(input.teamId, input.departmentId);

  const temporaryPassword = input.password ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        employeeCode: input.employeeCode,
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone || null,
        designation: input.designation || null,
        role: input.role,
        departmentId: input.role === ROLE.MANAGEMENT ? null : input.departmentId,
        teamId: input.role === ROLE.MANAGEMENT ? null : (input.teamId ?? null),
        timezone: input.timezone ?? undefined,
        // Always true: the creating admin knows the temporary password, so it is
        // a shared secret until the user replaces it.
        mustChangePassword: true,
        createdById: actor.id,
      },
      select: USER_SELECT,
    });

    await audit.recordInTransaction(tx, {
      action: 'USER_CREATED',
      entityType: 'User',
      entityId: createdUser.id,
      departmentId: createdUser.departmentId,
      summary: `Created ${createdUser.role} account for ${createdUser.email}`,
      after: {
        email: createdUser.email,
        role: createdUser.role,
        departmentId: createdUser.departmentId,
        teamId: createdUser.teamId,
      },
    });

    return createdUser;
  });

  if (input.sendWelcomeEmail) {
    sendMailSafe({
      to: user.email,
      ...welcomeEmail({
        firstName: user.firstName,
        email: user.email,
        temporaryPassword,
        departmentName: user.department?.name,
        role: user.role,
      }),
    });
  }

  logger.info('User created', { userId: user.id, role: user.role, by: actor.id });

  return {
    user: toUserDto(user),
    // Returned exactly once, so an admin creating an account offline can hand
    // the password over. Never stored, never logged, never retrievable again.
    temporaryPassword: input.password ? undefined : temporaryPassword,
  };
};

const assertTeamMatchesDepartment = async (teamId, departmentId) => {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, departmentId: true, name: true },
  });
  if (!team) throw new NotFoundError('Team');
  if (team.departmentId !== departmentId) {
    throw new BadRequestError(
      `Team "${team.name}" belongs to a different department than the one selected`,
      { code: 'TEAM_DEPARTMENT_MISMATCH' },
    );
  }
};

export const update = async (scope, id, input, actor) => {
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('User');

  assertCanActOn(scope, { userId: before.id, departmentId: before.departmentId });
  if (input.role) assertMayAssignRole(scope, input.role);

  const nextRole = input.role ?? before.role;
  const nextDepartmentId =
    nextRole === ROLE.MANAGEMENT
      ? null
      : input.departmentId !== undefined
        ? input.departmentId
        : before.departmentId;

  if (nextRole !== ROLE.MANAGEMENT) assertMayTargetDepartment(scope, nextDepartmentId);

  const nextTeamId =
    nextRole === ROLE.MANAGEMENT ? null : input.teamId !== undefined ? input.teamId : before.teamId;

  if (nextTeamId) await assertTeamMatchesDepartment(nextTeamId, nextDepartmentId);

  // --- integrity guards ----------------------------------------------------

  // Locking yourself out of your own admin console is a support ticket nobody
  // enjoys. Role and status changes to self are simply not permitted.
  if (before.id === actor.id && input.role && input.role !== before.role) {
    throw new BadRequestError('You cannot change your own role', { code: 'SELF_ROLE_CHANGE' });
  }
  if (before.id === actor.id && input.status && input.status !== before.status) {
    throw new BadRequestError('You cannot change your own account status', {
      code: 'SELF_STATUS_CHANGE',
    });
  }

  // Demoting the last Management account bricks the installation.
  if (before.role === ROLE.MANAGEMENT && nextRole !== ROLE.MANAGEMENT) {
    await assertNotLastManagement(before.id);
  }

  // A Tech Lead who still leads a team cannot be moved out of its department —
  // that would leave a team led by someone who cannot see it.
  if (before.role === ROLE.TECH_LEAD && nextDepartmentId !== before.departmentId) {
    const led = await prisma.team.count({ where: { leadId: before.id, isActive: true } });
    if (led > 0) {
      throw new ConflictError(
        'This user still leads a team in their current department. Reassign the team lead first.',
        { code: 'STILL_LEADS_TEAM' },
      );
    }
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        employeeCode: input.employeeCode,
        phone: input.phone !== undefined ? input.phone || null : undefined,
        designation: input.designation !== undefined ? input.designation || null : undefined,
        timezone: input.timezone,
        role: input.role,
        status: input.status,
        departmentId: input.departmentId !== undefined || input.role ? nextDepartmentId : undefined,
        teamId: input.teamId !== undefined || input.role ? nextTeamId : undefined,
        ...(input.status === USER_STATUS.ACTIVE ? { deactivatedAt: null } : {}),
      },
      select: USER_SELECT,
    });

    const { before: b, after: a } = audit.diff(before, updated);

    // A role change is its own audit event. Filtering the audit log for "who
    // was promoted last quarter" must not require scanning generic updates.
    if (input.role && input.role !== before.role) {
      await audit.recordInTransaction(tx, {
        action: 'ROLE_CHANGED',
        entityType: 'User',
        entityId: id,
        departmentId: updated.departmentId,
        summary: `Role changed from ${before.role} to ${updated.role} for ${updated.email}`,
        before: { role: before.role },
        after: { role: updated.role },
      });
    }

    if (Object.keys(a).length) {
      await audit.recordInTransaction(tx, {
        action: 'USER_UPDATED',
        entityType: 'User',
        entityId: id,
        departmentId: updated.departmentId,
        summary: `Updated account for ${updated.email}`,
        before: b,
        after: a,
      });
    }

    // Any change to role/department/status invalidates what the user's live
    // access token claims. Force a re-auth rather than let them run for another
    // 15 minutes with stale authorisation.
    const securityRelevant =
      (input.role && input.role !== before.role) ||
      nextDepartmentId !== before.departmentId ||
      (input.status && input.status !== before.status);

    if (securityRelevant) {
      await tx.user.update({ where: { id }, data: { passwordChangedAt: new Date() } });
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return updated;
  });

  return toUserDto(user);
};

const assertNotLastManagement = async (excludingId) => {
  const remaining = await prisma.user.count({
    where: { role: ROLE.MANAGEMENT, status: USER_STATUS.ACTIVE, id: { not: excludingId } },
  });
  if (remaining === 0) {
    throw new ConflictError(
      'This is the last active Management account. Create another before changing this one.',
      { code: 'LAST_MANAGEMENT_ACCOUNT' },
    );
  }
};

/**
 * Deactivate — never delete.
 *
 * A hard DELETE would cascade into (or orphan) months of task history and every
 * audit row that references the actor. "Who logged this task?" must remain
 * answerable in three years, for someone who left the company two years ago.
 */
export const deactivate = async (scope, id, { reason }, actor) => {
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('User');

  assertCanActOn(scope, { userId: before.id, departmentId: before.departmentId });

  if (before.id === actor.id) {
    throw new BadRequestError('You cannot deactivate your own account', {
      code: 'SELF_DEACTIVATION',
    });
  }
  if (before.status === USER_STATUS.INACTIVE) {
    throw new ConflictError('This account is already deactivated');
  }
  if (before.role === ROLE.MANAGEMENT) await assertNotLastManagement(id);

  // A departing lead does NOT block here. People give notice and leave before a
  // replacement is hired — a month of limbo is normal — so refusing to deactivate
  // them until a new lead exists would force the admin to either keep a gone
  // employee's account live or invent a placeholder lead. Instead we VACATE the
  // seat: the team runs leaderless until someone is appointed. That is safe now —
  // any other lead in the department can still approve, Management always can, and
  // an unreviewed sheet auto-approves after the configured window.
  const ledTeams = await prisma.team.findMany({
    where: { leadId: id, isActive: true },
    select: { id: true, name: true },
  });

  const user = await prisma.$transaction(async (tx) => {
    if (ledTeams.length) {
      await tx.team.updateMany({ where: { leadId: id }, data: { leadId: null } });
    }

    const updated = await tx.user.update({
      where: { id },
      data: {
        status: USER_STATUS.INACTIVE,
        deactivatedAt: new Date(),
        // Kills access tokens (via jwt.js pwdAt) …
        passwordChangedAt: new Date(),
      },
      select: USER_SELECT,
    });

    // … and refresh tokens. A deactivated user is signed out within seconds,
    // not within fifteen minutes.
    await tx.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const vacated = ledTeams.length
      ? ` Vacated the lead seat on: ${ledTeams.map((t) => t.name).join(', ')} — assign a new lead when appointed.`
      : '';

    await audit.recordInTransaction(tx, {
      action: 'USER_DEACTIVATED',
      entityType: 'User',
      entityId: id,
      departmentId: updated.departmentId,
      summary: `Deactivated ${updated.email}. Reason: ${reason}.${vacated}`,
      before: { status: before.status },
      after: { status: updated.status, reason, vacatedTeams: ledTeams.map((t) => t.id) },
    });

    return updated;
  });

  logger.info('User deactivated', {
    userId: id,
    by: actor.id,
    vacatedTeams: ledTeams.map((t) => t.id),
  });
  return {
    ...toUserDto(user),
    // Surfaced so the UI can tell the admin which teams now need a new lead.
    vacatedTeams: ledTeams,
  };
};

export const reactivate = async (scope, id) => {
  const before = await repo.findById(id);
  if (!before) throw new NotFoundError('User');
  assertCanActOn(scope, { userId: before.id, departmentId: before.departmentId });

  if (before.status === USER_STATUS.ACTIVE) {
    throw new ConflictError('This account is already active');
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: {
        status: USER_STATUS.ACTIVE,
        deactivatedAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
      select: USER_SELECT,
    });
    await audit.recordInTransaction(tx, {
      action: 'USER_REACTIVATED',
      entityType: 'User',
      entityId: id,
      departmentId: updated.departmentId,
      summary: `Reactivated ${updated.email}`,
    });
    return updated;
  });

  return toUserDto(user);
};

/**
 * PERMANENTLY DELETE a user — WITHOUT destroying their work.
 *
 * ── THE WORK OUTLIVES THE PERSON ────────────────────────────────────────────
 * This removes the ACCOUNT. It does not remove the RECORD OF WHAT WAS DONE.
 *
 * Every hour they logged stays exactly where it was. The timesheets are the
 * company's record of a project that shipped, a client that was billed, an
 * incident that cost somebody an evening — and none of that stops being true
 * because the person has left. A cascade here (which is what this used to be)
 * meant deleting one employee silently erased months of delivery history, and
 * every report covering that period quietly stopped adding up. Nobody would
 * notice for a quarter.
 *
 * So on delete we STAMP the person's identity onto their work first — name and
 * employee code, in plain text — and only then remove the account. The foreign
 * key nulls out; the row, and the name on it, remain forever.
 *
 * WHAT SURVIVES:
 *   ✓ Every task entry and task day they ever logged, still attributable to them
 *     by name, still in every report and export.
 *   ✓ Every revision they made and every approval they gave (`actorName`).
 *   ✓ Every audit row they caused (`actorEmail`, `actorRole`).
 *   ✓ Their historical productivity rollups.
 *   ✓ Work they touched but did not own — a colleague's entry they corrected.
 *
 * WHAT IS REMOVED:
 *   ✗ The account itself: their login, sessions, password, notifications.
 *     Personal, not corporate. Nothing of record value.
 *
 * DEACTIVATE still exists and is still usually the right call — it keeps them
 * listed, and a listed former employee is easier to reason about than a name
 * with no row behind it. DELETE is for a test account, a record created in
 * error, or an erasure request.
 */
export const destroy = async (scope, id, actor) => {
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      role: true,
      departmentId: true,
      _count: { select: { taskEntries: true, taskDays: true } },
    },
  });
  if (!target) throw new NotFoundError('User');

  assertCanActOn(scope, { userId: target.id, departmentId: target.departmentId });

  if (target.id === actor.id) {
    throw new BadRequestError('You cannot delete your own account', { code: 'SELF_DELETE' });
  }
  if (target.role === ROLE.MANAGEMENT) await assertNotLastManagement(id);

  // Leading a team no longer blocks deletion. Team.lead is onDelete: SetNull, so
  // the lead seat simply empties when the account goes — the team runs leaderless
  // until a new lead is appointed, which is a normal state during a handover. We
  // still fetch the names so the audit trail records exactly which teams were left
  // without a lead by this deletion.
  const ledTeams = await prisma.team.findMany({
    where: { leadId: id },
    select: { id: true, name: true },
  });

  const displayName = fullName(target);
  const preserved = target._count;

  await prisma.$transaction(async (tx) => {
    // The audit row is written FIRST, inside the same transaction. Written after
    // the delete, a crash in between would remove the account and leave no trace
    // it ever existed — the one outcome a compliance officer will never accept.
    await audit.recordInTransaction(tx, {
      action: 'USER_DELETED',
      entityType: 'User',
      entityId: id,
      departmentId: target.departmentId,
      summary: `Deleted the account for ${target.email} (${displayName}). Their ${preserved.taskEntries} task entries across ${preserved.taskDays} days were PRESERVED and remain attributed to them by name.${ledTeams.length ? ` Left without a lead: ${ledTeams.map((t) => t.name).join(', ')}.` : ''}`,
      before: {
        email: target.email,
        fullName: displayName,
        employeeCode: target.employeeCode,
        role: target.role,
        departmentId: target.departmentId,
        preservedTaskEntries: preserved.taskEntries,
        preservedTaskDays: preserved.taskDays,
        vacatedTeams: ledTeams.map((t) => t.id),
      },
    });

    // ── STAMP THE IDENTITY ONTO THE WORK, BEFORE THE FK NULLS IT OUT ────────
    // Order matters. After `user.delete()` the FK is already NULL and there is no
    // way left to find which rows were theirs. This is the only moment we can.
    await tx.taskDay.updateMany({
      where: { userId: id },
      data: { employeeName: displayName, employeeCode: target.employeeCode },
    });
    await tx.taskEntry.updateMany({
      where: { userId: id },
      data: { employeeName: displayName, employeeCode: target.employeeCode },
    });
    await tx.dailyProductivityRollup.updateMany({
      where: { userId: id },
      data: { employeeName: displayName },
    });

    // The same for history rows where they were the ACTOR rather than the owner.
    await tx.taskEntryRevision.updateMany({
      where: { actorId: id },
      data: { actorName: displayName },
    });
    await tx.taskDayTransition.updateMany({
      where: { actorId: id },
      data: { actorName: displayName },
    });

    // Now the account goes. The FKs above SET NULL; the rows, and the names on
    // them, remain. Only genuinely personal data cascades away with the account:
    // sessions, refresh tokens, OTPs, notifications.
    await tx.user.delete({ where: { id } });
  });

  logger.warn('User account deleted; their work was preserved', {
    userId: id,
    email: target.email,
    preservedEntries: preserved.taskEntries,
    by: actor.id,
  });

  return {
    id,
    deleted: true,
    message: `${displayName}'s account has been deleted. Their ${preserved.taskEntries} task ${preserved.taskEntries === 1 ? 'entry' : 'entries'} were preserved and remain attributed to them by name in every report.`,
    preserved,
  };
};

/**
 * What a delete would actually do. The UI calls this BEFORE the confirmation, so
 * the admin sees the truth rather than a generic "are you sure?".
 */
export const previewDelete = async (scope, id) => {
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      departmentId: true,
      _count: { select: { taskEntries: true, taskDays: true, ledTeams: true } },
    },
  });
  if (!target) throw new NotFoundError('User');
  assertCanActOn(scope, { userId: target.id, departmentId: target.departmentId });

  const entries = target._count.taskEntries;

  return {
    userId: id,
    fullName: fullName(target),
    email: target.email,

    /** Work that SURVIVES the delete. It is the company's record, not theirs. */
    willPreserve: {
      taskEntries: entries,
      taskDays: target._count.taskDays,
    },

    /** What is actually removed: the account, and nothing of record value. */
    willRemove: ['Their login and password', 'Their active sessions', 'Their notifications'],

    // Leading a team is NOT a blocker any more — it is a heads-up. The team is
    // left without a lead (a normal handover state), not orphaned, and the admin
    // assigns a replacement whenever one is appointed.
    blockers: [],
    warnings:
      target._count.ledTeams > 0
        ? [
            `This person leads ${target._count.ledTeams} ${target._count.ledTeams === 1 ? 'team' : 'teams'}. ${target._count.ledTeams === 1 ? 'It' : 'They'} will be left without a lead until you appoint a new one.`,
          ]
        : [],

    recommendation:
      entries > 0
        ? `Their ${entries} logged ${entries === 1 ? 'hour' : 'hours'} will be KEPT and stay attributed to them by name — deleting the account does not erase the work. Deactivating instead keeps them listed as a former employee, which is usually easier to reason about later.`
        : 'This person has logged no work. Nothing will be lost either way.',
  };
};

/**
 * Admin-driven password reset.
 * Returns the temporary password to the ADMIN exactly once (for the case where
 * the user has lost mailbox access entirely) and forces a change on next login.
 */
export const resetPassword = async (scope, id, { newPassword, requireChange, notifyUser }, actor) => {
  const target = await repo.findById(id);
  if (!target) throw new NotFoundError('User');
  assertCanActOn(scope, { userId: target.id, departmentId: target.departmentId });

  // Department scope (a Tech Lead) may reset EMPLOYEES only. assertCanActOn keeps
  // a lead inside their own department, but "same department" still includes a
  // peer Tech Lead — and handing one lead the power to issue another lead a
  // password is a lateral takeover, not a helpdesk favour. Management (global
  // scope) is unrestricted; a lead's reach stops at the employees they manage.
  if (!scope.isGlobal && target.role !== ROLE.EMPLOYEE) {
    throw new ForbiddenError('A Team Lead can reset the password of an employee, not of another lead or management.');
  }

  const temporaryPassword = newPassword ?? generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        mustChangePassword: requireChange,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await tx.refreshToken.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.passwordResetOtp.updateMany({
      where: { userId: id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await audit.recordInTransaction(tx, {
      action: 'PASSWORD_RESET_BY_ADMIN',
      entityType: 'User',
      entityId: id,
      departmentId: target.departmentId,
      summary: `Password reset for ${target.email} by ${actor.email}. All sessions revoked.`,
    });
  });

  if (notifyUser) {
    sendMailSafe({
      to: target.email,
      ...welcomeEmail({
        firstName: target.firstName,
        email: target.email,
        temporaryPassword,
        departmentName: target.department?.name,
        role: target.role,
      }),
    });
  }

  return {
    message: `Password reset for ${target.email}. All of their sessions have been revoked.`,
    temporaryPassword,
  };
};
