/**
 * Projects — the index every logged hour hangs off.
 *
 * For the person LOGGING an hour there is still exactly one level: the entry
 * names a project and nothing else. Each extra required dropdown is one more
 * thing to get right at 6pm before they can go home.
 *
 * Modules are the parts a project is made of, and they sit on the management
 * side of that line: an assignment may name the module it advances, so the
 * module's progress is derived from work that was already going to be recorded.
 * Nobody is asked to classify their own hours into one.
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
import { NotFoundError, BadRequestError, ConflictError } from '../../core/errors.js';
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

const MODULE_SELECT = {
  id: true,
  name: true,
  description: true,
  status: true,
  sortOrder: true,
  isActive: true,
  completedAt: true,
  createdAt: true,
  _count: { select: { assignments: true } },
};

const MODULE_ORDER = [{ sortOrder: 'asc' }, { name: 'asc' }];

const toModuleDto = ({ _count, ...m }) => ({ ...m, assignmentCount: _count.assignments });

const toDto = ({ _count, modules, ...p }) => ({
  ...p,
  entryCount: _count.entries,
  ...(modules ? { modules: modules.map(toModuleDto) } : {}),
});

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
  const project = await prisma.project.findUnique({
    where: { id },
    select: {
      ...PROJECT_SELECT,
      // Only on the single-project read: the drawer renders these, the list does
      // not, and paying for them per row in `list` would be a needless join.
      modules: { where: { isActive: true }, select: MODULE_SELECT, orderBy: MODULE_ORDER },
    },
  });
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

/**
 * Delete a project — but ONLY one created by mistake, with nothing behind it.
 *
 * The safe way to retire a project that has real work in it is to ARCHIVE it:
 * every logged hour points at a project (projectId is NOT NULL), so a hard delete
 * of a project with hours would either destroy that work or orphan it, and this
 * whole system's first rule is that a record of work done never disappears.
 *
 * So this refuses in exactly two cases, and allows the rest:
 *   · the "Internal / Non-project" catch-all — it is structural, not a project
 *     someone created, and the department cannot function without it;
 *   · any project with even one logged hour — pointed firmly at Archive instead.
 *
 * What is left is the genuine case this exists for: a typo, a duplicate, a
 * project made in the wrong department and never used. That can simply go.
 */
export const destroy = async (scope, id) => {
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, code: true, departmentId: true, isInternal: true },
  });
  if (!project) throw new NotFoundError('Project');
  assertCanActOn(scope, { departmentId: project.departmentId }, { allowSelf: false });

  if (project.isInternal) {
    throw new ConflictError(
      'The "Internal / Non-project" project cannot be deleted — every department needs it as the home for non-project hours.',
      { code: 'INTERNAL_PROJECT_UNDELETABLE' },
    );
  }

  const loggedHours = await prisma.taskEntry.count({ where: { projectId: id } });
  if (loggedHours > 0) {
    throw new ConflictError(
      `"${project.name}" has ${loggedHours} logged ${loggedHours === 1 ? 'hour' : 'hours'} behind it. Deleting it would erase that work. Archive it instead — it leaves the task-entry picker and every hour is preserved.`,
      { code: 'PROJECT_HAS_WORK', details: { loggedHours } },
    );
  }

  await prisma.$transaction(async (tx) => {
    // Audit FIRST, inside the transaction — a crash between delete and audit
    // must never leave a project gone with no trace it existed.
    await audit.recordInTransaction(tx, {
      action: 'PROJECT_DELETED',
      entityType: 'Project',
      entityId: id,
      departmentId: project.departmentId,
      summary: `Deleted project "${project.name}" (${project.code}). It had no logged work.`,
      before: { code: project.code, name: project.name, departmentId: project.departmentId },
    });

    await tx.project.delete({ where: { id } });
  });

  return { id, deleted: true };
};

// ---------------------------------------------------------------------------
// Modules — the parts a project is made of
//
// There is no MODULE_* audit action (AuditAction is a real DB enum and an
// invented value throws), so module changes are audited as PROJECT_UPDATED with
// the module named in the summary.
// ---------------------------------------------------------------------------

const loadProjectForModules = async (scope, projectId) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, departmentId: true },
  });
  if (!project) throw new NotFoundError('Project');
  assertCanActOn(scope, { departmentId: project.departmentId }, { allowSelf: false });
  return project;
};

const loadModule = async (projectId, moduleId) => {
  const module = await prisma.projectModule.findFirst({
    where: { id: moduleId, projectId },
    select: MODULE_SELECT,
  });
  if (!module) throw new NotFoundError('Module');
  return module;
};

/**
 * Retired modules are included: they still hold assignments and hours, and a
 * manager looking at the list needs to see where that work went. `isActive`
 * tells the UI to render them as retired rather than offer them for new work.
 */
export const listModules = async (scope, projectId) => {
  await loadProjectForModules(scope, projectId);

  const modules = await prisma.projectModule.findMany({
    where: { projectId },
    select: MODULE_SELECT,
    orderBy: MODULE_ORDER,
  });
  if (!modules.length) return [];

  // Hours land on the assignment, not the module, so the count has to come back
  // through the assignments. One extra query for the whole page, not one each.
  const assignments = await prisma.assignment.findMany({
    where: { moduleId: { in: modules.map((m) => m.id) } },
    select: { moduleId: true, _count: { select: { entries: true } } },
  });

  const loggedByModule = new Map();
  for (const a of assignments) {
    loggedByModule.set(a.moduleId, (loggedByModule.get(a.moduleId) ?? 0) + a._count.entries);
  }

  return modules.map((m) => ({ ...toModuleDto(m), loggedEntryCount: loggedByModule.get(m.id) ?? 0 }));
};

export const addModule = async (scope, projectId, input) => {
  const project = await loadProjectForModules(scope, projectId);

  const clash = await prisma.projectModule.findFirst({
    where: { projectId, name: input.name },
    select: { id: true, isActive: true },
  });
  if (clash) {
    throw new ConflictError(
      clash.isActive
        ? `"${project.name}" already has a module called "${input.name}".`
        : `"${input.name}" already exists on "${project.name}" but has been retired. Rename this one, or reactivate the existing module so its history stays attached.`,
      { code: 'MODULE_NAME_TAKEN', details: { moduleId: clash.id, isActive: clash.isActive } },
    );
  }

  let sortOrder = input.sortOrder;
  if (sortOrder === undefined) {
    const last = await prisma.projectModule.findFirst({
      where: { projectId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }

  const module = await prisma.$transaction(async (tx) => {
    const createdModule = await tx.projectModule.create({
      data: {
        projectId,
        name: input.name,
        description: input.description || null,
        sortOrder,
      },
      select: MODULE_SELECT,
    });

    await audit.recordInTransaction(tx, {
      action: 'PROJECT_UPDATED',
      entityType: 'ProjectModule',
      entityId: createdModule.id,
      departmentId: project.departmentId,
      summary: `Module "${createdModule.name}" added to project "${project.name}"`,
      after: { name: createdModule.name, status: createdModule.status, sortOrder: createdModule.sortOrder },
    });

    return createdModule;
  });

  return toModuleDto(module);
};

export const updateModule = async (scope, projectId, moduleId, input) => {
  const project = await loadProjectForModules(scope, projectId);
  const before = await loadModule(projectId, moduleId);

  if (input.name && input.name !== before.name) {
    const clash = await prisma.projectModule.findFirst({
      where: { projectId, name: input.name, id: { not: moduleId } },
      select: { id: true },
    });
    if (clash) {
      throw new ConflictError(`"${project.name}" already has a module called "${input.name}".`, {
        code: 'MODULE_NAME_TAKEN',
        details: { moduleId: clash.id },
      });
    }
  }

  /**
   * `completedAt` is the honest answer to "when was this finished", so it is
   * derived from the status transition and never accepted from the client. If
   * the module is reopened the old date is cleared rather than kept — a
   * completion date on something still in progress is a lie the reports believe.
   */
  let completedAt;
  if (input.status && input.status !== before.status) {
    completedAt = input.status === 'COMPLETED' ? new Date() : null;
  }

  const module = await prisma.$transaction(async (tx) => {
    const updated = await tx.projectModule.update({
      where: { id: moduleId },
      data: {
        name: input.name,
        description: input.description !== undefined ? input.description || null : undefined,
        status: input.status,
        sortOrder: input.sortOrder,
        completedAt,
      },
      select: MODULE_SELECT,
    });

    const { before: b, after: a } = audit.diff(before, updated);
    if (Object.keys(a).length) {
      const summary =
        input.status && input.status !== before.status
          ? `Module "${updated.name}" marked ${updated.status} on project "${project.name}"`
          : `Module "${updated.name}" updated on project "${project.name}"`;

      await audit.recordInTransaction(tx, {
        action: 'PROJECT_UPDATED',
        entityType: 'ProjectModule',
        entityId: moduleId,
        departmentId: project.departmentId,
        summary,
        before: b,
        after: a,
      });
    }
    return updated;
  });

  return toModuleDto(module);
};

/**
 * Remove a module — soft once anything has been assigned against it.
 *
 * `Assignment.moduleId` is `SetNull`, so a hard delete would not fail: it would
 * quietly cut every assignment loose from the deliverable it was advancing, and
 * nothing would ever be able to say which part of the project that work was for.
 * A module with assignments behind it is therefore retired (`isActive = false`):
 * it stops being offered for new work and every link it holds survives.
 *
 * A module created by mistake, with nothing pointing at it, can simply go.
 */
export const removeModule = async (scope, projectId, moduleId) => {
  const project = await loadProjectForModules(scope, projectId);
  const module = await loadModule(projectId, moduleId);
  const assignmentCount = module._count.assignments;

  await prisma.$transaction(async (tx) => {
    await audit.recordInTransaction(tx, {
      action: 'PROJECT_UPDATED',
      entityType: 'ProjectModule',
      entityId: moduleId,
      departmentId: project.departmentId,
      summary: assignmentCount
        ? `Module "${module.name}" retired on project "${project.name}" (${assignmentCount} assignments kept)`
        : `Module "${module.name}" deleted from project "${project.name}". It had no assignments.`,
      before: { name: module.name, status: module.status, assignmentCount },
    });

    if (assignmentCount > 0) {
      await tx.projectModule.update({ where: { id: moduleId }, data: { isActive: false } });
    } else {
      await tx.projectModule.delete({ where: { id: moduleId } });
    }
  });

  if (assignmentCount > 0) {
    return {
      id: moduleId,
      retired: true,
      message: `"${module.name}" has ${assignmentCount} ${assignmentCount === 1 ? 'assignment' : 'assignments'} behind it, so it has been retired rather than deleted. It will no longer be offered for new work, and the existing assignments and their hours are untouched.`,
    };
  }

  return { id: moduleId, deleted: true };
};
