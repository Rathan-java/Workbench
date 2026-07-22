/**
 * Departments.
 *
 * This module serves the CONFIGURATION that makes each department's task entry
 * screen different: its working-hour columns (TimeSlot) and its bespoke task
 * fields (TaskFieldDefinition). The frontend renders the grid from this payload
 * rather than shipping four hand-written screens — so "Digital Marketing now
 * tracks ad spend" is a seed row, not a sprint.
 */
import { prisma } from '../../config/prisma.js';
import { NotFoundError, ForbiddenError, ConflictError, BadRequestError } from '../../core/errors.js';
import { SCOPE_KIND } from '../../core/accessScope.js';
import { logger } from '../../config/logger.js';
import { minutesToLabel } from '../../utils/date.js';
import { invalidateAttributeSchema } from '../tasks/taskAttributes.js';
import * as audit from '../audit/audit.service.js';

const DEPARTMENT_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  colorHex: true,
  icon: true,
  isActive: true,
  sortOrder: true,
  requiredSlotsPerDay: true,
  workingWeekdays: true,
  aiAnalysisEnabled: true,
  slotIntervalMinutes: true,
  dayStartMinute: true,
  dayEndMinute: true,
  breakStartMinute: true,
  breakEndMinute: true,
};

/**
 * Departments visible to the caller.
 *
 * Management sees all four (this is what populates their department dropdown).
 * Everyone else sees exactly one: their own. There is no query parameter that
 * changes that — the scope decides, not the request.
 */
export const listVisible = async (scope, { includeInactive = false } = {}) => {
  // Deactivating a department must not be a ONE-WAY DOOR. Without an
  // `includeInactive` option, a retired department vanishes from the only screen
  // that could bring it back — the admin has hidden it from themselves, for good.
  const activeFilter = includeInactive ? {} : { isActive: true };

  const where =
    scope.kind === SCOPE_KIND.GLOBAL
      ? activeFilter
      : { id: scope.departmentId ?? '__none__', ...activeFilter };

  const departments = await prisma.department.findMany({
    where,
    select: {
      ...DEPARTMENT_SELECT,
      _count: { select: { users: { where: { status: 'ACTIVE' } }, teams: true, projects: true } },
    },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });

  return departments.map(({ _count, ...d }) => ({
    ...d,
    stats: { employees: _count.users, teams: _count.teams, projects: _count.projects },
  }));
};

export const listAll = () =>
  prisma.department.findMany({
    select: DEPARTMENT_SELECT,
    orderBy: [{ sortOrder: 'asc' }],
  });

/**
 * Everything the task-entry screen needs to render itself for one department.
 * One round trip; cached hard on the client (this changes about once a year).
 */
export const getConfig = async (departmentId, scope) => {
  if (!scope.isGlobal && scope.departmentId !== departmentId) {
    throw new ForbiddenError('You do not have access to that department');
  }

  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: {
      ...DEPARTMENT_SELECT,
      timeSlots: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          label: true,
          startMinute: true,
          endMinute: true,
          sortOrder: true,
          isBreak: true,
          // Without this the client cannot distinguish an OPTIONAL overtime column
          // from a required one — and an overtime column that looks required is an
          // overtime column that quietly becomes mandatory.
          isOvertime: true,
        },
      },
      fieldDefinitions: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          key: true,
          label: true,
          type: true,
          isRequired: true,
          options: true,
          placeholder: true,
          helpText: true,
          maxLength: true,
          minValue: true,
          maxValue: true,
          defaultValue: true,
          showInTable: true,
          sortOrder: true,
        },
      },
    },
  });

  if (!department) throw new NotFoundError('Department');

  return department;
};

/** Resolve a department by its stable code — used by seeds and integrations. */
export const findByCode = (code) =>
  prisma.department.findUnique({ where: { code }, select: DEPARTMENT_SELECT });

export const getById = async (id, scope) => {
  if (!scope.isGlobal && scope.departmentId !== id) {
    throw new ForbiddenError('You do not have access to that department');
  }
  const department = await prisma.department.findUnique({
    where: { id },
    select: DEPARTMENT_SELECT,
  });
  if (!department) throw new NotFoundError('Department');
  return department;
};

/** Management only (gated by DEPARTMENT_MANAGE at the route). */
export const update = async (id, input) => {
  const before = await prisma.department.findUnique({ where: { id }, select: DEPARTMENT_SELECT });
  if (!before) throw new NotFoundError('Department');

  const department = await prisma.department.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description ?? null,
      colorHex: input.colorHex,
      icon: input.icon ?? null,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      requiredSlotsPerDay: input.requiredSlotsPerDay,
      workingWeekdays: input.workingWeekdays,
      // Absent from the payload means "leave it alone" — an older client that
      // does not know about this field must not silently switch analysis back on.
      aiAnalysisEnabled: input.aiAnalysisEnabled ?? undefined,
    },
    select: DEPARTMENT_SELECT,
  });

  const { before: b, after: a } = audit.diff(before, department);
  audit.record({
    action: 'DEPARTMENT_UPDATED',
    entityType: 'Department',
    entityId: id,
    departmentId: id,
    summary: `Department "${department.name}" updated`,
    before: b,
    after: a,
  });

  return department;
};

/**
 * The time slots for a department, ordered. Hot path — every task grid read and
 * every reminder job needs these — so it is a narrow, index-served query.
 */
export const getTimeSlots = (departmentId, { includeBreaks = true, includeOvertime = true } = {}) =>
  prisma.timeSlot.findMany({
    where: {
      departmentId,
      isActive: true,
      ...(includeBreaks ? {} : { isBreak: false }),
      ...(includeOvertime ? {} : { isOvertime: false }),
    },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      label: true,
      startMinute: true,
      endMinute: true,
      sortOrder: true,
      isBreak: true,
      isOvertime: true,
    },
  });

export const getFieldDefinitions = (departmentId) =>
  prisma.taskFieldDefinition.findMany({
    where: { departmentId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

// ---------------------------------------------------------------------------
// Department CRUD — departments are DATA, so they can be created and removed
// ---------------------------------------------------------------------------

/**
 * Create a department, along with its working hours and its bespoke task fields.
 *
 * This is the payoff for modelling departments as rows rather than as an enum:
 * a fifth department is a form submission, not a release. The new department's
 * employees immediately get a task grid with its own columns and its own fields,
 * and it appears in Management's dropdowns — with no code change anywhere.
 */
export const create = async (input, actor) => {
  const department = await prisma.$transaction(async (tx) => {
    const created = await tx.department.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description || null,
        colorHex: input.colorHex,
        icon: input.icon || null,
        sortOrder: input.sortOrder ?? 99,
        requiredSlotsPerDay: input.requiredSlotsPerDay,
        workingWeekdays: input.workingWeekdays,
        aiAnalysisEnabled: input.aiAnalysisEnabled ?? true,
        timeSlots: {
          create: (input.timeSlots ?? []).map((slot, index) => ({
            // Derive the label from the minutes when the caller omits it. The
            // minutes are the truth; the label is a rendering of them. Making the
            // client compute "10:00 - 11:00" would let the two drift, and a column
            // headed 10:00 that actually spans 11:00 is worse than no column.
            label: slot.label?.trim() || labelForMinutes(slot.startMinute, slot.endMinute),
            startMinute: slot.startMinute,
            endMinute: slot.endMinute,
            isBreak: slot.isBreak ?? false,
            isOvertime: slot.isOvertime ?? false,
            sortOrder: index,
          })),
        },
        fieldDefinitions: {
          create: (input.fields ?? []).map((field, index) => ({
            key: field.key,
            label: field.label,
            type: field.type,
            isRequired: field.isRequired ?? false,
            options: field.options ?? undefined,
            placeholder: field.placeholder || null,
            helpText: field.helpText || null,
            maxLength: field.maxLength ?? null,
            minValue: field.minValue ?? null,
            maxValue: field.maxValue ?? null,
            showInTable: field.showInTable ?? false,
            sortOrder: index,
          })),
        },
      },
      select: DEPARTMENT_SELECT,
    });

    // THE INTERNAL PROJECT. Created here, in the same transaction, and NOT as a
    // nice-to-have.
    //
    // TaskEntry.projectId is NOT NULL. A department without a project is a
    // department whose employees physically cannot log an hour — the very first
    // person to open their task sheet on day one would find an empty, required
    // dropdown and no way forward. And even once real projects exist, the
    // all-hands, the induction, the interview panel belong to none of them.
    //
    // A required field with no honest answer does not get left blank. It gets
    // filled in with a lie, and the lie lands in the project reports. So every
    // department is born with somewhere true to put those hours.
    await tx.project.create({
      data: {
        departmentId: created.id,
        code: 'INTERNAL',
        name: 'Internal / Non-project',
        description:
          'Meetings, admin, training, interviews, support — work that genuinely belongs to no project.',
        status: 'ACTIVE',
        isInternal: true,
      },
    });

    await audit.recordInTransaction(tx, {
      action: 'DEPARTMENT_CREATED',
      entityType: 'Department',
      entityId: created.id,
      departmentId: created.id,
      summary: `Created department "${created.name}" with ${input.timeSlots?.length ?? 0} working hours and ${input.fields?.length ?? 0} custom fields`,
      after: { code: created.code, name: created.name },
    });

    return created;
  });

  invalidateAttributeSchema(department.id);
  logger.info('Department created', { departmentId: department.id, by: actor.id });
  return department;
};

/**
 * Delete a department.
 *
 * A department with people, teams, projects or logged work in it CANNOT be
 * deleted — and that is not timidity, it is the only correct answer. Deleting it
 * would either orphan months of timesheets or cascade them into oblivion, and
 * "where did the Marketing team's Q2 go?" is not a conversation anybody wants to
 * have. The API says exactly what is in the way, so the admin can clear it.
 *
 * To retire a department that still holds history, DEACTIVATE it: it disappears
 * from every dropdown and no new work can be logged against it, while every row
 * that references it stays intact and reportable.
 */
export const remove = async (id, actor) => {
  const department = await prisma.department.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      code: true,
      _count: {
        select: {
          users: true,
          teams: true,
          taskEntries: true,
          // REAL projects only. Every department is born with an "Internal /
          // Non-project" project (see create), so counting projects naively would
          // mean every department has one, and NO department could ever be
          // deleted again — a permanent blocker created by the system itself.
          projects: { where: { isInternal: false } },
        },
      },
    },
  });
  if (!department) throw new NotFoundError('Department');

  const { users, teams, projects, taskEntries } = department._count;
  const blockers = [
    users && `${users} employee(s)`,
    teams && `${teams} team(s)`,
    projects && `${projects} project(s)`,
    taskEntries && `${taskEntries} logged task(s)`,
  ].filter(Boolean);

  if (blockers.length) {
    throw new ConflictError(
      `"${department.name}" still contains ${blockers.join(', ')}. Move or remove them first, or deactivate the department instead — deactivating hides it everywhere while preserving its history.`,
      { code: 'DEPARTMENT_NOT_EMPTY', details: { blockers: department._count } },
    );
  }

  await prisma.$transaction(async (tx) => {
    // The department is provably empty: no people, no teams, no real projects and
    // — the one that matters — NO LOGGED HOURS. So the only thing left pointing at
    // it is the internal project the system itself created, which by definition
    // has nothing behind it. Removing it destroys no record of any work.
    //
    // Project.department is onDelete: Restrict, so this is not optional: skip it
    // and the delete below fails with a raw foreign-key error.
    await tx.project.deleteMany({ where: { departmentId: id, isInternal: true } });

    // Time slots and field definitions cascade with the department — they are
    // meaningless without it and reference nothing else.
    await tx.department.delete({ where: { id } });

    await audit.recordInTransaction(tx, {
      action: 'DEPARTMENT_DELETED',
      entityType: 'Department',
      entityId: id,
      summary: `Deleted department "${department.name}" (${department.code}). It was empty — no employees, no teams, no projects and no logged work.`,
      before: { code: department.code, name: department.name },
    });
  });

  invalidateAttributeSchema(id);
  logger.warn('Department deleted', { departmentId: id, name: department.name, by: actor.id });
  return { id, deleted: true };
};

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

const labelForMinutes = (start, end) => `${minutesToLabel(start)} - ${minutesToLabel(end)}`;

export const addTimeSlot = async (departmentId, input, scope) => {
  if (!scope.isGlobal && scope.departmentId !== departmentId) {
    throw new ForbiddenError('You do not have access to that department');
  }

  const clash = await prisma.timeSlot.findFirst({
    where: {
      departmentId,
      isActive: true,
      // Any overlap at all. Two columns covering the same minute would let the
      // same hour of work be logged twice and counted twice in every report.
      startMinute: { lt: input.endMinute },
      endMinute: { gt: input.startMinute },
    },
    select: { label: true },
  });
  if (clash) {
    throw new ConflictError(`That time overlaps the existing "${clash.label}" column`, {
      code: 'TIME_SLOT_OVERLAP',
    });
  }

  const last = await prisma.timeSlot.findFirst({
    where: { departmentId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const slot = await prisma.timeSlot.create({
    data: {
      departmentId,
      label: input.label || labelForMinutes(input.startMinute, input.endMinute),
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      isBreak: input.isBreak ?? false,
      isOvertime: input.isOvertime ?? false,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  audit.record({
    action: 'DEPARTMENT_UPDATED',
    entityType: 'TimeSlot',
    entityId: slot.id,
    departmentId,
    summary: `Added the "${slot.label}" column${slot.isOvertime ? ' (overtime)' : ''}`,
  });

  return slot;
};

/**
 * The "+" at the end of the task grid.
 *
 * Appends the NEXT hour after the department's current last column, flagged as
 * overtime. An employee who is still working at 18:00 clicks it, gets an 18:00–19:00
 * column, and logs what they did — instead of silently having nowhere to put it,
 * which is how overtime becomes invisible to the company.
 *
 * The new column is shared with the department (they work the same shift), but it
 * is EXCLUDED from `expectedSlots`, so it never becomes mandatory: filling it does
 * not inflate anyone's compliance, and not filling it does not damage it.
 */
export const addOvertimeSlot = async (departmentId, scope) => {
  if (!scope.isGlobal && scope.departmentId !== departmentId) {
    throw new ForbiddenError('You do not have access to that department');
  }

  const last = await prisma.timeSlot.findFirst({
    where: { departmentId, isActive: true },
    orderBy: { endMinute: 'desc' },
    select: { endMinute: true, sortOrder: true },
  });

  if (!last) {
    throw new BadRequestError('This department has no working hours configured yet');
  }

  const startMinute = last.endMinute;
  const endMinute = startMinute + 60;

  // A day is 1440 minutes. Refuse to roll past midnight — an "overtime" column
  // labelled 00:00–01:00 belongs to the NEXT calendar day, and silently filing it
  // under today would corrupt every date-bounded report in the system.
  if (endMinute > 1440) {
    throw new BadRequestError(
      'The working day already reaches midnight. Work past midnight belongs to the next day’s sheet.',
      { code: 'DAY_BOUNDARY' },
    );
  }

  const existing = await prisma.timeSlot.findUnique({
    where: { departmentId_startMinute: { departmentId, startMinute } },
  });
  if (existing) {
    // Someone else already added it (or it was deactivated). Reactivate rather
    // than erroring — the user's intent is satisfied either way.
    if (!existing.isActive) {
      return prisma.timeSlot.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return existing;
  }

  return addTimeSlot(
    departmentId,
    {
      startMinute,
      endMinute,
      label: labelForMinutes(startMinute, endMinute),
      isOvertime: true,
    },
    scope,
  );
};

/**
 * UNDO an extra hour.
 *
 * The "+" that adds an overtime column is available to every employee, so its
 * undo must be too — adding a column you cannot remove is a trap, not a feature.
 * But the permission stops well short of the Management-only DELETE on real
 * working hours: this removes ONLY an overtime column, and ONLY while it is
 * still empty.
 *
 * "Empty" means no entries from ANYONE, not just the caller. An overtime column
 * is department-wide, so a colleague may already have logged against it — and
 * the one rule this whole system refuses to break is destroying a record of work
 * that was actually done. If there is anything behind the column, the undo is
 * declined with a reason, and the person clears their own entry first.
 */
export const removeOvertimeSlot = async (departmentId, slotId, scope) => {
  if (!scope.isGlobal && scope.departmentId !== departmentId) {
    throw new ForbiddenError('You do not have access to that department');
  }

  const slot = await prisma.timeSlot.findFirst({
    where: { id: slotId, departmentId },
    select: { id: true, label: true, isOvertime: true, _count: { select: { entries: true } } },
  });
  if (!slot) throw new NotFoundError('Time slot');

  // A regular working hour is not an employee's to remove — that is a department
  // configuration change, and it lives behind DEPARTMENT_MANAGE on the DELETE
  // route. This path exists only to take back an EXTRA hour.
  if (!slot.isOvertime) {
    throw new ForbiddenError('Only an extra (overtime) hour can be removed here.');
  }

  if (slot._count.entries > 0) {
    throw new ConflictError(
      'This extra hour already has work logged against it. Clear the entry first, then remove the hour.',
      { code: 'OVERTIME_SLOT_IN_USE' },
    );
  }

  await prisma.timeSlot.delete({ where: { id: slotId } });
  return { id: slotId, deleted: true, message: 'Extra hour removed.' };
};

export const updateTimeSlot = async (departmentId, slotId, input) => {
  const slot = await prisma.timeSlot.findFirst({ where: { id: slotId, departmentId } });
  if (!slot) throw new NotFoundError('Time slot');

  // The SAME overlap guard as addTimeSlot. Enforcing it on create but not on
  // update is how you end up with two columns both owning 14:00 — the same hour
  // of work logged twice, and counted twice in every report. Excludes itself.
  const start = input.startMinute ?? slot.startMinute;
  const end = input.endMinute ?? slot.endMinute;

  if (end <= start) {
    throw new BadRequestError('The hour must end after it starts');
  }

  const clash = await prisma.timeSlot.findFirst({
    where: {
      departmentId,
      isActive: true,
      id: { not: slotId },
      startMinute: { lt: end },
      endMinute: { gt: start },
    },
    select: { label: true },
  });
  if (clash) {
    throw new ConflictError(`That time overlaps the existing "${clash.label}" column`, {
      code: 'TIME_SLOT_OVERLAP',
    });
  }

  return prisma.timeSlot.update({
    where: { id: slotId },
    data: {
      label: input.label,
      startMinute: input.startMinute,
      endMinute: input.endMinute,
      isBreak: input.isBreak,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });
};

/**
 * Retire a working-hour column.
 *
 * SOFT delete when work has already been logged against it: hard-deleting the
 * column would cascade away those entries, silently erasing real work. The column
 * simply stops appearing on new grids.
 */
export const removeTimeSlot = async (departmentId, slotId) => {
  const slot = await prisma.timeSlot.findFirst({
    where: { id: slotId, departmentId },
    select: { id: true, label: true, _count: { select: { entries: true } } },
  });
  if (!slot) throw new NotFoundError('Time slot');

  if (slot._count.entries > 0) {
    await prisma.timeSlot.update({ where: { id: slotId }, data: { isActive: false } });
    return {
      id: slotId,
      retired: true,
      message: `"${slot.label}" has ${slot._count.entries} logged entries, so it has been retired rather than deleted. It will no longer appear on new task sheets, and the existing work is untouched.`,
    };
  }

  await prisma.timeSlot.delete({ where: { id: slotId } });
  return { id: slotId, deleted: true };
};

// ---------------------------------------------------------------------------
// The logging cadence
// ---------------------------------------------------------------------------

/**
 * Work out the columns a given working day and interval produce.
 *
 * Pure: no database, no side effects, so the preview an administrator approves
 * and the rebuild that follows are computed by the same code. A preview produced
 * by different logic from the write is not a preview, it is a guess.
 */
export const planTimeSlots = ({
  dayStartMinute,
  dayEndMinute,
  slotIntervalMinutes,
  breakStartMinute,
  breakEndMinute,
}) => {
  const hasBreak =
    Number.isInteger(breakStartMinute) &&
    Number.isInteger(breakEndMinute) &&
    breakEndMinute > breakStartMinute;

  const blocks = [];
  let cursor = dayStartMinute;
  let guard = 0;

  while (cursor < dayEndMinute) {
    // A runaway here would write rows until the disk filled. The bounds below
    // make it unreachable; this makes it unreachable twice.
    if ((guard += 1) > 96) break;

    if (hasBreak && cursor === breakStartMinute) {
      blocks.push({ startMinute: breakStartMinute, endMinute: breakEndMinute, isBreak: true });
      cursor = breakEndMinute;
      continue;
    }

    let end = Math.min(cursor + slotIntervalMinutes, dayEndMinute);

    // Never run a working block THROUGH the break: truncate at its start and let
    // the next iteration emit the break itself. This is what allows an interval
    // that does not divide the morning evenly — the short block lands before
    // lunch, where it is legible, instead of swallowing it.
    if (hasBreak && cursor < breakStartMinute && end > breakStartMinute) end = breakStartMinute;

    blocks.push({ startMinute: cursor, endMinute: end, isBreak: false });
    cursor = end;
  }

  return blocks.map((b, i) => ({
    ...b,
    sortOrder: i,
    label: b.isBreak ? 'Lunch' : `${minutesToLabel(b.startMinute)} - ${minutesToLabel(b.endMinute)}`,
  }));
};

const assertValidCadence = (c) => {
  const { dayStartMinute: s, dayEndMinute: e, slotIntervalMinutes: i } = c;

  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > 1440 || e <= s) {
    throw new BadRequestError('The working day must start before it ends, within one calendar day', {
      code: 'INVALID_WORKING_DAY',
    });
  }
  if (!Number.isInteger(i) || i < 15 || i > 480) {
    throw new BadRequestError('A logging block must be between 15 minutes and 8 hours', {
      code: 'INVALID_INTERVAL',
    });
  }
  const hasBreak = c.breakStartMinute != null || c.breakEndMinute != null;
  if (hasBreak) {
    if (!Number.isInteger(c.breakStartMinute) || !Number.isInteger(c.breakEndMinute)) {
      throw new BadRequestError('A break needs both a start and an end', { code: 'INVALID_BREAK' });
    }
    if (c.breakEndMinute <= c.breakStartMinute || c.breakStartMinute < s || c.breakEndMinute > e) {
      throw new BadRequestError('The break must fall inside the working day', {
        code: 'INVALID_BREAK',
      });
    }
  }
};

/**
 * Regenerate a department's grid columns from its working day and interval.
 *
 * ── WHAT THIS WILL NOT DO ───────────────────────────────────────────────────
 *
 * It will not delete an hour that somebody has logged work against. A column
 * the new layout has no place for is RETIRED (isActive: false), exactly as
 * removeTimeSlot does: it stops appearing on new sheets, and every entry behind
 * it stays readable, exportable and attributable. Only genuinely empty columns
 * are deleted. That is what makes this safe to run on a live department — the
 * worst case is a tidier grid and some retired history, never lost work.
 *
 * Columns that survive unchanged are MATCHED, not recreated, so their ids hold
 * and today's entries keep pointing at the same row.
 *
 * Overtime columns are left completely alone: they sit beyond the working day by
 * definition, they are added by employees rather than administrators, and
 * sweeping them up here would delete an hour somebody worked late to log.
 *
 * @param {string} departmentId
 * @param {object} input cadence + `dryRun`
 */
export const rebuildTimeSlots = async (departmentId, input, actor) => {
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: DEPARTMENT_SELECT,
  });
  if (!department) throw new NotFoundError('Department');

  const cadence = {
    dayStartMinute: input.dayStartMinute ?? department.dayStartMinute,
    dayEndMinute: input.dayEndMinute ?? department.dayEndMinute,
    slotIntervalMinutes: input.slotIntervalMinutes ?? department.slotIntervalMinutes,
    breakStartMinute:
      input.breakStartMinute === undefined ? department.breakStartMinute : input.breakStartMinute,
    breakEndMinute:
      input.breakEndMinute === undefined ? department.breakEndMinute : input.breakEndMinute,
  };
  assertValidCadence(cadence);

  const planned = planTimeSlots(cadence);
  const working = planned.filter((p) => !p.isBreak);
  if (!working.length) {
    throw new BadRequestError('That working day and interval produce no hours to log', {
      code: 'EMPTY_GRID',
    });
  }

  const existing = await prisma.timeSlot.findMany({
    where: { departmentId, isOvertime: false },
    select: {
      id: true,
      label: true,
      startMinute: true,
      endMinute: true,
      isBreak: true,
      isActive: true,
      _count: { select: { entries: true } },
    },
  });

  /**
   * Rows are matched by START TIME, not by the whole span — because the schema
   * says `@@unique([departmentId, startMinute])`. A department has at most one
   * column beginning at 10:00, ever, active or retired. So "retire 10:00-11:00
   * and create 10:00-12:00" is not a thing the database will allow; the row that
   * starts at 10:00 is re-spanned in place.
   */
  const byStart = new Map(existing.map((s) => [s.startMinute, s]));
  const plannedStarts = new Set(planned.map((p) => p.startMinute));

  const reused = [];   // same start, same span — nothing changes but the ordering
  const adjusted = []; // same start, DIFFERENT span — the column is re-spanned
  const created = [];

  for (const p of planned) {
    const match = byStart.get(p.startMinute);
    if (!match) created.push(p);
    else if (match.endMinute === p.endMinute && match.isBreak === p.isBreak) reused.push({ match, p });
    else adjusted.push({ match, p });
  }

  const orphans = existing.filter((s) => !plannedStarts.has(s.startMinute));
  const toRetire = orphans.filter((s) => s._count.entries > 0 && s.isActive);
  const toDelete = orphans.filter((s) => s._count.entries === 0);

  const summary = {
    interval: cadence.slotIntervalMinutes,
    day: `${minutesToLabel(cadence.dayStartMinute)} - ${minutesToLabel(cadence.dayEndMinute)}`,
    columns: planned.map((p) => ({ label: p.label, isBreak: p.isBreak })),
    requiredSlotsPerDay: working.length,
    unchanged: reused.length,
    created: created.length,
    deleted: toDelete.length,
    retired: toRetire.map((s) => ({ label: s.label, entries: s._count.entries })),
    /**
     * Surfaced separately, and deliberately: an existing column that carries
     * logged work and is being re-spanned means an hour somebody already
     * recorded will afterwards be labelled with a different span. No entry is
     * lost, but the label above it changes, and an administrator should be told
     * that before they press the button rather than discover it in a report.
     */
    adjusted: adjusted
      .filter(({ match }) => match._count.entries > 0)
      .map(({ match, p }) => ({ from: match.label, to: p.label, entries: match._count.entries })),
  };

  // A preview runs the real planner and the real diff, and then stops.
  if (input.dryRun) return { ...summary, applied: false };

  await prisma.$transaction(async (tx) => {
    if (toDelete.length) {
      await tx.timeSlot.deleteMany({ where: { id: { in: toDelete.map((s) => s.id) } } });
    }
    if (toRetire.length) {
      await tx.timeSlot.updateMany({
        where: { id: { in: toRetire.map((s) => s.id) } },
        data: { isActive: false },
      });
    }
    for (const { match, p } of [...reused, ...adjusted]) {
      await tx.timeSlot.update({
        where: { id: match.id },
        data: {
          label: p.label,
          endMinute: p.endMinute,
          isBreak: p.isBreak,
          sortOrder: p.sortOrder,
          isActive: true,
        },
      });
    }
    for (const p of created) {
      await tx.timeSlot.create({
        data: {
          departmentId,
          label: p.label,
          startMinute: p.startMinute,
          endMinute: p.endMinute,
          isBreak: p.isBreak,
          sortOrder: p.sortOrder,
        },
      });
    }
    await tx.department.update({
      where: { id: departmentId },
      data: {
        ...cadence,
        // The requirement follows the grid. Leaving it at 7 after halving the
        // number of columns would mark every single employee non-compliant
        // forever, and nobody would connect it to this change.
        requiredSlotsPerDay: working.length,
      },
    });
  });

  audit.record({
    action: 'DEPARTMENT_UPDATED',
    entityType: 'Department',
    entityId: departmentId,
    summary: `Logging cadence for "${department.name}" set to every ${cadence.slotIntervalMinutes} minutes (${summary.day}) — ${working.length} columns`,
    before: {
      slotIntervalMinutes: department.slotIntervalMinutes,
      dayStartMinute: department.dayStartMinute,
      dayEndMinute: department.dayEndMinute,
      requiredSlotsPerDay: department.requiredSlotsPerDay,
    },
    after: { ...cadence, requiredSlotsPerDay: working.length },
    actorId: actor?.id,
  });

  logger.info('Time slots rebuilt', { departmentId, ...summary });
  return { ...summary, applied: true };
};

// ---------------------------------------------------------------------------
// Department-specific task fields
// ---------------------------------------------------------------------------

export const addField = async (departmentId, input) => {
  const last = await prisma.taskFieldDefinition.findFirst({
    where: { departmentId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  const field = await prisma.taskFieldDefinition.create({
    data: {
      departmentId,
      key: input.key,
      label: input.label,
      type: input.type,
      isRequired: input.isRequired ?? false,
      options: input.options ?? undefined,
      placeholder: input.placeholder || null,
      helpText: input.helpText || null,
      maxLength: input.maxLength ?? null,
      minValue: input.minValue ?? null,
      maxValue: input.maxValue ?? null,
      showInTable: input.showInTable ?? false,
      sortOrder: (last?.sortOrder ?? -1) + 1,
    },
  });

  // The compiled Zod schema for this department is now stale.
  invalidateAttributeSchema(departmentId);
  return field;
};

export const updateField = async (departmentId, fieldId, input) => {
  const existing = await prisma.taskFieldDefinition.findFirst({
    where: { id: fieldId, departmentId },
  });
  if (!existing) throw new NotFoundError('Field');

  // The KEY is immutable once data exists under it. Renaming it would orphan
  // every `attributes` value already stored, turning them into invisible garbage
  // that no report can find and no admin can explain.
  if (input.key && input.key !== existing.key) {
    const inUse = await prisma.taskEntry.count({
      where: { departmentId, attributes: { not: null } },
    });
    if (inUse > 0) {
      throw new ConflictError(
        'The field key cannot be changed once tasks have been logged against it — the existing values would be orphaned. Change the LABEL instead; it is what users actually see.',
        { code: 'FIELD_KEY_IMMUTABLE' },
      );
    }
  }

  const field = await prisma.taskFieldDefinition.update({
    where: { id: fieldId },
    data: {
      key: input.key,
      label: input.label,
      type: input.type,
      isRequired: input.isRequired,
      options: input.options ?? undefined,
      placeholder: input.placeholder !== undefined ? input.placeholder || null : undefined,
      helpText: input.helpText !== undefined ? input.helpText || null : undefined,
      maxLength: input.maxLength,
      minValue: input.minValue,
      maxValue: input.maxValue,
      showInTable: input.showInTable,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
  });

  invalidateAttributeSchema(departmentId);
  return field;
};

/** Soft delete: the field vanishes from the form, but its stored values remain. */
export const removeField = async (departmentId, fieldId) => {
  const field = await prisma.taskFieldDefinition.findFirst({
    where: { id: fieldId, departmentId },
  });
  if (!field) throw new NotFoundError('Field');

  await prisma.taskFieldDefinition.update({
    where: { id: fieldId },
    data: { isActive: false },
  });

  invalidateAttributeSchema(departmentId);
  return { id: fieldId, retired: true };
};
