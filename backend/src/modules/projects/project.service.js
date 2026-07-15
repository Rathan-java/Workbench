/**
 * Projects — the index every logged hour hangs off.
 *
 * There is exactly ONE level. A project has no modules, no epics, no
 * sub-anything: each extra level is one more dropdown an employee has to get
 * right at 6pm before they can go home, and the questions management actually
 * asks — how is this project going, who is on it, what did they do — are all
 * answerable from one level.
 *
 * `TaskEntry.projectId` is NOT NULL, so every hour must name a project. That is
 * only an honest requirement because every department owns an "Internal /
 * Non-project" project (`isInternal`), which is the truthful home for the hours
 * that belong to no client project. That row is therefore load-bearing, and the
 * rules below refuse to let it be archived or have its identity edited away.
 *
 * NOTHING HERE HARD-DELETES A PROJECT. `TaskEntry.project` is `onDelete:
 * Restrict` precisely so a project can never be pulled out from under the hours
 * logged against it. Retiring a project is `status = ARCHIVED`: it leaves the
 * picker, no new work can be logged against it, and every hour ever booked to it
 * stays attributable forever.
 */
import { prisma } from '../../config/prisma.js';
import { scopedWhereWithFilters, assertCanActOn } from '../../core/accessScope.js';
import { and, buildOrderBy, buildSearchFilter, toPrismaPage } from '../../core/pagination.js';
import { NotFoundError, BadRequestError } from '../../core/errors.js';
import * as audit from '../audit/audit.service.js';

const PROJECT_SELECT = {
  id: true,
  code: true,
  name: true,
  description: true,
  status: true,
  clientName: true,
  startDate: true,
  endDate: true,
  // Exposed so the UI can render the department's non-project bucket distinctly
  // and hide the destructive controls on it — it is infrastructure, not data.
  isInternal: true,
  departmentId: true,
  createdAt: true,
  department: { select: { id: true, code: true, name: true, colorHex: true } },
  _count: { select: { entries: true } },
};

const toDto = ({ _count, ...p }) => ({ ...p, entryCount: _count.entries });

const SORTABLE = ['name', 'code', 'status', 'createdAt', 'startDate', 'endDate'];
const SEARCHABLE = ['name', 'code', 'clientName', 'description'];

export const list = async (scope, query) => {
  const { skip, take, page, pageSize } = toPrismaPage(query);

  const where = and(
    // Projects are reference data every employee needs in order to tag a task,
    // so SELF scope widens to the employee's own department here.
    scopedWhereWithFilters(scope, { departmentId: query.departmentId }, { selfSeesDepartment: true }),
    buildSearchFilter(query.search, SEARCHABLE),
    query.status ? { status: query.status } : undefined,
  );

  const [items, total] = await prisma.$transaction([
    prisma.project.findMany({
      where,
      select: PROJECT_SELECT,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, { name: 'asc' }),
      skip,
      take,
    }),
    prisma.project.count({ where }),
  ]);

  return { items: items.map(toDto), total, page, pageSize };
};

/**
 * Options for the task-entry project picker. Only ACTIVE projects — you cannot
 * log new work against an archived project, and offering it in the dropdown is
 * how dirty data gets created.
 *
 * The department's internal project is ACTIVE by rule (see `update`), so it is
 * always in this list. It has to be: `projectId` is required, so a picker that
 * could not offer "Internal / Non-project" would force people to lie.
 */
export const options = (scope, { departmentId } = {}) =>
  prisma.project.findMany({
    where: and(
      scopedWhereWithFilters(scope, { departmentId }, { selfSeesDepartment: true }),
      { status: 'ACTIVE' },
    ),
    select: {
      id: true,
      code: true,
      name: true,
      isInternal: true,
      departmentId: true,
    },
    orderBy: { name: 'asc' },
  });

export const getById = async (scope, id) => {
  const project = await prisma.project.findUnique({ where: { id }, select: PROJECT_SELECT });
  if (!project) throw new NotFoundError('Project');
  assertCanActOn(scope, { departmentId: project.departmentId }, { allowSelf: false });
  return toDto(project);
};

export const create = async (scope, input) => {
  if (!scope.isGlobal && input.departmentId !== scope.departmentId) {
    throw new BadRequestError('You can only create projects within your own department');
  }
  if (input.startDate && input.endDate && new Date(input.endDate) < new Date(input.startDate)) {
    throw new BadRequestError('The end date cannot be before the start date');
  }

  const project = await prisma.$transaction(async (tx) => {
    const createdProject = await tx.project.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description || null,
        clientName: input.clientName || null,
        status: input.status,
        startDate: input.startDate ? new Date(input.startDate) : null,
        endDate: input.endDate ? new Date(input.endDate) : null,
        departmentId: input.departmentId,
      },
      select: PROJECT_SELECT,
    });

    await audit.recordInTransaction(tx, {
      action: 'PROJECT_CREATED',
      entityType: 'Project',
      entityId: createdProject.id,
      departmentId: createdProject.departmentId,
      summary: `Created project "${createdProject.name}" (${createdProject.code})`,
      after: { code: createdProject.code, name: createdProject.name, status: createdProject.status },
    });

    return createdProject;
  });

  return toDto(project);
};

export const update = async (scope, id, input) => {
  const before = await prisma.project.findUnique({ where: { id }, select: PROJECT_SELECT });
  if (!before) throw new NotFoundError('Project');
  assertCanActOn(scope, { departmentId: before.departmentId }, { allowSelf: false });

  if (input.departmentId && input.departmentId !== before.departmentId) {
    throw new BadRequestError(
      'A project cannot be moved to another department — its logged tasks would end up on the wrong side of the departmental boundary.',
      { code: 'PROJECT_DEPARTMENT_IMMUTABLE' },
    );
  }

  const patch = { ...input };

  if (before.isInternal) {
    /**
     * Archiving the internal project is deleting it by another name: it drops
     * out of the picker, and since every task entry MUST name a project, the
     * hours that genuinely belong to no project would have nowhere honest to go.
     * People would start booking them to a real client project instead, which
     * quietly corrupts every report that project appears in.
     */
    if (patch.status && patch.status !== 'ACTIVE') {
      throw new BadRequestError(
        'The "Internal / Non-project" project must stay ACTIVE. Archiving it would remove it from the task-entry picker, and because every logged hour must name a project, the hours that belong to no project would have nowhere honest to go.',
        { code: 'INTERNAL_PROJECT_MUST_STAY_ACTIVE' },
      );
    }

    /**
     * `code` and `isInternal` are its identity: the seed and department creation
     * find this row by them, and `isInternal` is the only thing that marks it as
     * the fallback at all. Silently dropped rather than rejected, because the
     * fields a manager actually meant to edit — name, description — are still
     * applied. Wording is cosmetic; identity is not.
     */
    delete patch.code;
    delete patch.isInternal;
  }

  const project = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({
      where: { id },
      data: {
        code: patch.code,
        name: patch.name,
        description: patch.description !== undefined ? patch.description || null : undefined,
        clientName: patch.clientName !== undefined ? patch.clientName || null : undefined,
        status: patch.status,
        startDate: patch.startDate !== undefined ? (patch.startDate ? new Date(patch.startDate) : null) : undefined,
        endDate: patch.endDate !== undefined ? (patch.endDate ? new Date(patch.endDate) : null) : undefined,
      },
      select: PROJECT_SELECT,
    });

    const { before: b, after: a } = audit.diff(before, updated);
    if (Object.keys(a).length) {
      await audit.recordInTransaction(tx, {
        action: 'PROJECT_UPDATED',
        entityType: 'Project',
        entityId: id,
        departmentId: updated.departmentId,
        summary: `Project "${updated.name}" updated`,
        before: b,
        after: a,
      });
    }
    return updated;
  });

  return toDto(project);
};
