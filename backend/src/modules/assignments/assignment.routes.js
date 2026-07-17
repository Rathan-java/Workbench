import { Router } from 'express';
import { z } from 'zod';
import * as service from './assignment.service.js';
import { ok, created, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { paginationSchema } from '../../core/pagination.js';
import { queryBoolean } from '../../core/zod.js';
import {
  ASSIGNMENT_STATUSES,
  ASSIGNMENT_PRIORITY_LIST,
  ASSIGNMENT_PRIORITY,
  ASSIGNMENT_TITLE_MIN,
  ASSIGNMENT_TITLE_MAX,
  ASSIGNMENT_DESCRIPTION_MAX,
} from '../../config/constants.js';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

const listQuery = paginationSchema.extend({
  status: z.enum(ASSIGNMENT_STATUSES).optional(),
  priority: z.enum(ASSIGNMENT_PRIORITY_LIST).optional(),
  projectId: z.string().cuid().optional(),
  assigneeId: z.string().cuid().optional(),
  departmentId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  /** Open work only (ASSIGNED / IN_PROGRESS / SUBMITTED). */
  open: queryBoolean(),
  /** Past due and still open — the "at risk" filter. */
  overdue: queryBoolean(),
  /** Assigned to me. */
  mine: queryBoolean(),
});

const createSchema = z.object({
  assigneeId: z.string().cuid(),
  projectId: z.string().cuid(),
  title: z.string().trim().min(ASSIGNMENT_TITLE_MIN).max(ASSIGNMENT_TITLE_MAX),
  description: z.string().trim().max(ASSIGNMENT_DESCRIPTION_MAX).optional().or(z.literal('')),
  priority: z.enum(ASSIGNMENT_PRIORITY_LIST).default(ASSIGNMENT_PRIORITY.NORMAL),
  dueDate: z.string().date().optional().nullable(),
  estimatedHours: z.coerce.number().int().min(1).max(2000).optional().nullable(),
});

/** Reassigning and moving departments are deliberately absent — an assignment's
 *  assignee and department are fixed at creation, like a TaskEntry's owner. */
const updateSchema = z.object({
  title: z.string().trim().min(ASSIGNMENT_TITLE_MIN).max(ASSIGNMENT_TITLE_MAX).optional(),
  description: z.string().trim().max(ASSIGNMENT_DESCRIPTION_MAX).optional().nullable().or(z.literal('')),
  priority: z.enum(ASSIGNMENT_PRIORITY_LIST).optional(),
  dueDate: z.string().date().optional().nullable(),
  estimatedHours: z.coerce.number().int().min(1).max(2000).optional().nullable(),
  version: z.coerce.number().int().optional(),
});

const submitSchema = z.object({ note: z.string().trim().max(1000).optional() });
const reviewSchema = z.object({
  decision: z.enum(['DONE', 'REOPEN']),
  note: z.string().trim().max(1000).optional(),
});
const cancelSchema = z.object({ reason: z.string().trim().max(1000).optional() });

/**
 * @openapi
 * tags:
 *   name: Assignments
 *   description: |
 *     Forward-looking assigned work. A Tech Lead / Manager assigns a task to an
 *     employee for a project; the hours the employee logs against it (via
 *     TaskEntry.assignmentId) become its progress thread. Completion is a
 *     handshake: the employee submits, the lead confirms done.
 *
 *     Scope is structural — an employee sees only assignments assigned to them, a
 *     lead only their department's, management all. There is no delete: an
 *     assignment is CANCELLED, never removed, so the logged hours and the trail
 *     of who assigned what survive.
 */

/**
 * @openapi
 * /assignments:
 *   get:
 *     tags: [Assignments]
 *     summary: List assignments (scoped, paginated)
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 *   post:
 *     tags: [Assignments]
 *     summary: Assign a task to an employee
 *     responses:
 *       201: { description: Assignment created }
 */
router
  .route('/')
  .get(
    authorize(PERMISSIONS.ASSIGNMENT_READ),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const { items, ...pagination } = await service.list(req.scope, req.query);
      return paginated(res, items, pagination);
    }),
  )
  .post(
    authorize(PERMISSIONS.ASSIGNMENT_CREATE),
    validate({ body: createSchema }),
    asyncHandler(async (req, res) =>
      created(res, await service.create(req.scope, req.user, req.body), { message: 'Task assigned' }),
    ),
  );

/**
 * @openapi
 * /assignments/active:
 *   get:
 *     tags: [Assignments]
 *     summary: The caller's active assignments (for the hourly-grid picker)
 *     description: |
 *       ASSIGNED / IN_PROGRESS assignments the employee can log an hour against.
 *       `userId` lets a lead editing someone else's sheet see that person's plate.
 *     responses:
 *       200: { description: Active assignments }
 */
router.get(
  '/active',
  authorize(PERMISSIONS.ASSIGNMENT_READ),
  validate({ query: z.object({ userId: z.string().cuid().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.listActiveForUser(req.scope, req.query.userId))),
);

/**
 * @openapi
 * /assignments/{id}:
 *   get:
 *     tags: [Assignments]
 *     summary: One assignment with its progress thread and history
 *     responses:
 *       200: { description: Assignment detail }
 *   patch:
 *     tags: [Assignments]
 *     summary: Edit an assignment's brief (title, description, due date, priority)
 *     responses:
 *       200: { description: Updated }
 *       409: { description: Version conflict, or the assignment is closed }
 */
router
  .route('/:id')
  .get(
    authorize(PERMISSIONS.ASSIGNMENT_READ),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => ok(res, await service.getById(req.scope, req.params.id))),
  )
  .patch(
    authorize(PERMISSIONS.ASSIGNMENT_UPDATE),
    validate({ params: idParam, body: updateSchema }),
    asyncHandler(async (req, res) =>
      ok(res, await service.update(req.scope, req.user, req.params.id, req.body), {
        message: 'Assignment updated',
      }),
    ),
  );

/**
 * @openapi
 * /assignments/{id}/submit:
 *   post:
 *     tags: [Assignments]
 *     summary: (Assignee) mark the assignment done and hand it back for review
 *     responses:
 *       200: { description: Submitted }
 */
router.post(
  '/:id/submit',
  authorize(PERMISSIONS.ASSIGNMENT_SUBMIT),
  validate({ params: idParam, body: submitSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.submit(req.scope, req.user, req.params.id, req.body), {
      message: 'Submitted for review',
    }),
  ),
);

/**
 * @openapi
 * /assignments/{id}/review:
 *   post:
 *     tags: [Assignments]
 *     summary: (Lead) confirm an assignment DONE, or REOPEN it
 *     responses:
 *       200: { description: Reviewed }
 */
router.post(
  '/:id/review',
  authorize(PERMISSIONS.ASSIGNMENT_REVIEW),
  validate({ params: idParam, body: reviewSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.review(req.scope, req.user, req.params.id, req.body), {
      message: req.body.decision === 'DONE' ? 'Assignment confirmed done' : 'Assignment reopened',
    }),
  ),
);

/**
 * @openapi
 * /assignments/{id}/cancel:
 *   post:
 *     tags: [Assignments]
 *     summary: (Lead) cancel an assignment — never deletes it
 *     responses:
 *       200: { description: Cancelled }
 */
router.post(
  '/:id/cancel',
  authorize(PERMISSIONS.ASSIGNMENT_CANCEL),
  validate({ params: idParam, body: cancelSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.cancel(req.scope, req.user, req.params.id, req.body), {
      message: 'Assignment cancelled',
    }),
  ),
);

export default router;
