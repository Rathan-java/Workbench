/**
 * Task repository. Prisma only — no policy, no permissions, no audit.
 *
 * Note every list method takes `scope` first. See accessScope.js for why that is
 * not a style preference.
 */
import { prisma } from '../../config/prisma.js';
import { scopedWhereWithFilters } from '../../core/accessScope.js';
import { and, buildOrderBy, buildSearchFilter, toPrismaPage } from '../../core/pagination.js';
import { toWorkDate, startOfMonth, endOfMonth } from '../../utils/date.js';

const PERSON = { select: { id: true, firstName: true, lastName: true, avatarPath: true } };

// NOTE: employeeName / employeeCode are plain scalar columns on TaskEntry and
// TaskDay, so Prisma returns them by default with `include` (which selects all
// scalars). They are what keeps a deleted employee's preserved work attributable.
// employeeName is selected implicitly by include.
export const ENTRY_INCLUDE = {
  timeSlot: { select: { id: true, label: true, startMinute: true, endMinute: true, sortOrder: true } },
  project: { select: { id: true, code: true, name: true, isInternal: true } },
  user: { select: { id: true, firstName: true, lastName: true, avatarPath: true, employeeCode: true } },
  createdBy: PERSON,
  updatedBy: PERSON,
  _count: { select: { revisions: true } },
};

export const DAY_INCLUDE = {
  user: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      avatarPath: true,
      designation: true,
    },
  },
  department: { select: { id: true, code: true, name: true, colorHex: true } },
  team: { select: { id: true, name: true } },
  reviewedBy: PERSON,
};

const SORTABLE_ENTRIES = ['workDate', 'createdAt', 'updatedAt', 'isLate'];
const SORTABLE_DAYS = ['workDate', 'status', 'filledSlots', 'submittedAt', 'reviewedAt'];
const SEARCHABLE_ENTRIES = [
  'description',
  'remarks',
  'user.firstName',
  'user.lastName',
  'user.employeeCode',
  'project.name',
  'project.code',
];

/**
 * Translate the API's date filters into one Prisma predicate.
 * Supports an explicit range OR the month/year shorthand a manager actually
 * thinks in ("show me March").
 */
export const buildDateFilter = ({ dateFrom, dateTo, month, year }) => {
  if (dateFrom || dateTo) {
    return {
      workDate: {
        ...(dateFrom ? { gte: toWorkDate(dateFrom) } : {}),
        ...(dateTo ? { lte: toWorkDate(dateTo) } : {}),
      },
    };
  }

  if (year && month) {
    const anchor = toWorkDate(`${year}-${String(month).padStart(2, '0')}-01`);
    return { workDate: { gte: startOfMonth(anchor), lte: endOfMonth(anchor) } };
  }

  if (year) {
    return {
      workDate: { gte: toWorkDate(`${year}-01-01`), lte: toWorkDate(`${year}-12-31`) },
    };
  }

  return undefined;
};

export const findDay = (userId, workDate, client = prisma) =>
  client.taskDay.findUnique({
    where: { userId_workDate: { userId, workDate } },
    include: {
      ...DAY_INCLUDE,
      entries: { include: ENTRY_INCLUDE, orderBy: { timeSlot: { sortOrder: 'asc' } } },
    },
  });

export const findDayLite = (userId, workDate, client = prisma) =>
  client.taskDay.findUnique({
    where: { userId_workDate: { userId, workDate } },
    select: {
      id: true,
      userId: true,
      departmentId: true,
      teamId: true,
      workDate: true,
      status: true,
      filledSlots: true,
      expectedSlots: true,
    },
  });

export const findEntryById = (id, client = prisma) =>
  client.taskEntry.findUnique({
    where: { id },
    include: { ...ENTRY_INCLUDE, taskDay: { select: { id: true, status: true, userId: true } } },
  });

export const findEntryBySlot = (taskDayId, timeSlotId, client = prisma) =>
  client.taskEntry.findUnique({
    where: { taskDayId_timeSlotId: { taskDayId, timeSlotId } },
  });

/** The monitoring / search grid. Every filter from the brief, server-side. */
export const findEntries = async (scope, query, client = prisma) => {
  const { skip, take, page, pageSize } = toPrismaPage(query);

  const where = and(
    scopedWhereWithFilters(scope, {
      departmentId: query.departmentId,
      teamId: query.teamId,
      userId: query.userId,
    }),
    buildSearchFilter(query.search, SEARCHABLE_ENTRIES),
    buildDateFilter(query),
    query.projectId ? { projectId: query.projectId } : undefined,
    query.isLate !== undefined ? { isLate: query.isLate } : undefined,
    query.editedByLead !== undefined ? { editedByLead: query.editedByLead } : undefined,
    query.dayStatus ? { taskDay: { status: query.dayStatus } } : undefined,
  );

  const [items, total] = await client.$transaction([
    client.taskEntry.findMany({
      where,
      include: ENTRY_INCLUDE,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE_ENTRIES, [
        { workDate: 'desc' },
        { timeSlot: { sortOrder: 'asc' } },
      ]),
      skip,
      take,
    }),
    client.taskEntry.count({ where }),
  ]);

  return { items, total, page, pageSize };
};

/** Day-level list — backs the Tech Lead's approval queue. */
export const findDays = async (scope, query, client = prisma) => {
  const { skip, take, page, pageSize } = toPrismaPage(query);

  const where = and(
    scopedWhereWithFilters(scope, {
      departmentId: query.departmentId,
      teamId: query.teamId,
      userId: query.userId,
    }),
    buildDateFilter(query),
    query.status ? { status: query.status } : undefined,
    query.incompleteOnly ? { filledSlots: { lt: prisma.taskDay.fields.expectedSlots } } : undefined,
    query.search
      ? {
          user: {
            OR: [
              { firstName: { contains: query.search } },
              { lastName: { contains: query.search } },
              { employeeCode: { contains: query.search } },
            ],
          },
        }
      : undefined,
  );

  const [items, total] = await client.$transaction([
    client.taskDay.findMany({
      where,
      include: DAY_INCLUDE,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE_DAYS, [
        { workDate: 'desc' },
        { user: { firstName: 'asc' } },
      ]),
      skip,
      take,
    }),
    client.taskDay.count({ where }),
  ]);

  return { items, total, page, pageSize };
};

export const findRevisions = (entryId, client = prisma) =>
  client.taskEntryRevision.findMany({
    where: { entryId },
    include: { actor: PERSON },
    orderBy: { revision: 'desc' },
  });

/** Entries for one user on one date, keyed by slot — used to recompute counters. */
export const countFilledSlots = (taskDayId, client = prisma) =>
  client.taskEntry.count({
    where: { taskDayId, description: { not: '' } },
  });

export const nextRevisionNumber = async (entryId, client = prisma) => {
  const last = await client.taskEntryRevision.findFirst({
    where: { entryId },
    orderBy: { revision: 'desc' },
    select: { revision: true },
  });
  return (last?.revision ?? 0) + 1;
};
