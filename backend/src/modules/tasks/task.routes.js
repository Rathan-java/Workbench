import { Router } from 'express';
import { z } from 'zod';
import * as service from './task.service.js';
import { ok, created, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize, authorizeAny } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import {
  gridQuerySchema,
  saveEntryShape,
  withProjectRule,
  saveGridSchema,
  deleteEntrySchema,
  submitDaySchema,
  reviewDaySchema,
  listEntriesQuerySchema,
  listDaysQuerySchema,
} from './task.dto.js';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

/**
 * Per-cell save carries the date + optional target user alongside the entry.
 * Extend the bare SHAPE, then re-apply the project rule — `.superRefine()` would
 * have already turned it into a ZodEffects, which cannot be extended.
 */
const saveEntryBody = withProjectRule(
  saveEntryShape.extend({
    date: z.string().date(),
    userId: z.string().cuid().optional(),
  }),
);

/**
 * @openapi
 * tags:
 *   name: Tasks
 *   description: |
 *     Hourly task logging — the core of the product.
 *
 *     The grid is a table: one row per day, one column per working hour, with the
 *     columns coming from the employee's OWN department. Employees write their
 *     own sheet; Tech Leads read and (when necessary) correct their department's
 *     sheets; Management reads everything. That boundary is enforced in the
 *     service layer, not in the UI.
 */

/**
 * @openapi
 * /tasks/grid:
 *   get:
 *     tags: [Tasks]
 *     summary: The hourly grid for one employee on one date
 *     description: |
 *       Returns one cell per working-hour slot — filled or empty — plus the day's
 *       approval state and an explicit `permissions` block telling the UI whether
 *       the grid is editable and, if not, exactly why.
 *
 *       Omit `userId` for your own sheet. Supplying someone else's requires the
 *       scope to allow it (Tech Lead: same department; Management: anyone).
 *     parameters:
 *       - { in: query, name: date, schema: { type: string, format: date }, description: Defaults to today }
 *       - { in: query, name: userId, schema: { type: string }, description: Whose sheet. Defaults to your own. }
 *     responses:
 *       200: { description: The grid, its cells, its summary and its permissions }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/grid',
  authorize(PERMISSIONS.TASK_READ),
  validate({ query: gridQuerySchema }),
  asyncHandler(async (req, res) => ok(res, await service.getGrid(req.scope, req.user, req.query))),
);

/**
 * @openapi
 * /tasks/entries:
 *   get:
 *     tags: [Tasks]
 *     summary: Search and filter task entries (the monitoring screen)
 *     description: |
 *       Server-side search, filter, sort and pagination across the axes that
 *       matter: an INDIVIDUAL, a PROJECT, a DEPARTMENT (or team), and a date
 *       range — plus late-only and lead-edited-only.
 *
 *       There is no status or priority filter, because there are no such columns.
 *       Every logged hour is completed work.
 *     parameters:
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: departmentId, schema: { type: string } }
 *       - { in: query, name: teamId, schema: { type: string } }
 *       - { in: query, name: userId, schema: { type: string } }
 *       - { in: query, name: projectId, schema: { type: string } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *       - { in: query, name: month, schema: { type: integer, minimum: 1, maximum: 12 } }
 *       - { in: query, name: year, schema: { type: integer } }
 *       - { in: query, name: isLate, schema: { type: boolean } }
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 *   post:
 *     tags: [Tasks]
 *     summary: Save one hourly entry (create or update)
 *     description: |
 *       The auto-save endpoint. Send `version` (the value you last read) to get
 *       optimistic-concurrency protection — a stale version returns **409** with
 *       the server's current copy rather than silently overwriting a colleague's
 *       edit. Set `isAutoSave: true` while the user is still typing to relax
 *       required-field checks on the department-specific fields.
 *     responses:
 *       200: { description: Entry saved }
 *       409: { description: Version conflict — someone else edited this entry }
 *       403: { description: Sheet is locked, or outside the editing window }
 */
router
  .route('/entries')
  .get(
    authorize(PERMISSIONS.TASK_READ),
    validate({ query: listEntriesQuerySchema }),
    asyncHandler(async (req, res) => {
      const { items, ...pagination } = await service.listEntries(req.scope, req.query);
      return paginated(res, items, pagination);
    }),
  )
  .post(
    authorizeAny(PERMISSIONS.TASK_WRITE_OWN, PERMISSIONS.TASK_WRITE_ANY),
    validate({ body: saveEntryBody }),
    asyncHandler(async (req, res) =>
      ok(res, await service.saveEntry(req.scope, req.user, req.body), { message: 'Saved' }),
    ),
  );

/**
 * @openapi
 * /tasks/grid:
 *   post:
 *     tags: [Tasks]
 *     summary: Save the whole grid in one call ("Save all")
 *     description: |
 *       One request, one transaction, all-or-nothing. Seven separate calls would
 *       be seven chances to half-succeed and leave the day's counters lying.
 *     responses:
 *       200: { description: Entries saved }
 */
router.post(
  '/grid',
  authorizeAny(PERMISSIONS.TASK_WRITE_OWN, PERMISSIONS.TASK_WRITE_ANY),
  validate({ body: saveGridSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.saveGrid(req.scope, req.user, req.body), { message: 'Task sheet saved' }),
  ),
);

/**
 * @openapi
 * /tasks/entries/{id}:
 *   delete:
 *     tags: [Tasks]
 *     summary: Delete an hourly entry
 *     responses:
 *       200: { description: Deleted }
 */
router.delete(
  '/entries/:id',
  authorizeAny(PERMISSIONS.TASK_WRITE_OWN, PERMISSIONS.TASK_DELETE),
  validate({ params: idParam, body: deleteEntrySchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.deleteEntry(req.scope, req.user, req.params.id, req.body), {
      message: 'Entry deleted',
    }),
  ),
);

/**
 * @openapi
 * /tasks/entries/{id}/history:
 *   get:
 *     tags: [Tasks]
 *     summary: Full revision history of an entry
 *     description: |
 *       Every change ever made, with the actor, the timestamp and a precomputed
 *       field-level diff. Written inside the same transaction as the change
 *       itself, so it cannot drift from the live row.
 *     responses:
 *       200: { description: The entry and its revisions, newest first }
 */
router.get(
  '/entries/:id/history',
  authorize(PERMISSIONS.TASK_HISTORY_READ),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await service.getEntryHistory(req.scope, req.params.id))),
);

// --- days + approvals ----------------------------------------------------

/**
 * @openapi
 * /tasks/days:
 *   get:
 *     tags: [Tasks]
 *     summary: Day-level task sheets (who filed what, and its approval state)
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 */
router.get(
  '/days',
  authorize(PERMISSIONS.TASK_READ),
  validate({ query: listDaysQuerySchema }),
  asyncHandler(async (req, res) => {
    const { items, ...pagination } = await service.listDays(req.scope, req.query);
    return paginated(res, items, pagination);
  }),
);

/**
 * @openapi
 * /tasks/days/pending:
 *   get:
 *     tags: [Tasks]
 *     summary: The Tech Lead's approval queue
 *     description: Submitted sheets awaiting review, oldest first.
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 */
router.get(
  '/days/pending',
  authorize(PERMISSIONS.TASK_APPROVE),
  validate({ query: listDaysQuerySchema }),
  asyncHandler(async (req, res) => {
    const { items, ...pagination } = await service.listPendingApprovals(req.scope, req.query);
    return paginated(res, items, pagination);
  }),
);

/**
 * @openapi
 * /tasks/days/submit:
 *   post:
 *     tags: [Tasks]
 *     summary: Submit your task sheet for approval
 *     description: Rejected if the required hours for your department are not all filled.
 *     responses:
 *       200: { description: Submitted }
 *       400: { description: Sheet is incomplete }
 */
router.post(
  '/days/submit',
  authorize(PERMISSIONS.TASK_SUBMIT),
  validate({ body: submitDaySchema }),
  asyncHandler(async (req, res) =>
    created(res, await service.submitDay(req.scope, req.user, req.body), {
      message: 'Task sheet submitted for approval',
    }),
  ),
);

/**
 * @openapi
 * /tasks/days/{id}/review:
 *   post:
 *     tags: [Tasks]
 *     summary: Approve, reject or reopen a task sheet
 *     description: |
 *       A rejection MUST carry a note — "rejected, no reason given" is how an
 *       approval workflow loses its users. You cannot review your own sheet.
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [APPROVE, REJECT, REOPEN] }
 *               note: { type: string }
 *     responses:
 *       200: { description: Reviewed }
 *       403: { description: Not permitted, or attempting to review your own sheet }
 *       409: { description: Illegal state transition }
 */
router.post(
  '/days/:id/review',
  authorizeAny(PERMISSIONS.TASK_APPROVE, PERMISSIONS.TASK_REJECT),
  validate({ params: idParam, body: reviewDaySchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.reviewDay(req.scope, req.user, req.params.id, req.body), {
      message: 'Task sheet reviewed',
    }),
  ),
);

export default router;
