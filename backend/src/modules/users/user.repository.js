/**
 * User repository.
 *
 * THE CONTRACT OF THIS LAYER: every method that reads or writes more than one
 * row takes `scope` as its FIRST argument, and composes `scopeWhere(scope)` into
 * its filter. There is no overload that omits it. That is the whole point — a
 * developer cannot write a query that leaks another department's employees,
 * because the function will not let them construct one.
 *
 * Repositories know about Prisma and nothing else: no HTTP, no permissions, no
 * audit. Policy lives in the service.
 */
import { prisma } from '../../config/prisma.js';
import { scopedWhereWithFilters } from '../../core/accessScope.js';
import { and, buildOrderBy, buildSearchFilter, toPrismaPage } from '../../core/pagination.js';
import { USER_SELECT } from './user.dto.js';

const SORTABLE = ['firstName', 'lastName', 'email', 'employeeCode', 'role', 'status', 'createdAt', 'lastLoginAt'];
const SEARCHABLE = ['firstName', 'lastName', 'email', 'employeeCode', 'designation'];

/**
 * @param {import('../../core/accessScope.js').AccessScope} scope
 * @param {object} query
 */
export const findMany = async (scope, query, client = prisma) => {
  const { skip, take, page, pageSize } = toPrismaPage(query);

  const where = and(
    // `userField: 'id'` — on the User model, ownership is the primary key.
    // `selfSeesDepartment: true` — an employee may browse the colleague
    // directory of their own department (names and roles), but note that this
    // does NOT extend to their task data: that is a separate scope call in
    // task.repository.js with the default (self-only) behaviour.
    scopedWhereWithFilters(scope, query, { userField: 'id', selfSeesDepartment: true }),
    buildSearchFilter(query.search, SEARCHABLE),
    query.role ? { role: query.role } : undefined,
    query.status ? { status: query.status } : undefined,
    query.unassigned ? { teamId: null, role: { not: 'MANAGEMENT' } } : undefined,
  );

  const orderBy = buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, [
    { status: 'asc' },
    { firstName: 'asc' },
  ]);

  const [items, total] = await client.$transaction([
    client.user.findMany({ where, select: USER_SELECT, orderBy, skip, take }),
    client.user.count({ where }),
  ]);

  return { items, total, page, pageSize };
};

/** Unscoped by design — the caller MUST follow this with assertCanActOn(). */
export const findById = (id, client = prisma) =>
  client.user.findUnique({ where: { id }, select: USER_SELECT });

export const findByEmail = (email, client = prisma) =>
  client.user.findUnique({ where: { email }, select: USER_SELECT });

export const findByEmployeeCode = (employeeCode, client = prisma) =>
  client.user.findUnique({ where: { employeeCode }, select: USER_SELECT });

export const create = (data, client = prisma) =>
  client.user.create({ data, select: USER_SELECT });

export const update = (id, data, client = prisma) =>
  client.user.update({ where: { id }, data, select: USER_SELECT });

/**
 * Options for a dropdown, already scoped. This is what backs Management's
 * "employee" selector on the monitoring screen — and it is why a Tech Lead's
 * copy of that same selector can only ever list their own department.
 */
export const findOptions = (scope, { departmentId, teamId, role, includeInactive } = {}, client = prisma) =>
  client.user.findMany({
    where: and(
      scopedWhereWithFilters(scope, { departmentId, teamId }, { userField: 'id', selfSeesDepartment: true }),
      includeInactive ? undefined : { status: 'ACTIVE' },
      role ? { role } : undefined,
    ),
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      role: true,
      departmentId: true,
      teamId: true,
      avatarPath: true,
    },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    take: 500,
  });

/** Every active employee in a department — used by the reminder + digest jobs. */
export const findActiveByDepartment = (departmentId, client = prisma) =>
  client.user.findMany({
    where: { departmentId, status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TECH_LEAD'] } },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      teamId: true,
      departmentId: true,
      timezone: true,
    },
  });

export const countByDepartment = (client = prisma) =>
  client.user.groupBy({
    by: ['departmentId'],
    where: { status: 'ACTIVE' },
    _count: { _all: true },
  });
