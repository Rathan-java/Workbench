/**
 * ASSIGNMENTS — the forward-looking half of the task domain.
 *
 * A TaskEntry records work ALREADY DONE (design note 2 in schema.prisma). An
 * Assignment records work a lead INTENDS to be done: who should do it, for which
 * project, by when. The two meet at TaskEntry.assignmentId — the hours an
 * employee logs become the running progress thread of the assignment, with no
 * separate "status update" ritual and no per-hour status field (the field this
 * system deliberately does not have).
 *
 * ── WHAT THIS FILE GUARANTEES ────────────────────────────────────────────────
 * 1. SCOPE. Every read and write passes through the isolation engine. A lead
 *    assigns only within their department; an employee sees only their own work.
 *    Because Assignment carries departmentId, this is the same scopeWhere() that
 *    guards every other model — no new hand-rolled checks.
 * 2. STATE MACHINE. status moves only along ASSIGNMENT_TRANSITIONS, exactly like
 *    the day-approval workflow. An illegal move is a 409, never a silent write.
 * 3. HANDSHAKE. The employee SUBMITs ("I believe this is done"); the lead REVIEWs
 *    (confirms DONE, or reopens). Two parties, both audited. Nobody grades their
 *    own delivery.
 * 4. THE WORK OUTLIVES THE PERSON. assignee / assignedBy snapshots are stamped in
 *    plain text so a deleted user leaves the assignment attributable, matching
 *    TaskDay / TaskEntry.
 */
import { prisma } from '../../config/prisma.js';
import { scopedWhereWithFilters, assertCanActOn } from '../../core/accessScope.js';
import { and, buildOrderBy, buildSearchFilter, toPrismaPage } from '../../core/pagination.js';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  ConflictError,
  VersionConflictError,
} from '../../core/errors.js';
import * as audit from '../audit/audit.service.js';
import { notify } from '../notifications/notification.service.js';
import { fullName } from '../../utils/name.js';
import { logger } from '../../config/logger.js';
import { toWorkDate, todayWorkDate, formatWorkDate } from '../../utils/date.js';
import {
  ASSIGNMENT_STATUS,
  ASSIGNMENT_OPEN_STATUSES,
  ASSIGNMENT_ACTIVE_STATUSES,
  canAssignmentTransition,
} from '../../config/constants.js';

const PERSON = { select: { id: true, firstName: true, lastName: true, avatarPath: true } };

const LIST_INCLUDE = {
  assignee: { select: { id: true, firstName: true, lastName: true, avatarPath: true, employeeCode: true } },
  assignedBy: { select: { id: true, firstName: true, lastName: true } },
  project: { select: { id: true, code: true, name: true } },
  department: { select: { id: true, name: true, colorHex: true } },
  _count: { select: { entries: true } },
};

const DETAIL_INCLUDE = {
  ...LIST_INCLUDE,
  reviewedBy: PERSON,
  // The progress thread: every hour logged against this assignment, in order.
  // This IS the "descriptive completion updates aligned in a path together" — the
  // employee's hourly descriptions read top to bottom as the story of the work.
  entries: {
    select: {
      id: true,
      workDate: true,
      description: true,
      isLate: true,
      timeSlot: { select: { label: true, startMinute: true, sortOrder: true } },
      user: PERSON,
    },
    orderBy: [{ workDate: 'asc' }, { timeSlot: { sortOrder: 'asc' } }],
  },
  transitions: {
    include: { actor: PERSON },
    orderBy: { createdAt: 'asc' },
  },
};

const SORTABLE = ['createdAt', 'updatedAt', 'dueDate', 'priority', 'status', 'title'];
const SEARCHABLE = ['title', 'description', 'assignee.firstName', 'assignee.lastName', 'project.name'];

const todayDate = () => toWorkDate(todayWorkDate());

/** Is an open assignment past its due date? Precomputed so the UI never guesses. */
const computeOverdue = (a) =>
  !!a.dueDate && ASSIGNMENT_OPEN_STATUSES.includes(a.status) && toWorkDate(a.dueDate) < todayDate();

const baseDto = (a) => {
  const hoursLogged = a._count?.entries ?? 0;
  return {
    id: a.id,
    title: a.title,
    description: a.description ?? null,
    status: a.status,
    priority: a.priority,
    dueDate: a.dueDate ? formatWorkDate(a.dueDate) : null,
    estimatedHours: a.estimatedHours ?? null,
    departmentId: a.departmentId,
    department: a.department ?? null,
    project: a.project ?? null,
    assignee: a.assignee
      ? { id: a.assignee.id, fullName: fullName(a.assignee), avatarPath: a.assignee.avatarPath, employeeCode: a.assignee.employeeCode }
      : { id: null, fullName: a.assigneeName ?? 'Former employee', avatarPath: null, employeeCode: a.assigneeCode ?? null },
    assignedBy: a.assignedBy
      ? { id: a.assignedBy.id, fullName: fullName(a.assignedBy) }
      : { id: null, fullName: a.assignedByName ?? 'System' },
    /** Effort actually spent — hours logged against this assignment. Un-gameable. */
    hoursLogged,
    /**
     * The ONLY honest percentage. It exists only when someone declared an
     * estimate; without one the UI shows hoursLogged and no bar, the same refusal
     * the project dashboard makes. Capped at 100 — an over-run reports as 100% and
     * the raw hours tell the rest of the story.
     */
    percentComplete: a.estimatedHours ? Math.min(100, Math.round((hoursLogged / a.estimatedHours) * 100)) : null,
    isOverdue: computeOverdue(a),
    version: a.version,
    submittedAt: a.submittedAt?.toISOString() ?? null,
    completedAt: a.completedAt?.toISOString() ?? null,
    createdAt: a.createdAt?.toISOString() ?? null,
    updatedAt: a.updatedAt?.toISOString() ?? null,
  };
};

const detailDto = (a) => ({
  ...baseDto(a),
  reviewNote: a.reviewNote ?? null,
  reviewedBy: a.reviewedBy ? { id: a.reviewedBy.id, fullName: fullName(a.reviewedBy) } : null,
  reviewedAt: a.reviewedAt?.toISOString() ?? null,
  thread: (a.entries ?? []).map((e) => ({
    id: e.id,
    workDate: formatWorkDate(e.workDate),
    hour: e.timeSlot?.label ?? '—',
    description: e.description,
    isLate: e.isLate,
    author: e.user ? { id: e.user.id, fullName: fullName(e.user), avatarPath: e.user.avatarPath } : null,
  })),
  history: (a.transitions ?? []).map((t) => ({
    from: t.from,
    to: t.to,
    note: t.note ?? null,
    actor: t.actor ? fullName(t.actor) : (t.actorName ?? 'System'),
    at: t.createdAt.toISOString(),
  })),
});

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const list = async (scope, query) => {
  const { skip, take, page, pageSize } = toPrismaPage(query);

  // "mine" is the convenience filter for "assigned to me" — a lead viewing their
  // own plate. It resolves to the caller's id; an explicit assigneeId wins.
  const ownerFilter = query.assigneeId ?? (query.mine ? scope.userId : undefined);

  // SELF (an employee) owns an assignment through `assigneeId`, not `userId` — so
  // the scope engine is told which column carries ownership for this model.
  const where = and(
    scopedWhereWithFilters(
      scope,
      { departmentId: query.departmentId, teamId: query.teamId, userId: ownerFilter },
      { userField: 'assigneeId' },
    ),
    query.status ? { status: query.status } : query.open ? { status: { in: ASSIGNMENT_OPEN_STATUSES } } : undefined,
    query.priority ? { priority: query.priority } : undefined,
    query.projectId ? { projectId: query.projectId } : undefined,
    query.overdue
      ? { dueDate: { lt: todayDate() }, status: { in: ASSIGNMENT_OPEN_STATUSES } }
      : undefined,
    buildSearchFilter(query.search, SEARCHABLE),
  );

  const [items, total] = await prisma.$transaction([
    prisma.assignment.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, [
        // Open work first, then most urgent, then soonest due.
        { status: 'asc' },
        { priority: 'desc' },
        { dueDate: 'asc' },
      ]),
      skip,
      take,
    }),
    prisma.assignment.count({ where }),
  ]);

  return { items: items.map(baseDto), total, page, pageSize };
};

export const getById = async (scope, id) => {
  const a = await prisma.assignment.findUnique({ where: { id }, include: DETAIL_INCLUDE });
  if (!a) throw new NotFoundError('Assignment');
  assertCanActOn(scope, { userId: a.assigneeId, departmentId: a.departmentId });
  return detailDto(a);
};

/**
 * The employee's ACTIVE assignments for a given day — the source for the hourly
 * grid picker and for the "required only if assigned" rule. Kept deliberately
 * small (no thread, no history): it is fetched on every grid load.
 *
 * `userId` lets a lead editing someone else's sheet see that person's plate; the
 * scope engine still refuses a cross-department or unrelated user.
 */
export const listActiveForUser = async (scope, userId) => {
  const targetUserId = userId ?? scope.userId;
  if (scope.kind === 'SELF' && targetUserId !== scope.userId) {
    throw new ForbiddenError('You can only see your own assignments');
  }

  const rows = await prisma.assignment.findMany({
    where: and(
      { assigneeId: targetUserId, status: { in: ASSIGNMENT_ACTIVE_STATUSES } },
      // A lead reaching for an employee is still bounded to their department.
      scope.isGlobal ? undefined : scope.kind === 'DEPARTMENT' ? { departmentId: scope.departmentId } : undefined,
    ),
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      dueDate: true,
      projectId: true,
      project: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }, { createdAt: 'asc' }],
  });

  return rows.map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    priority: a.priority,
    dueDate: a.dueDate ? formatWorkDate(a.dueDate) : null,
    projectId: a.projectId,
    project: a.project,
    isOverdue: !!a.dueDate && toWorkDate(a.dueDate) < todayDate(),
  }));
};

// ---------------------------------------------------------------------------
// Write: create
// ---------------------------------------------------------------------------

/** A project from another department would smuggle work across the boundary. */
const assertProjectInDepartment = async (projectId, departmentId) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, departmentId: true, status: true, name: true },
  });
  if (!project) throw new NotFoundError('Project');
  if (project.departmentId !== departmentId) {
    throw new BadRequestError('That project belongs to a different department', {
      code: 'PROJECT_DEPARTMENT_MISMATCH',
    });
  }
  if (project.status !== 'ACTIVE') {
    throw new BadRequestError(`Project "${project.name}" is no longer active`, { code: 'PROJECT_INACTIVE' });
  }
  return project;
};

export const create = async (scope, user, input) => {
  const assignee = await prisma.user.findUnique({
    where: { id: input.assigneeId },
    select: {
      id: true, firstName: true, lastName: true, employeeCode: true,
      role: true, status: true, departmentId: true, teamId: true, email: true,
    },
  });
  if (!assignee) throw new NotFoundError('Employee');
  if (assignee.status !== 'ACTIVE') {
    throw new BadRequestError('You cannot assign work to a deactivated account', { code: 'ASSIGNEE_INACTIVE' });
  }
  if (!assignee.departmentId) {
    throw new BadRequestError('This account has no department and cannot be assigned task work', {
      code: 'ASSIGNEE_NO_DEPARTMENT',
    });
  }

  // The lead may only assign inside their own department. The assignment's
  // department and team are the ASSIGNEE's — never trusted from the client — so
  // the scope engine guards it like every other row from here on.
  assertCanActOn(scope, { userId: assignee.id, departmentId: assignee.departmentId }, {
    allowSelf: true,
    message: 'You can only assign work to employees in your own department',
  });

  await assertProjectInDepartment(input.projectId, assignee.departmentId);

  if (input.dueDate && toWorkDate(input.dueDate) < todayDate()) {
    throw new BadRequestError('The due date cannot be in the past', { code: 'DUE_DATE_IN_PAST' });
  }

  const created = await prisma.$transaction(async (tx) => {
    const assignment = await tx.assignment.create({
      data: {
        departmentId: assignee.departmentId,
        teamId: assignee.teamId,
        projectId: input.projectId,
        assigneeId: assignee.id,
        assigneeName: fullName(assignee),
        assigneeCode: assignee.employeeCode,
        assignedById: user.id,
        assignedByName: fullName(user),
        title: input.title,
        description: input.description || null,
        priority: input.priority,
        dueDate: input.dueDate ? toWorkDate(input.dueDate) : null,
        estimatedHours: input.estimatedHours ?? null,
        status: ASSIGNMENT_STATUS.ASSIGNED,
        createdById: user.id,
        updatedById: user.id,
      },
      include: DETAIL_INCLUDE,
    });

    await tx.assignmentTransition.create({
      data: {
        assignmentId: assignment.id,
        from: ASSIGNMENT_STATUS.ASSIGNED,
        to: ASSIGNMENT_STATUS.ASSIGNED,
        actorId: user.id,
        actorName: fullName(user),
        note: 'Assigned.',
      },
    });

    await audit.recordInTransaction(tx, {
      action: 'ASSIGNMENT_CREATED',
      entityType: 'Assignment',
      entityId: assignment.id,
      departmentId: assignment.departmentId,
      summary: `Assigned "${assignment.title}" to ${fullName(assignee)}`,
      after: { title: assignment.title, assigneeId: assignee.id, dueDate: input.dueDate ?? null, priority: input.priority },
    });

    return assignment;
  });

  // Tell the employee they have new work. In-app first; the bell is the record.
  void notify({
    userId: assignee.id,
    type: 'TASK_ASSIGNED',
    level: 'INFO',
    title: 'New task assigned to you',
    body: `${fullName(user)} assigned you "${input.title}"${input.dueDate ? `, due ${formatWorkDate(toWorkDate(input.dueDate))}` : ''}.`,
    link: `/assignments/${created.id}`,
    entityType: 'Assignment',
    entityId: created.id,
  }).catch((error) => logger.warn('Assignment notification failed', { error: error.message }));

  // Re-read so the returned detail includes the "Assigned" transition (written
  // after the create above), keeping the history complete from the first render.
  const fresh = await prisma.assignment.findUnique({ where: { id: created.id }, include: DETAIL_INCLUDE });
  return detailDto(fresh);
};

// ---------------------------------------------------------------------------
// Write: update the brief
// ---------------------------------------------------------------------------

export const update = async (scope, user, id, input) => {
  const before = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true, title: true, description: true, priority: true, dueDate: true, estimatedHours: true, status: true, departmentId: true, version: true },
  });
  if (!before) throw new NotFoundError('Assignment');
  assertCanActOn(scope, { departmentId: before.departmentId }, { allowSelf: false });

  if (before.status === ASSIGNMENT_STATUS.DONE || before.status === ASSIGNMENT_STATUS.CANCELLED) {
    throw new ConflictError(`A ${before.status} assignment can no longer be edited. Reopen it first.`, {
      code: 'ASSIGNMENT_CLOSED',
    });
  }

  // Optimistic concurrency — the lead's edit must not silently clobber a change
  // made in another tab. Same contract as TaskEntry.version.
  if (input.version !== undefined && input.version !== before.version) {
    throw new VersionConflictError(baseDto({ ...before, _count: { entries: 0 } }));
  }

  if (input.dueDate && toWorkDate(input.dueDate) < todayDate() && input.dueDate !== (before.dueDate && formatWorkDate(before.dueDate))) {
    throw new BadRequestError('The due date cannot be in the past', { code: 'DUE_DATE_IN_PAST' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.assignment.update({
      where: { id },
      data: {
        title: input.title,
        description: input.description !== undefined ? input.description || null : undefined,
        priority: input.priority,
        dueDate: input.dueDate !== undefined ? (input.dueDate ? toWorkDate(input.dueDate) : null) : undefined,
        estimatedHours: input.estimatedHours !== undefined ? input.estimatedHours : undefined,
        updatedById: user.id,
        version: { increment: 1 },
      },
      include: DETAIL_INCLUDE,
    });

    const { before: b, after: a } = audit.diff(
      { title: before.title, description: before.description, priority: before.priority, dueDate: before.dueDate, estimatedHours: before.estimatedHours },
      { title: row.title, description: row.description, priority: row.priority, dueDate: row.dueDate, estimatedHours: row.estimatedHours },
    );
    if (Object.keys(a).length) {
      await audit.recordInTransaction(tx, {
        action: 'ASSIGNMENT_UPDATED',
        entityType: 'Assignment',
        entityId: id,
        departmentId: row.departmentId,
        summary: `Updated assignment "${row.title}"`,
        before: b,
        after: a,
      });
    }
    return row;
  });

  return detailDto(updated);
};

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

const applyTransition = async (tx, { assignment, to, actor, note }) => {
  if (!canAssignmentTransition(assignment.status, to)) {
    throw new ConflictError(`A ${assignment.status} assignment cannot move to ${to}`, {
      code: 'INVALID_ASSIGNMENT_TRANSITION',
      details: { from: assignment.status, to },
    });
  }

  const now = new Date();
  const data = {
    status: to,
    updatedById: actor?.id ?? null,
    ...(to === ASSIGNMENT_STATUS.SUBMITTED ? { submittedAt: now } : {}),
    ...(to === ASSIGNMENT_STATUS.DONE
      ? { completedAt: now, reviewedById: actor?.id ?? null, reviewedAt: now, reviewNote: note ?? null }
      : {}),
    // Reopening wipes the completion + submission stamps so a fresh handshake can
    // happen cleanly; the transition log preserves that it was ever done.
    ...(to === ASSIGNMENT_STATUS.IN_PROGRESS
      ? { completedAt: null, submittedAt: null, reviewedById: null, reviewedAt: null }
      : {}),
  };

  await tx.assignment.update({ where: { id: assignment.id }, data });

  await tx.assignmentTransition.create({
    data: {
      assignmentId: assignment.id,
      from: assignment.status,
      to,
      actorId: actor?.id ?? null,
      actorName: actor ? fullName(actor) : null,
      note: note ?? null,
    },
  });

  // Re-read AFTER the transition is written, so the returned detail's history
  // includes the move we just made — otherwise the UI shows a timeline one step
  // stale and has to refetch to see the very action it just took.
  return tx.assignment.findUnique({ where: { id: assignment.id }, include: DETAIL_INCLUDE });
};

/**
 * Bump ASSIGNED → IN_PROGRESS the first time an hour is logged against it.
 * Called from TaskService inside the entry-save transaction, so "work started"
 * is recorded atomically with the hour that started it. A no-op unless the
 * assignment is still sitting untouched in ASSIGNED.
 */
export const touchProgressInTransaction = async (tx, assignmentId, actor) => {
  const a = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { id: true, status: true } });
  if (!a || a.status !== ASSIGNMENT_STATUS.ASSIGNED) return;
  await tx.assignment.update({
    where: { id: a.id },
    data: { status: ASSIGNMENT_STATUS.IN_PROGRESS, updatedById: actor?.id ?? null },
  });
  await tx.assignmentTransition.create({
    data: {
      assignmentId: a.id,
      from: ASSIGNMENT_STATUS.ASSIGNED,
      to: ASSIGNMENT_STATUS.IN_PROGRESS,
      actorId: actor?.id ?? null,
      actorName: actor ? fullName(actor) : null,
      note: 'Work started — first hour logged.',
    },
  });
};

/** The employee's move: hand a finished assignment back for sign-off. */
export const submit = async (scope, user, id, { note } = {}) => {
  const a = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, departmentId: true, assigneeId: true, assignedById: true },
  });
  if (!a) throw new NotFoundError('Assignment');

  // Only the person the work belongs to may declare it done.
  if (a.assigneeId !== user.id) {
    throw new ForbiddenError('Only the assignee can submit their assignment', { code: 'NOT_ASSIGNEE' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await applyTransition(tx, { assignment: a, to: ASSIGNMENT_STATUS.SUBMITTED, actor: user, note });
    await audit.recordInTransaction(tx, {
      action: 'ASSIGNMENT_SUBMITTED',
      entityType: 'Assignment',
      entityId: id,
      departmentId: a.departmentId,
      summary: `Submitted assignment "${a.title}" for review`,
    });
    return row;
  });

  // Tell whoever assigned it that it is waiting on them.
  if (a.assignedById && a.assignedById !== user.id) {
    void notify({
      userId: a.assignedById,
      type: 'ASSIGNMENT_SUBMITTED',
      level: 'INFO',
      title: 'Assignment ready for review',
      body: `${fullName(user)} marked "${a.title}" as done. Review and confirm it.`,
      link: `/assignments/${id}`,
      entityType: 'Assignment',
      entityId: id,
    }).catch((error) => logger.warn('Submit notification failed', { error: error.message }));
  }

  return detailDto(updated);
};

/** The lead's move: confirm DONE, or reopen (send back to be worked on). */
export const review = async (scope, user, id, { decision, note } = {}) => {
  const a = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, departmentId: true, assigneeId: true },
  });
  if (!a) throw new NotFoundError('Assignment');
  assertCanActOn(scope, { departmentId: a.departmentId }, { allowSelf: false });

  // NO SELF-REVIEW. The confirmation is a two-party handshake: the assignee
  // submits, someone ELSE signs it off. A Tech Lead who is assigned a task holds
  // the review permission, but must not be allowed to approve their own work —
  // exactly as reviewDay() forbids approving your own timesheet. Management (or
  // another lead in the department) confirms it instead.
  if (a.assigneeId === user.id) {
    throw new ForbiddenError('You cannot review your own assignment — it must be confirmed by someone else.', {
      code: 'SELF_REVIEW_FORBIDDEN',
    });
  }

  const to = decision === 'DONE' ? ASSIGNMENT_STATUS.DONE : ASSIGNMENT_STATUS.IN_PROGRESS;

  const updated = await prisma.$transaction(async (tx) => {
    const row = await applyTransition(tx, { assignment: a, to, actor: user, note });
    await audit.recordInTransaction(tx, {
      action: decision === 'DONE' ? 'ASSIGNMENT_COMPLETED' : 'ASSIGNMENT_REOPENED',
      entityType: 'Assignment',
      entityId: id,
      departmentId: a.departmentId,
      summary: `${decision === 'DONE' ? 'Confirmed done' : 'Reopened'} assignment "${a.title}"${note ? `. Note: ${note}` : ''}`,
      before: { status: a.status },
      after: { status: to },
    });
    return row;
  });

  if (a.assigneeId && a.assigneeId !== user.id) {
    void notify({
      userId: a.assigneeId,
      type: decision === 'DONE' ? 'ASSIGNMENT_COMPLETED' : 'ASSIGNMENT_REOPENED',
      level: decision === 'DONE' ? 'SUCCESS' : 'WARNING',
      title: decision === 'DONE' ? 'Assignment confirmed done' : 'Assignment reopened',
      body:
        decision === 'DONE'
          ? `${fullName(user)} confirmed "${a.title}" as done.`
          : `${fullName(user)} reopened "${a.title}".${note ? ` "${note}"` : ''}`,
      link: `/assignments/${id}`,
      entityType: 'Assignment',
      entityId: id,
    }).catch((error) => logger.warn('Review notification failed', { error: error.message }));
  }

  return detailDto(updated);
};

/** Call an assignment off. Never deletes it — the logged hours and trail survive. */
export const cancel = async (scope, user, id, { reason } = {}) => {
  const a = await prisma.assignment.findUnique({
    where: { id },
    select: { id: true, status: true, title: true, departmentId: true, assigneeId: true },
  });
  if (!a) throw new NotFoundError('Assignment');
  assertCanActOn(scope, { departmentId: a.departmentId }, { allowSelf: false });

  const updated = await prisma.$transaction(async (tx) => {
    const row = await applyTransition(tx, { assignment: a, to: ASSIGNMENT_STATUS.CANCELLED, actor: user, note: reason });
    await audit.recordInTransaction(tx, {
      action: 'ASSIGNMENT_CANCELLED',
      entityType: 'Assignment',
      entityId: id,
      departmentId: a.departmentId,
      summary: `Cancelled assignment "${a.title}"${reason ? `. Reason: ${reason}` : ''}`,
      before: { status: a.status },
    });
    return row;
  });

  if (a.assigneeId && a.assigneeId !== user.id) {
    void notify({
      userId: a.assigneeId,
      type: 'SYSTEM',
      level: 'INFO',
      title: 'Assignment cancelled',
      body: `${fullName(user)} cancelled "${a.title}".${reason ? ` "${reason}"` : ''}`,
      link: '/assignments',
      entityType: 'Assignment',
      entityId: id,
    }).catch(() => {});
  }

  return detailDto(updated);
};

export default { list, getById, listActiveForUser, create, update, submit, review, cancel, touchProgressInTransaction };
