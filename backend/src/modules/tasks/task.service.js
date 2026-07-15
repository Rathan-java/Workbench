/**
 * THE TASK MONITORING DOMAIN.
 *
 * Read this header before changing anything below it.
 *
 * ── THE SHAPE ────────────────────────────────────────────────────────────────
 * The UI is a table: one row per day, one column per working hour. That maps to
 *   TaskDay  (one per employee per date, owns the approval state)
 *     └── TaskEntry (one per hour, owns the work description + status)
 *
 * The grid is rendered from the DEPARTMENT's time slots, so Tech's seven
 * columns and Video Editing's late-shift columns come out of the same code.
 *
 * ── FIVE INVARIANTS ENFORCED HERE ────────────────────────────────────────────
 * 1. SCOPE.   Every read and write passes through assertCanActOn(). A Tech Lead
 *             cannot touch another department's sheet; an Employee cannot touch
 *             another person's.
 * 2. LOCKING.  A SUBMITTED or APPROVED day is read-only to its owner. Only a
 *             lead/manager holding TASK_OVERRIDE_LOCK may edit it, and that edit
 *             is flagged `editedByLead` and audited.
 * 3. CONCURRENCY. Every entry carries a `version`. A write that echoes a stale
 *             version gets 409 + the server's copy. Two open tabs cannot
 *             silently eat each other's work.
 * 4. HISTORY. Every mutation writes a TaskEntryRevision in the SAME transaction.
 *             History cannot drift from the live row, because they commit or
 *             fail together.
 * 5. BACKDATING. Employees may edit today and N previous days (a setting).
 *             Without this, "yesterday's timesheet" is editable forever and the
 *             data stops meaning anything.
 */
import { prisma } from '../../config/prisma.js';
import * as repo from './task.repository.js';
import { validateAttributes } from './taskAttributes.js';
import { toEntryDto, toDayDto, toRevisionDto } from './task.dto.js';
import * as departmentService from '../departments/department.service.js';
import * as settings from '../settings/setting.service.js';
import * as audit from '../audit/audit.service.js';
import { notify } from '../notifications/notification.service.js';
import { taskReviewedEmail } from '../notifications/email.templates.js';
import { fullName } from '../../utils/name.js';
import {
  NotFoundError,
  ForbiddenError,
  BadRequestError,
  ConflictError,
  ValidationError,
  VersionConflictError,
} from '../../core/errors.js';
import { assertCanActOn, isSelf } from '../../core/accessScope.js';
import { PERMISSIONS } from '../../core/permissions.js';
import {
  ROLE,
  DAY_STATUS,
  LOCKED_DAY_STATUSES,
  canTransition,
  SETTING_KEY,
  DEFAULT_GRACE_MINUTES,
} from '../../config/constants.js';
import {
  toWorkDate,
  todayWorkDate,
  formatWorkDate,
  minutesSinceMidnight,
  isoWeekdayOf,
  dayjs,
} from '../../utils/date.js';
import { logger } from '../../config/logger.js';

const can = (user, permission) => user.permissions.includes(permission);

// ---------------------------------------------------------------------------
// Target resolution — "whose sheet am I touching, and may I?"
// ---------------------------------------------------------------------------

/**
 * Resolves the employee whose sheet is being read/written and authorises it.
 * Every public method in this file starts here. There is no other door in.
 */
const resolveTarget = async (scope, user, requestedUserId) => {
  const targetUserId = requestedUserId ?? scope.userId;

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      employeeCode: true,
      role: true,
      departmentId: true,
      teamId: true,
      status: true,
      timezone: true,
      department: { select: { id: true, code: true, name: true, requiredSlotsPerDay: true, workingWeekdays: true } },
    },
  });

  if (!target) throw new NotFoundError('Employee');

  if (!target.departmentId) {
    // A Management account has no department and therefore no task grid of its
    // own. It monitors; it does not log hours.
    throw new BadRequestError(
      'This account does not belong to a department and has no task sheet.',
      { code: 'NO_DEPARTMENT' },
    );
  }

  assertCanActOn(scope, { userId: target.id, departmentId: target.departmentId });

  const viewingSomeoneElse = !isSelf(scope, target.id);
  return { target, viewingSomeoneElse };
};

/** Writing to someone else's sheet needs an explicit, separate permission. */
const assertMayWrite = (user, viewingSomeoneElse) => {
  if (viewingSomeoneElse) {
    if (!can(user, PERMISSIONS.TASK_WRITE_ANY)) {
      throw new ForbiddenError("You cannot edit another employee's task sheet");
    }
  } else if (!can(user, PERMISSIONS.TASK_WRITE_OWN)) {
    throw new ForbiddenError('You do not have permission to log tasks');
  }
};

/**
 * Approval lock + backdating window.
 *
 * ── WHAT IS DELIBERATELY *NOT* BLOCKED HERE ──────────────────────────────────
 * An employee filling the 10:00–11:00 hour at 17:00 is ALLOWED, and so is editing
 * that entry again afterwards. Nothing about a slot having elapsed makes it
 * read-only. People get pulled into an incident, or a client call, and write the
 * whole day up at 5pm — a timesheet that refuses that entry does not produce
 * better data, it produces an empty timesheet and an employee who has learned the
 * tool fights them.
 *
 * The elapsed hour is instead recorded honestly: the entry is flagged `isLate`,
 * it shows as a LATE chip, it counts in the late-updates metric, and past the
 * grace period the Tech Lead is told. The system MEASURES the behaviour rather
 * than PREVENTING the record — which is the whole point of a monitoring system.
 *
 * The two things that DO lock a day:
 *   1. It was submitted for approval, or already approved. (A lead can override.)
 *   2. It is older than the backdated-edit window. (Configurable; a lead can override.)
 */
const assertDayEditable = async (user, day, workDate, viewingSomeoneElse) => {
  const privileged = can(user, PERMISSIONS.TASK_OVERRIDE_LOCK);

  if (day && LOCKED_DAY_STATUSES.includes(day.status) && !privileged) {
    throw new ConflictError(
      day.status === DAY_STATUS.SUBMITTED
        ? 'This sheet has been submitted for approval and can no longer be edited. Ask your Tech Lead to return it.'
        : 'This sheet has been approved and is locked.',
      { code: 'DAY_LOCKED', details: { status: day.status } },
    );
  }

  if (privileged || viewingSomeoneElse) return;

  const allowedDays = await settings.get(SETTING_KEY.ALLOW_BACKDATED_EDIT_DAYS, 2);
  const today = todayWorkDate();
  const diffDays = dayjs.utc(today).diff(dayjs.utc(workDate), 'day');

  if (diffDays > allowedDays) {
    throw new ForbiddenError(
      `You can only edit the last ${allowedDays} day(s). Ask your Tech Lead to update older entries.`,
      { code: 'BACKDATE_WINDOW_EXCEEDED', details: { allowedDays } },
    );
  }
  if (diffDays < 0) {
    throw new BadRequestError('You cannot log work for a future date', { code: 'FUTURE_DATE' });
  }
};

/**
 * How many hours this department REQUIRES of an employee in a day.
 *
 * Excludes breaks (obviously) and OVERTIME columns. An overtime hour that counted
 * toward the requirement would silently make overtime mandatory: an employee who
 * went home on time would show as non-compliant purely because a colleague had
 * added an 18:00 column. Overtime is recorded, never required.
 */
const countRequiredSlots = (client, departmentId) =>
  client.timeSlot.count({
    where: { departmentId, isActive: true, isBreak: false, isOvertime: false },
  });

/**
 * "Was this logged after its hour had already gone?"
 *
 * This single boolean is what every late-update metric, every reminder and every
 * compliance report in the system is built on — so it is computed on the server,
 * from the slot's own end time plus the configured grace period. Never trusted
 * from the client, and never inferred from `updatedAt` (which moves every time
 * anyone touches the row).
 */
const computeIsLate = (slot, workDate, graceMinutes) => {
  const today = todayWorkDate();
  const dayDiff = dayjs.utc(today).diff(dayjs.utc(workDate), 'day');

  if (dayDiff > 0) return true; // any entry for a past day is, by definition, late
  if (dayDiff < 0) return false; // future date — blocked elsewhere anyway

  return minutesSinceMidnight() > slot.endMinute + graceMinutes;
};

// ---------------------------------------------------------------------------
// Read: the grid
// ---------------------------------------------------------------------------

/**
 * Everything the task-entry screen needs for one employee on one date.
 *
 * Note we do NOT create a TaskDay on read. Creating a row every time somebody
 * merely *looks* at a date would fill the table with hundreds of thousands of
 * empty days and wreck every "who filed a sheet?" query. The day is created
 * lazily, on first write.
 */
export const getGrid = async (scope, user, { date, userId }) => {
  const workDate = toWorkDate(date ?? todayWorkDate());
  const { target, viewingSomeoneElse } = await resolveTarget(scope, user, userId);

  const [slots, day, graceMinutes, backdateDays] = await Promise.all([
    departmentService.getTimeSlots(target.departmentId),
    repo.findDay(target.id, workDate),
    settings.get(SETTING_KEY.REMINDER_GRACE_MINUTES, DEFAULT_GRACE_MINUTES),
    settings.get(SETTING_KEY.ALLOW_BACKDATED_EDIT_DAYS, 2),
  ]);

  const workingWeekdays = target.department.workingWeekdays ?? [1, 2, 3, 4, 5];
  const isWorkingDay = workingWeekdays.includes(isoWeekdayOf(workDate));

  const entriesBySlot = new Map((day?.entries ?? []).map((e) => [e.timeSlotId, e]));

  const nowMinutes = minutesSinceMidnight();
  const isToday = formatWorkDate(workDate) === formatWorkDate(todayWorkDate());

  // One cell per slot, present or absent. The frontend renders straight from
  // this — it never has to reconcile "which slots exist" with "which are filled".
  const cells = slots.map((slot) => {
    const entry = entriesBySlot.get(slot.id);
    return {
      timeSlot: slot,
      entry: entry ? toEntryDto(entry) : null,
      isCurrentHour: isToday && nowMinutes >= slot.startMinute && nowMinutes < slot.endMinute,
      isElapsed: isToday ? nowMinutes > slot.endMinute + graceMinutes : !isToday,
      /** The UI paints this amber: the hour is gone and nothing was logged. */
      // An unfilled OVERTIME column is not a gap — it is somebody going home on
      // time. Flagging it amber would shame people for not working late.
      isMissing:
        !slot.isBreak &&
        !slot.isOvertime &&
        !entry &&
        (isToday ? nowMinutes > slot.endMinute + graceMinutes : true),
    };
  });

  // The denominator excludes overtime: working late must not be the thing that
  // makes a colleague who left on time look non-compliant.
  const requiredSlots = slots.filter((s) => !s.isBreak && !s.isOvertime).length;
  const filledSlots = cells.filter((c) => c.entry && !c.timeSlot.isOvertime).length;
  const overtimeSlots = cells.filter((c) => c.entry && c.timeSlot.isOvertime).length;

  const diffDays = dayjs.utc(todayWorkDate()).diff(dayjs.utc(workDate), 'day');
  const privileged = can(user, PERMISSIONS.TASK_OVERRIDE_LOCK);
  const locked = day ? LOCKED_DAY_STATUSES.includes(day.status) : false;

  return {
    workDate: formatWorkDate(workDate),
    employee: {
      id: target.id,
      fullName: fullName(target),
      employeeCode: target.employeeCode,
      role: target.role,
      departmentId: target.departmentId,
      department: target.department,
      teamId: target.teamId,
    },
    // WHETHER THIS SHEET MUST NAME A PROJECT.
    // An employee's hour is required to carry a project — that is the index the
    // whole reporting layer reads. A Tech Lead's is not: a lead's day is spread
    // across every project they oversee, and forcing them to pick one would just
    // mean picking arbitrarily. Their hours land in the department's Internal
    // bucket unless they say otherwise, and they log a description and move on.
    projectRequired: target.role === ROLE.EMPLOYEE,
    day: day
      ? toDayDto({ ...day, entries: undefined })
      : {
          id: null,
          status: DAY_STATUS.DRAFT,
          workDate: formatWorkDate(workDate),
          filledSlots: 0,
          expectedSlots: requiredSlots,
          completionRate: 0,
          reviewNote: null,
          reviewedBy: null,
        },
    cells,
    summary: {
      requiredSlots,
      filledSlots,
      /** Extra hours logged beyond the working day. Reported, never required. */
      overtimeSlots,
      missingSlots: cells.filter((c) => c.isMissing).length,
      lateSlots: cells.filter((c) => c.entry?.isLate).length,
      completionRate: requiredSlots ? Math.round((filledSlots / requiredSlots) * 100) : 0,
    },
    /** The '+' button posts here to append the next hour. */
    canAddOvertime: can(user, PERMISSIONS.TASK_ADD_OVERTIME) && !viewingSomeoneElse,
    // The UI greys out the grid and explains WHY, rather than letting a user
    // type for ten minutes and then eat a 403 on save.
    permissions: {
      canEdit:
        !viewingSomeoneElse || can(user, PERMISSIONS.TASK_WRITE_ANY)
          ? privileged || (!locked && diffDays >= 0 && diffDays <= backdateDays)
          : false,
      canSubmit: !viewingSomeoneElse && !locked && isWorkingDay,
      canReview: viewingSomeoneElse && can(user, PERMISSIONS.TASK_APPROVE),
      isLocked: locked,
      lockReason: locked
        ? day.status === DAY_STATUS.SUBMITTED
          ? 'Submitted for approval'
          : 'Approved and locked'
        : diffDays > backdateDays && !privileged
          ? `Outside the ${backdateDays}-day editing window`
          : null,
      isReadOnlyView: viewingSomeoneElse,
    },
    isWorkingDay,
  };
};

// ---------------------------------------------------------------------------
// Write: one cell
// ---------------------------------------------------------------------------

/**
 * Create or update ONE hourly entry.
 *
 * The whole thing runs in a single transaction: the TaskDay upsert, the entry
 * write, the revision row and the day's counters either all land or none do.
 * A half-applied save that leaves `filledSlots` disagreeing with reality is the
 * kind of bug that quietly poisons six months of compliance reporting.
 */
export const saveEntry = async (scope, user, { date, userId, ...input }) => {
  const workDate = toWorkDate(date);
  const { target, viewingSomeoneElse } = await resolveTarget(scope, user, userId);

  assertMayWrite(user, viewingSomeoneElse);

  const [slot, existingDay, graceMinutes] = await Promise.all([
    prisma.timeSlot.findUnique({ where: { id: input.timeSlotId } }),
    repo.findDayLite(target.id, workDate),
    settings.get(SETTING_KEY.REMINDER_GRACE_MINUTES, DEFAULT_GRACE_MINUTES),
  ]);

  if (!slot || slot.departmentId !== target.departmentId) {
    throw new BadRequestError('That time slot does not belong to this employee’s department', {
      code: 'SLOT_DEPARTMENT_MISMATCH',
    });
  }
  if (slot.isBreak) {
    throw new BadRequestError('You cannot log work against a break', { code: 'SLOT_IS_BREAK' });
  }
  // NOTE: an OVERTIME slot is deliberately writable. That is the entire point of it.

  await assertDayEditable(user, existingDay, workDate, viewingSomeoneElse);

  // Department-specific fields. `partial` while the user is still typing, strict
  // once they stop — otherwise auto-save would nag about a required field the
  // employee is about to fill in.
  const attributes = await validateAttributes(target.departmentId, input.attributes, {
    partial: input.isAutoSave,
  });

  await assertProjectBelongsToDepartment(input.projectId, target.departmentId);

  // WHOSE SHEET DECIDES WHETHER A PROJECT IS REQUIRED.
  // An employee must name one. A Tech Lead need not — their day is spread across
  // every project they oversee, so when they leave it blank their hours fall to
  // the department's Internal bucket rather than forcing an arbitrary pick. We
  // resolve that default HERE, before the transaction, so the write below is a
  // plain assignment with no role logic tangled into it.
  const projectRequired = target.role === ROLE.EMPLOYEE;
  const defaultProjectId =
    !input.projectId && !projectRequired
      ? await getInternalProjectId(target.departmentId)
      : null;

  const isLate = computeIsLate(slot, workDate, graceMinutes);

  const result = await prisma.$transaction(async (tx) => {
    // 1. The day (created lazily, on first write of the date).
    const requiredSlots = await countRequiredSlots(tx, target.departmentId);

    const day = await tx.taskDay.upsert({
      where: { userId_workDate: { userId: target.id, workDate } },
      create: {
        userId: target.id,
        departmentId: target.departmentId,
        teamId: target.teamId,
        workDate,
        status: DAY_STATUS.DRAFT,
        expectedSlots: requiredSlots,
      },
      update: { expectedSlots: requiredSlots },
      select: { id: true, status: true },
    });

    // 2. The entry.
    const existing = await tx.taskEntry.findUnique({
      where: { taskDayId_timeSlotId: { taskDayId: day.id, timeSlotId: slot.id } },
    });

    // ── OPTIMISTIC LOCK ──────────────────────────────────────────────────
    // The client tells us which version it was editing. If the row has moved on
    // since, someone else (or another tab) saved first — refuse, and hand back
    // the current row so the UI can show a real conflict instead of losing work.
    if (existing && input.version !== undefined && existing.version !== input.version) {
      throw new VersionConflictError(toEntryDto({ ...existing, timeSlot: slot }));
    }

    // The project actually written: what they chose, else what the row already
    // had, else the role-based default (Internal for a lead, nothing for an
    // employee). `defaultProjectId` is null for an employee, so the guard below
    // still fires for them.
    const finalProjectId = input.projectId ?? existing?.projectId ?? defaultProjectId;

    // AN EMPLOYEE'S HOUR MUST NAME A PROJECT.
    //
    // saveEntrySchema relaxes this for autosaves, so a draft fired 1.2s into
    // typing does not scold someone who has not reached the dropdown yet. That
    // relaxation is only safe for an UPDATE — an existing row already has a
    // project. A CREATE with none would write the one thing the redesign forbids:
    // an hour invisible to every project report. So an autosave that would create
    // one is dropped (the client re-sends on the explicit save); an explicit save
    // is a field-level 422 on projectId. Leads never reach here — they always
    // have `defaultProjectId`.
    if (!existing && !finalProjectId) {
      if (input.isAutoSave) return { skipped: true };
      throw new ValidationError(
        [{ path: 'projectId', message: 'Choose the project this hour belongs to' }],
        'Choose the project this hour belongs to',
      );
    }

    const data = {
      description: input.description,
      projectId: finalProjectId,
      remarks: input.remarks ?? null,
      attributes,
      isLate: existing ? existing.isLate || isLate : isLate,
      editedByLead: viewingSomeoneElse ? true : (existing?.editedByLead ?? false),
      updatedById: user.id,
    };

    const entry = existing
      ? await tx.taskEntry.update({
          where: { id: existing.id },
          data: { ...data, version: { increment: 1 } },
          include: repo.ENTRY_INCLUDE,
        })
      : await tx.taskEntry.create({
          data: {
            ...data,
            taskDayId: day.id,
            timeSlotId: slot.id,
            userId: target.id,
            departmentId: target.departmentId,
            teamId: target.teamId,
            workDate,
            createdById: user.id,
            version: 1,
          },
          include: repo.ENTRY_INCLUDE,
        });

    // 3. History — same transaction, so it can never disagree with the row above.
    await writeRevision(tx, {
      entry,
      action: existing ? (viewingSomeoneElse ? 'LEAD_EDIT' : 'UPDATE') : 'CREATE',
      previous: existing,
      actorId: user.id,
    });

    // 4. Day counters, recomputed from the truth rather than incremented.
    const filledSlots = await tx.taskEntry.count({ where: { taskDayId: day.id } });
    await tx.taskDay.update({
      where: { id: day.id },
      data: {
        filledSlots,
        // An edit to a REJECTED sheet moves it back to DRAFT: the employee is
        // acting on the feedback, and the sheet is live again.
        ...(day.status === DAY_STATUS.REJECTED ? { status: DAY_STATUS.DRAFT } : {}),
      },
    });

    return { entry, dayId: day.id, filledSlots };
  });

  // The autosave-would-create-an-unprojected-row case above. Report it honestly
  // rather than inventing an entry: the client keeps its local draft and stays
  // "unsaved", which is exactly what is true.
  if (result.skipped) {
    return { entry: null, skipped: true, reason: 'PROJECT_REQUIRED' };
  }

  // Audit outside the transaction (fire-and-forget) — this is a high-frequency
  // path and the audit write must never be in the user's latency budget.
  if (viewingSomeoneElse) {
    audit.record({
      action: 'TASK_EDITED_BY_LEAD',
      entityType: 'TaskEntry',
      entityId: result.entry.id,
      departmentId: target.departmentId,
      summary: `${fullName(user)} edited ${fullName(target)}'s ${slot.label} entry on ${formatWorkDate(workDate)}`,
    });

    void notify({
      userId: target.id,
      type: 'TASK_EDITED_BY_LEAD',
      level: 'WARNING',
      title: 'Your task sheet was edited',
      body: `${fullName(user)} updated your ${slot.label} entry for ${formatWorkDate(workDate)}.`,
      link: `/tasks?date=${formatWorkDate(workDate)}`,
      entityType: 'TaskEntry',
      entityId: result.entry.id,
    }).catch(() => {});
  } else {
    audit.record({
      action: input.version ? 'TASK_UPDATED' : 'TASK_CREATED',
      entityType: 'TaskEntry',
      entityId: result.entry.id,
      departmentId: target.departmentId,
      summary: `Logged ${slot.label} on ${formatWorkDate(workDate)}`,
    });
  }

  return {
    entry: toEntryDto(result.entry),
    day: { id: result.dayId, filledSlots: result.filledSlots },
  };
};

/**
 * The department's "Internal / Non-project" catch-all — where a Tech Lead's
 * unprojected hours land. Every department is seeded with exactly one (see the
 * seed and department.service.create), so this is a lookup, not a maybe. If it
 * is somehow missing, fail loudly rather than writing an hour with no project
 * into a NOT NULL column.
 */
const getInternalProjectId = async (departmentId) => {
  const project = await prisma.project.findFirst({
    where: { departmentId, isInternal: true },
    select: { id: true },
  });
  if (!project) {
    throw new BadRequestError(
      'This department has no Internal project to file non-project hours against.',
      { code: 'NO_INTERNAL_PROJECT' },
    );
  }
  return project.id;
};

/**
 * A project from another department would smuggle an hour of work across the
 * boundary the whole scope engine exists to hold. Nothing in the database
 * enforces this — TaskEntry.departmentId is denormalised, and Project reaches
 * Department by its own column — so it is enforced here, on every write.
 */
const assertProjectBelongsToDepartment = async (projectId, departmentId) => {
  if (!projectId) return; // autosave-update path; the row keeps the project it has

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
    throw new BadRequestError(`Project "${project.name}" is no longer active`, {
      code: 'PROJECT_INACTIVE',
    });
  }
};

/**
 * The append-only history writer.
 * Precomputes the field-level diff so the UI never has to reconstruct one, and
 * stores a full post-change snapshot so a revision is readable on its own even
 * if the schema changes in two years.
 */
const writeRevision = async (tx, { entry, action, previous, actorId, reason }) => {
  const snapshot = {
    description: entry.description,
    projectId: entry.projectId,
    // The NAME, not just the id. A revision must stay readable in two years,
    // after the project has been renamed or archived and the id resolves to
    // nothing a human recognises.
    projectName: entry.project?.name ?? null,
    remarks: entry.remarks,
    attributes: entry.attributes,
    isLate: entry.isLate,
  };

  let changedFields = null;
  if (previous) {
    const tracked = ['description', 'projectId', 'remarks'];
    changedFields = {};
    for (const key of tracked) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(entry[key])) {
        changedFields[key] = { from: previous[key] ?? null, to: entry[key] ?? null };
      }
    }
    if (JSON.stringify(previous.attributes) !== JSON.stringify(entry.attributes)) {
      changedFields.attributes = { from: previous.attributes ?? null, to: entry.attributes ?? null };
    }
    if (!Object.keys(changedFields).length) return null; // nothing actually changed
  }

  const revision = await repo.nextRevisionNumber(entry.id, tx);

  return tx.taskEntryRevision.create({
    data: {
      entryId: entry.id,
      revision,
      action,
      snapshot,
      changedFields,
      reason: reason ?? null,
      actorId,
      departmentId: entry.departmentId,
      workDate: entry.workDate,
    },
  });
};

// ---------------------------------------------------------------------------
// Write: the whole grid at once ("Save all")
// ---------------------------------------------------------------------------

export const saveGrid = async (scope, user, { date, userId, entries }) => {
  const results = [];
  // Sequential, not Promise.all: these all upsert the SAME TaskDay row, and
  // concurrent upserts of one row is a deadlock generator in InnoDB. Seven
  // sequential writes inside one request is not the bottleneck anyone thinks it is.
  for (const entry of entries) {
    results.push(await saveEntry(scope, user, { date, userId, ...entry }));
  }
  return {
    saved: results.length,
    entries: results.map((r) => r.entry),
  };
};

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export const deleteEntry = async (scope, user, id, { reason }) => {
  const entry = await repo.findEntryById(id);
  if (!entry) throw new NotFoundError('Task entry');

  assertCanActOn(scope, { userId: entry.userId, departmentId: entry.departmentId });

  const viewingSomeoneElse = !isSelf(scope, entry.userId);
  assertMayWrite(user, viewingSomeoneElse);

  const day = await repo.findDayLite(entry.userId, entry.workDate);
  await assertDayEditable(user, day, entry.workDate, viewingSomeoneElse);

  await prisma.$transaction(async (tx) => {
    // Snapshot the deletion into history BEFORE removing the row — the revision
    // cascade-deletes with the entry, so we write the tombstone against a row
    // that still exists, then let it go.
    await writeRevision(tx, { entry, action: 'DELETE', previous: null, actorId: user.id, reason });

    await tx.taskEntry.delete({ where: { id } });

    const filledSlots = await tx.taskEntry.count({ where: { taskDayId: entry.taskDayId } });
    await tx.taskDay.update({ where: { id: entry.taskDayId }, data: { filledSlots } });

    await audit.recordInTransaction(tx, {
      action: 'TASK_DELETED',
      entityType: 'TaskEntry',
      entityId: id,
      departmentId: entry.departmentId,
      summary: `Deleted the ${entry.timeSlot.label} entry for ${formatWorkDate(entry.workDate)}${reason ? `. Reason: ${reason}` : ''}`,
      before: { description: entry.description, status: entry.status },
    });
  });

  return { id, deleted: true };
};

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export const getEntryHistory = async (scope, id) => {
  const entry = await repo.findEntryById(id);
  if (!entry) throw new NotFoundError('Task entry');

  assertCanActOn(scope, { userId: entry.userId, departmentId: entry.departmentId });

  const revisions = await repo.findRevisions(id);
  return {
    entry: toEntryDto(entry),
    revisions: revisions.map(toRevisionDto),
  };
};

// ---------------------------------------------------------------------------
// The approval state machine
// ---------------------------------------------------------------------------

const transition = async (tx, { day, to, actorId, note }) => {
  if (!canTransition(day.status, to)) {
    throw new ConflictError(`A ${day.status} sheet cannot move to ${to}`, {
      code: 'INVALID_TRANSITION',
      details: { from: day.status, to },
    });
  }

  const updated = await tx.taskDay.update({
    where: { id: day.id },
    data: {
      status: to,
      ...(to === DAY_STATUS.SUBMITTED ? { submittedAt: new Date() } : {}),
      ...(to === DAY_STATUS.APPROVED || to === DAY_STATUS.REJECTED
        ? { reviewedById: actorId, reviewedAt: new Date(), reviewNote: note ?? null }
        : {}),
      ...(to === DAY_STATUS.DRAFT
        ? { submittedAt: null, reviewedAt: null, reviewedById: null }
        : {}),
    },
    include: repo.DAY_INCLUDE,
  });

  await tx.taskDayTransition.create({
    data: { taskDayId: day.id, from: day.status, to, actorId, note: note ?? null },
  });

  return updated;
};

export const submitDay = async (scope, user, { date, userId }) => {
  const workDate = toWorkDate(date);
  const { target, viewingSomeoneElse } = await resolveTarget(scope, user, userId);

  if (viewingSomeoneElse) {
    throw new ForbiddenError('An employee must submit their own task sheet');
  }

  const day = await repo.findDayLite(target.id, workDate);
  if (!day) {
    throw new BadRequestError('There is nothing to submit — no work has been logged for this day', {
      code: 'NOTHING_TO_SUBMIT',
    });
  }

  // Read the REAL number of required columns rather than the department's
  // configured integer — if an admin added or retired an hour, the configured
  // number and the actual grid can disagree, and the employee would be told to
  // fill a column that does not exist.
  const required = Math.min(
    await countRequiredSlots(prisma, target.departmentId),
    target.department.requiredSlotsPerDay,
  );
  if (day.filledSlots < required) {
    throw new BadRequestError(
      `You have logged ${day.filledSlots} of ${required} required hours. Fill in the missing hours before submitting.`,
      {
        code: 'INCOMPLETE_SHEET',
        details: { filledSlots: day.filledSlots, requiredSlots: required },
      },
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await transition(tx, {
      day,
      to: DAY_STATUS.SUBMITTED,
      actorId: user.id,
    });

    await audit.recordInTransaction(tx, {
      action: 'TASK_DAY_SUBMITTED',
      entityType: 'TaskDay',
      entityId: day.id,
      departmentId: target.departmentId,
      summary: `Submitted the task sheet for ${formatWorkDate(workDate)} (${day.filledSlots}/${required} hours)`,
    });

    return result;
  });

  // Tell the lead there is something in their queue. Without this the approval
  // workflow depends on a Tech Lead remembering to go and look.
  const lead = await findTeamLead(target);
  if (lead && lead.id !== user.id) {
    void notify({
      userId: lead.id,
      type: 'SYSTEM',
      level: 'INFO',
      title: 'Task sheet awaiting your review',
      body: `${fullName(target)} submitted their sheet for ${formatWorkDate(workDate)}.`,
      link: `/monitor?userId=${target.id}&date=${formatWorkDate(workDate)}`,
      entityType: 'TaskDay',
      entityId: day.id,
    }).catch(() => {});
  }

  return toDayDto(updated);
};

const findTeamLead = async (target) => {
  if (!target.teamId) return null;
  const team = await prisma.team.findUnique({
    where: { id: target.teamId },
    select: { lead: { select: { id: true, email: true, firstName: true, status: true } } },
  });
  return team?.lead?.status === 'ACTIVE' ? team.lead : null;
};

/** Approve / Reject / Reopen. Tech Lead and Management only. */
export const reviewDay = async (scope, user, dayId, { decision, note }) => {
  const day = await prisma.taskDay.findUnique({
    where: { id: dayId },
    include: {
      user: { select: { id: true, firstName: true, lastName: true, email: true, status: true } },
    },
  });
  if (!day) throw new NotFoundError('Task sheet');

  assertCanActOn(scope, { departmentId: day.departmentId }, { allowSelf: false });

  // Reviewing your own sheet defeats the purpose of an approval step.
  if (day.userId === user.id) {
    throw new ForbiddenError('You cannot review your own task sheet', {
      code: 'SELF_REVIEW_FORBIDDEN',
    });
  }

  const targetStatus = {
    APPROVE: DAY_STATUS.APPROVED,
    REJECT: DAY_STATUS.REJECTED,
    REOPEN: DAY_STATUS.DRAFT,
  }[decision];

  const permissionForDecision = {
    APPROVE: PERMISSIONS.TASK_APPROVE,
    REJECT: PERMISSIONS.TASK_REJECT,
    REOPEN: PERMISSIONS.TASK_OVERRIDE_LOCK,
  }[decision];

  if (!can(user, permissionForDecision)) {
    throw new ForbiddenError(`You do not have permission to ${decision.toLowerCase()} task sheets`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await transition(tx, { day, to: targetStatus, actorId: user.id, note });

    await audit.recordInTransaction(tx, {
      action: {
        APPROVE: 'TASK_DAY_APPROVED',
        REJECT: 'TASK_DAY_REJECTED',
        REOPEN: 'TASK_DAY_REOPENED',
      }[decision],
      entityType: 'TaskDay',
      entityId: day.id,
      departmentId: day.departmentId,
      summary: `${decision === 'APPROVE' ? 'Approved' : decision === 'REJECT' ? 'Rejected' : 'Reopened'} ${fullName(day.user)}'s sheet for ${formatWorkDate(day.workDate)}${note ? `. Note: ${note}` : ''}`,
      before: { status: day.status },
      after: { status: targetStatus, note },
    });

    return result;
  });

  if (decision !== 'REOPEN') {
    void notify({
      userId: day.userId,
      type: decision === 'APPROVE' ? 'TASK_APPROVED' : 'TASK_REJECTED',
      level: decision === 'APPROVE' ? 'SUCCESS' : 'WARNING',
      title: decision === 'APPROVE' ? 'Task sheet approved' : 'Task sheet returned for changes',
      body:
        decision === 'APPROVE'
          ? `Your sheet for ${formatWorkDate(day.workDate)} was approved.`
          : `Your sheet for ${formatWorkDate(day.workDate)} needs changes.${note ? ` "${note}"` : ''}`,
      link: `/tasks?date=${formatWorkDate(day.workDate)}`,
      entityType: 'TaskDay',
      entityId: day.id,
      email: taskReviewedEmail({
        firstName: day.user.firstName,
        workDate: formatWorkDate(day.workDate),
        approved: decision === 'APPROVE',
        reviewerName: fullName(user),
        note,
      }),
    }).catch((error) => logger.warn('Review notification failed', { error: error.message }));
  }

  return toDayDto(updated);
};

// ---------------------------------------------------------------------------
// Monitoring / search
// ---------------------------------------------------------------------------

export const listEntries = async (scope, query) => {
  const { items, total, page, pageSize } = await repo.findEntries(scope, query);
  return { items: items.map(toEntryDto), total, page, pageSize };
};

export const listDays = async (scope, query) => {
  const { items, total, page, pageSize } = await repo.findDays(scope, query);
  return { items: items.map(toDayDto), total, page, pageSize };
};

/** The Tech Lead's approval queue: everything submitted and waiting. */
export const listPendingApprovals = async (scope, query) => {
  const result = await repo.findDays(scope, {
    ...query,
    status: DAY_STATUS.SUBMITTED,
    sortBy: 'submittedAt',
    sortOrder: 'asc', // oldest first — the thing that has been waiting longest
  });
  return { items: result.items.map(toDayDto), total: result.total, page: result.page, pageSize: result.pageSize };
};
