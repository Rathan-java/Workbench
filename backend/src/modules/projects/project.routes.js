import { Router } from 'express';
import { z } from 'zod';
import * as service from './project.service.js';
import { ok, created, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { paginationSchema } from '../../core/pagination.js';
import { PROJECT_STATUS_LIST } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

const listQuery = paginationSchema.extend({
  departmentId: z.string().cuid().optional(),
  status: z.enum(PROJECT_STATUS_LIST).optional(),
});

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(48)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  clientName: z.string().trim().max(160).optional().or(z.literal('')),
  status: z.enum(PROJECT_STATUS_LIST).default('ACTIVE'),
  startDate: z.string().date().optional().nullable(),
  endDate: z.string().date().optional().nullable(),
  departmentId: z.string().cuid(),
});

/**
 * `isInternal` is deliberately absent from both schemas: the department's
 * "Internal / Non-project" bucket is created with the department, not through
 * this API, and nobody gets to promote a client project into it or demote it out.
 */
const updateSchema = createSchema.partial();

const moduleParams = idParam.extend({ moduleId: z.string().cuid() });

const MODULE_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED'];

const moduleCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

/**
 * `completedAt` is absent on purpose: it is derived from the status transition
 * in the service, so a client can never claim a completion date for a module
 * that is not actually complete.
 */
const moduleUpdateSchema = moduleCreateSchema
  .partial()
  .extend({ status: z.enum(MODULE_STATUSES).optional() });

/**
 * @openapi
 * tags:
 *   name: Projects
 *   description: |
 *     Projects, scoped to a department. Employees can read the projects of their
 *     own department (they need them to tag a task); only Management can create
 *     or change them.
 *
 *     Every logged hour names exactly one project — never a module — and each
 *     department has an `isInternal` "Internal / Non-project" project so the
 *     hours that belong to no project have an honest home. Modules are a
 *     management-side breakdown of a project; assignments point at them, so
 *     nobody is asked to classify their own hours.
 *
 *     There is no delete. A project that has collected hours cannot be removed
 *     without disturbing them, so projects are retired with `status: ARCHIVED` —
 *     it leaves the picker, and every hour logged against it stays attributable.
 */

/**
 * @openapi
 * /projects:
 *   get:
 *     tags: [Projects]
 *     summary: List projects (scoped, paginated)
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 *   post:
 *     tags: [Projects]
 *     summary: Create a project
 *     responses:
 *       201: { description: Project created }
 */
router
  .route('/')
  .get(
    authorize(PERMISSIONS.PROJECT_READ),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const { items, ...pagination } = await service.list(req.scope, req.query);
      return paginated(res, items, pagination);
    }),
  )
  .post(
    authorize(PERMISSIONS.PROJECT_MANAGE),
    validate({ body: createSchema }),
    asyncHandler(async (req, res) =>
      created(res, await service.create(req.scope, req.body), { message: 'Project created' }),
    ),
  );

/**
 * @openapi
 * /projects/options:
 *   get:
 *     tags: [Projects]
 *     summary: Active projects for the task-entry picker
 *     description: |
 *       Includes the department's `isInternal` project — it must be selectable,
 *       because a task entry cannot be saved without a project.
 *     responses:
 *       200: { description: Active projects, each flagged with isInternal }
 */
router.get(
  '/options',
  authorize(PERMISSIONS.PROJECT_READ),
  validate({ query: z.object({ departmentId: z.string().cuid().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.options(req.scope, req.query))),
);

/**
 * @openapi
 * /projects/{id}:
 *   get:
 *     tags: [Projects]
 *     summary: One project
 *     responses:
 *       200: { description: Project }
 *   patch:
 *     tags: [Projects]
 *     summary: Update a project
 *     description: |
 *       On the `isInternal` project, `code` is ignored and any `status` other
 *       than `ACTIVE` is rejected — archiving it would make it unselectable,
 *       which for a required field is the same as deleting it. Its name and
 *       description are freely editable.
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Attempted to archive the Internal / Non-project project }
 */
router
  .route('/:id')
  .get(
    authorize(PERMISSIONS.PROJECT_READ),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => ok(res, await service.getById(req.scope, req.params.id))),
  )
  .patch(
    authorize(PERMISSIONS.PROJECT_MANAGE),
    validate({ params: idParam, body: updateSchema }),
    asyncHandler(async (req, res) =>
      ok(res, await service.update(req.scope, req.params.id, req.body), {
        message: 'Project updated',
      }),
    ),
  )
  /**
   * @openapi
   * /projects/{id}:
   *   delete:
   *     tags: [Projects]
   *     summary: Delete an empty, mistakenly-created project
   *     description: |
   *       Only removes a project with NO logged hours. A project with work behind
   *       it is refused (409) and must be ARCHIVED instead, which preserves every
   *       hour. The Internal / Non-project catch-all can never be deleted.
   *     responses:
   *       200: { description: Deleted }
   *       409: { description: Project has logged work, or is the Internal project }
   */
  .delete(
    authorize(PERMISSIONS.PROJECT_MANAGE),
    validate({ params: idParam }),
    asyncHandler(async (req, res) =>
      ok(res, await service.destroy(req.scope, req.params.id), { message: 'Project deleted' }),
    ),
  );

/**
 * @openapi
 * /projects/{id}/modules:
 *   get:
 *     tags: [Projects]
 *     summary: The modules of a project
 *     description: |
 *       Ordered by `sortOrder`, then name. Includes retired modules
 *       (`isActive: false`) so the assignments still hanging off them stay
 *       visible; each carries its assignment count and the number of hourly
 *       entries logged through those assignments.
 *     responses:
 *       200: { description: Modules }
 *       404: { description: Project not found }
 *   post:
 *     tags: [Projects]
 *     summary: Add a module to a project
 *     description: |
 *       `sortOrder` defaults to the end of the list. Module names are unique
 *       within a project, retired ones included.
 *     responses:
 *       201: { description: Module created }
 *       409: { description: A module of that name already exists on the project }
 */
/**
 * @openapi
 * /projects/{id}/assignable:
 *   get:
 *     tags: [Projects]
 *     summary: Who can be given work on this project, and who is already on it
 *     description: |
 *       Returns every active person in the project's department, members first,
 *       each flagged `isMember` with the hours they have logged against it.
 *
 *       Deliberately NOT filtered to members only: a new project has no members
 *       by definition, and a members-only list would make it impossible to put
 *       the first person on it.
 *     responses:
 *       200: { description: Assignable people, members first }
 */
router.get(
  '/:id/assignable',
  authorize(PERMISSIONS.ASSIGNMENT_READ),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await service.listAssignable(req.scope, req.params.id))),
);

/**
 * @openapi
 * /projects/{id}/members:
 *   post:
 *     tags: [Projects]
 *     summary: Put somebody on this project
 *     description: Idempotent. Refuses anyone outside the project's department.
 *     responses:
 *       200: { description: Added, or already a member }
 *       400: { description: Wrong department, or the account is not active }
 */
router.post(
  '/:id/members',
  authorize(PERMISSIONS.ASSIGNMENT_CREATE),
  validate({ params: idParam, body: z.object({ userId: z.string().cuid() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.addMember(req.scope, req.params.id, req.body.userId, req.user);
    return ok(res, result, {
      message: result.alreadyMember ? 'Already on this project' : 'Added to the project',
    });
  }),
);

/**
 * @openapi
 * /projects/{id}/members/{userId}:
 *   delete:
 *     tags: [Projects]
 *     summary: Take somebody off this project
 *     description: |
 *       Removes the membership only. Every hour they logged and every assignment
 *       they hold stay exactly as they are — membership is a statement about now,
 *       not a record of what was done.
 *     responses:
 *       200: { description: Removed }
 */
router.delete(
  '/:id/members/:userId',
  authorize(PERMISSIONS.PROJECT_MANAGE),
  validate({ params: idParam.extend({ userId: z.string().cuid() }) }),
  asyncHandler(async (req, res) =>
    ok(res, await service.removeMember(req.scope, req.params.id, req.params.userId, req.user), {
      message: 'Removed from the project',
    }),
  ),
);

router
  .route('/:id/modules')
  .get(
    authorize(PERMISSIONS.PROJECT_READ),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => ok(res, await service.listModules(req.scope, req.params.id))),
  )
  .post(
    authorize(PERMISSIONS.PROJECT_MANAGE),
    validate({ params: idParam, body: moduleCreateSchema }),
    asyncHandler(async (req, res) =>
      created(res, await service.addModule(req.scope, req.params.id, req.body), {
        message: 'Module added',
      }),
    ),
  );

/**
 * @openapi
 * /projects/{id}/modules/{moduleId}:
 *   patch:
 *     tags: [Projects]
 *     summary: Update a module
 *     description: |
 *       Moving `status` to `COMPLETED` stamps `completedAt`; moving it away
 *       clears the stamp again, so a completion date never outlives the
 *       completion it describes.
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Module not found on this project }
 *       409: { description: A module of that name already exists on the project }
 *   delete:
 *     tags: [Projects]
 *     summary: Remove a module
 *     description: |
 *       A module with assignments behind it is RETIRED (`isActive: false`), not
 *       deleted — deleting it would cut those assignments loose from the
 *       deliverable they advance. One with no assignments is deleted outright.
 *       The response says which happened: `{ retired: true }` or `{ deleted: true }`.
 *     responses:
 *       200: { description: Module deleted or retired }
 *       404: { description: Module not found on this project }
 */
router
  .route('/:id/modules/:moduleId')
  .patch(
    authorize(PERMISSIONS.PROJECT_MANAGE),
    validate({ params: moduleParams, body: moduleUpdateSchema }),
    asyncHandler(async (req, res) =>
      ok(res, await service.updateModule(req.scope, req.params.id, req.params.moduleId, req.body), {
        message: 'Module updated',
      }),
    ),
  )
  .delete(
    authorize(PERMISSIONS.PROJECT_MANAGE),
    validate({ params: moduleParams }),
    asyncHandler(async (req, res) => {
      const result = await service.removeModule(req.scope, req.params.id, req.params.moduleId);
      return ok(res, result, { message: result.retired ? 'Module retired' : 'Module deleted' });
    }),
  );

export default router;
