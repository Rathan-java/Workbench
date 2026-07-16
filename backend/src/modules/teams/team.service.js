/**
 * Teams.
 *
 * A team lives inside exactly one department, and its lead must be a TECH_LEAD
 * from that same department. That single invariant — enforced here, in one place
 * — is what guarantees a Video Editing lead can never end up with read access to
 * a Digital Marketing team.
 */
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { scopedWhereWithFilters, assertCanActOn } from '../../core/accessScope.js';
import { and, buildOrderBy, buildSearchFilter, toPrismaPage } from '../../core/pagination.js';
import { NotFoundError, BadRequestError, ConflictError } from '../../core/errors.js';
import { ROLE, USER_STATUS } from '../../config/constants.js';
import * as audit from '../audit/audit.service.js';
import { fullName } from '../../utils/name.js';

const TEAM_SELECT = {
  id: true,
  name: true,
  code: true,
  description: true,
  isActive: true,
  departmentId: true,
  leadId: true,
  createdAt: true,
  department: { select: { id: true, code: true, name: true, colorHex: true } },
  lead: {
    select: { id: true, firstName: true, lastName: true, email: true, avatarPath: true },
  },
  _count: { select: { members: true } },
};

const toDto = ({ _count, lead, ...team }) => ({
  ...team,
  lead: lead
    ? { ...lead, fullName: fullName(lead) }
    : null,
  memberCount: _count.members,
});

const SORTABLE = ['name', 'code', 'createdAt', 'isActive'];
const SEARCHABLE = ['name', 'code', 'description'];

export const list = async (scope, query) => {
  const { skip, take, page, pageSize } = toPrismaPage(query);

  const where = and(
    // Teams are reference data: an employee may see the teams in their own
    // department (to know who their lead is) even though they cannot see other
    // people's tasks.
    scopedWhereWithFilters(scope, { departmentId: query.departmentId }, { selfSeesDepartment: true }),
    buildSearchFilter(query.search, SEARCHABLE),
    query.isActive !== undefined ? { isActive: query.isActive } : undefined,
    query.leadId ? { leadId: query.leadId } : undefined,
  );

  const [items, total] = await prisma.$transaction([
    prisma.team.findMany({
      where,
      select: TEAM_SELECT,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, { name: 'asc' }),
      skip,
      take,
    }),
    prisma.team.count({ where }),
  ]);

  return { items: items.map(toDto), total, page, pageSize };
};

export const options = async (scope, { departmentId } = {}) => {
  const teams = await prisma.team.findMany({
    where: and(
      scopedWhereWithFilters(scope, { departmentId }, { selfSeesDepartment: true }),
      { isActive: true },
    ),
    select: { id: true, name: true, code: true, departmentId: true },
    orderBy: { name: 'asc' },
  });
  return teams;
};

export const getById = async (scope, id) => {
  const team = await prisma.team.findUnique({
    where: { id },
    select: {
      ...TEAM_SELECT,
      members: {
        where: { status: USER_STATUS.ACTIVE },
        select: {
          id: true,
          employeeCode: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          designation: true,
          avatarPath: true,
        },
        orderBy: { firstName: 'asc' },
      },
    },
  });
  if (!team) throw new NotFoundError('Team');

  assertCanActOn(scope, { departmentId: team.departmentId }, { allowSelf: false });

  const { members, ...rest } = team;
  return {
    ...toDto(rest),
    members: members.map((m) => ({ ...m, fullName: fullName(m) })),
  };
};

/** The lead must be an active TECH_LEAD in this exact department. Non-negotiable. */
const assertValidLead = async (leadId, departmentId) => {
  if (!leadId) return;

  const lead = await prisma.user.findUnique({
    where: { id: leadId },
    select: { id: true, role: true, departmentId: true, status: true, firstName: true, lastName: true },
  });

  if (!lead) throw new NotFoundError('The selected team lead');
  if (lead.status !== USER_STATUS.ACTIVE) {
    throw new BadRequestError('The selected team lead is not an active user');
  }
  if (lead.role !== ROLE.TECH_LEAD) {
    throw new BadRequestError(
      `${fullName(lead)} is not a Tech Lead. Change their role first.`,
      { code: 'LEAD_ROLE_INVALID' },
    );
  }
  if (lead.departmentId !== departmentId) {
    throw new BadRequestError(
      'A team lead must belong to the same department as the team they lead',
      { code: 'LEAD_DEPARTMENT_MISMATCH' },
    );
  }
};

export const create = async (scope, input) => {
  if (!scope.isGlobal && input.departmentId !== scope.departmentId) {
    throw new BadRequestError('You can only create teams within your own department');
  }
  await assertValidLead(input.leadId, input.departmentId);

  const team = await prisma.$transaction(async (tx) => {
    const createdTeam = await tx.team.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description || null,
        departmentId: input.departmentId,
        leadId: input.leadId ?? null,
      },
      select: TEAM_SELECT,
    });

    await audit.recordInTransaction(tx, {
      action: 'TEAM_CREATED',
      entityType: 'Team',
      entityId: createdTeam.id,
      departmentId: createdTeam.departmentId,
      summary: `Created team "${createdTeam.name}" in ${createdTeam.department.name}`,
      after: { name: createdTeam.name, code: createdTeam.code, leadId: createdTeam.leadId },
    });

    return createdTeam;
  });

  return toDto(team);
};

export const update = async (scope, id, input) => {
  const before = await prisma.team.findUnique({ where: { id }, select: TEAM_SELECT });
  if (!before) throw new NotFoundError('Team');
  assertCanActOn(scope, { departmentId: before.departmentId }, { allowSelf: false });

  // Moving a team between departments would strand its members and its history
  // on the wrong side of the isolation boundary. Not supported, by design.
  if (input.departmentId && input.departmentId !== before.departmentId) {
    throw new BadRequestError(
      'A team cannot be moved to another department. Create a new team and reassign its members.',
      { code: 'TEAM_DEPARTMENT_IMMUTABLE' },
    );
  }

  if (input.leadId !== undefined) await assertValidLead(input.leadId, before.departmentId);

  const team = await prisma.$transaction(async (tx) => {
    const updated = await tx.team.update({
      where: { id },
      data: {
        name: input.name,
        code: input.code,
        description: input.description !== undefined ? input.description || null : undefined,
        leadId: input.leadId,
        isActive: input.isActive,
      },
      select: TEAM_SELECT,
    });

    const { before: b, after: a } = audit.diff(before, updated);

    if (input.leadId !== undefined && input.leadId !== before.leadId) {
      await audit.recordInTransaction(tx, {
        action: 'TEAM_LEAD_ASSIGNED',
        entityType: 'Team',
        entityId: id,
        departmentId: updated.departmentId,
        summary: updated.lead
          ? `${fullName(updated.lead)} assigned as lead of "${updated.name}"`
          : `Team lead removed from "${updated.name}"`,
        before: { leadId: before.leadId },
        after: { leadId: updated.leadId },
      });
    }

    if (Object.keys(a).length) {
      await audit.recordInTransaction(tx, {
        action: 'TEAM_UPDATED',
        entityType: 'Team',
        entityId: id,
        departmentId: updated.departmentId,
        summary: `Team "${updated.name}" updated`,
        before: b,
        after: a,
      });
    }

    return updated;
  });

  return toDto(team);
};

/** Bulk-assign employees to a team. Validates every member's department first. */
export const assignMembers = async (scope, id, { userIds }) => {
  const team = await prisma.team.findUnique({
    where: { id },
    select: { id: true, name: true, departmentId: true, isActive: true },
  });
  if (!team) throw new NotFoundError('Team');
  assertCanActOn(scope, { departmentId: team.departmentId }, { allowSelf: false });

  if (!team.isActive) {
    throw new ConflictError('Cannot assign members to an inactive team');
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, departmentId: true, role: true, firstName: true, lastName: true },
  });

  if (users.length !== userIds.length) throw new NotFoundError('One or more of the selected users');

  const wrongDepartment = users.filter((u) => u.departmentId !== team.departmentId);
  if (wrongDepartment.length) {
    throw new BadRequestError(
      `${wrongDepartment.map((u) => fullName(u)).join(', ')} ${wrongDepartment.length === 1 ? 'is' : 'are'} not in this team's department`,
      { code: 'MEMBER_DEPARTMENT_MISMATCH' },
    );
  }

  const managementUsers = users.filter((u) => u.role === ROLE.MANAGEMENT);
  if (managementUsers.length) {
    throw new BadRequestError('Management accounts cannot be assigned to a team');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id: { in: userIds } }, data: { teamId: id } });
    await audit.recordInTransaction(tx, {
      action: 'TEAM_MEMBER_ASSIGNED',
      entityType: 'Team',
      entityId: id,
      departmentId: team.departmentId,
      summary: `${userIds.length} member(s) assigned to team "${team.name}"`,
      after: { userIds },
    });
  });

  return getById(scope, id);
};

/**
 * What deleting this team would cost. The UI calls this BEFORE the confirmation,
 * so the admin sees real numbers rather than a generic "are you sure?".
 */
export const previewDelete = async (scope, id) => {
  const team = await prisma.team.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      departmentId: true,
      _count: { select: { members: true, taskDays: true, taskEntries: true } },
    },
  });
  if (!team) throw new NotFoundError('Team');
  assertCanActOn(scope, { departmentId: team.departmentId }, { allowSelf: false });

  const { members, taskEntries } = team._count;

  return {
    teamId: id,
    name: team.name,
    members,
    taskEntries,
    canDelete: members === 0,
    blockers:
      members > 0
        ? [`${members} employee(s) are still assigned to this team`]
        : [],
    /**
     * The honest recommendation.
     *
     * A team with logged work is company history. Deleting it does NOT destroy
     * that work — the entries survive, because they belong to the EMPLOYEE, not
     * to the team — but their `teamId` goes null, and every per-team report for
     * that period silently loses them. "Why does last quarter's team breakdown
     * not add up?" is a genuinely horrible question to debug.
     */
    recommendation:
      taskEntries > 0
        ? `This team has ${taskEntries} logged task entries. Deleting it will NOT destroy that work — the entries belong to the employees — but they will no longer be attributable to a team, so historical team reports for this period will stop adding up. Deactivating hides the team everywhere while keeping its reports intact.`
        : 'This team has no logged work, so nothing of reporting value will be lost.',
  };
};

/**
 * Delete a team.
 *
 * REFUSED while it still has members. Deleting a team out from under the people
 * in it would silently orphan them: `user.teamId` goes null, they vanish from
 * every team-scoped view, and their Tech Lead stops seeing them on the follow-up
 * panel — with nothing anywhere to say why. Reassign or remove the members first,
 * and the API says exactly how many are in the way.
 *
 * Task entries are NOT destroyed. They belong to the employee whose hour it was,
 * not to the team, so the FK simply nulls out (see schema: `onDelete: SetNull`).
 */
export const remove = async (scope, id, actor) => {
  const team = await prisma.team.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      departmentId: true,
      leadId: true,
      _count: { select: { members: true, taskEntries: true } },
    },
  });
  if (!team) throw new NotFoundError('Team');
  assertCanActOn(scope, { departmentId: team.departmentId }, { allowSelf: false });

  if (team._count.members > 0) {
    throw new ConflictError(
      `"${team.name}" still has ${team._count.members} member(s). Reassign or remove them first, or deactivate the team instead — deactivating hides it everywhere while keeping its history reportable.`,
      { code: 'TEAM_NOT_EMPTY', details: { members: team._count.members } },
    );
  }

  await prisma.$transaction(async (tx) => {
    // Audit FIRST, inside the transaction. Written after the delete, a crash in
    // between would remove the team and leave no trace it ever existed.
    await audit.recordInTransaction(tx, {
      action: 'TEAM_DELETED',
      entityType: 'Team',
      entityId: id,
      departmentId: team.departmentId,
      summary: `Deleted team "${team.name}" (${team.code}). It had no members. ${team._count.taskEntries} historical task entries are now unattributed to a team.`,
      before: {
        name: team.name,
        code: team.code,
        leadId: team.leadId,
        taskEntries: team._count.taskEntries,
      },
    });

    await tx.team.delete({ where: { id } });
  });

  logger.warn('Team deleted', { teamId: id, name: team.name, by: actor.id });

  return {
    id,
    deleted: true,
    message: `Team "${team.name}" has been deleted. Any work logged under it is untouched — it belongs to the employees, not the team.`,
  };
};

export const removeMember = async (scope, id, userId) => {
  const team = await prisma.team.findUnique({
    where: { id },
    select: { id: true, name: true, departmentId: true, leadId: true },
  });
  if (!team) throw new NotFoundError('Team');
  assertCanActOn(scope, { departmentId: team.departmentId }, { allowSelf: false });

  // Removing the lead is allowed — it vacates the lead seat rather than being
  // refused. A lead who is leaving must be removable before a successor exists;
  // the team simply runs leaderless until one is appointed.
  const removingTheLead = team.leadId === userId;

  await prisma.$transaction(async (tx) => {
    if (removingTheLead) {
      await tx.team.update({ where: { id }, data: { leadId: null } });
    }
    await tx.user.updateMany({ where: { id: userId, teamId: id }, data: { teamId: null } });

    await audit.recordInTransaction(tx, {
      action: 'TEAM_MEMBER_ASSIGNED',
      entityType: 'Team',
      entityId: id,
      departmentId: team.departmentId,
      summary: removingTheLead
        ? `Removed the lead from team "${team.name}" — it now has no lead. Assign a new one when appointed.`
        : `Member removed from team "${team.name}"`,
      after: { removedUserId: userId, vacatedLead: removingTheLead },
    });
  });

  return getById(scope, id);
};
