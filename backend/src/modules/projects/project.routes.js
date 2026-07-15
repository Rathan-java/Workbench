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

/**
 * @openapi
 * tags:
 *   name: Projects
 *   description: |
 *     Projects, scoped to a department. Employees can read the projects of their
 *     own department (they need them to tag a task); only Management can create
 *     or change them.
 *
 *     A project has no sub-level — no modules, no epics. Every logged hour names
 *     exactly one project, and each department has an `isInternal` "Internal /
 *     Non-project" project so the hours that belong to no project have an honest
 *     home.
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
  );

export default router;
