import { Router } from 'express';
import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import * as service from './user.service.js';
import { ok, created, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import {
  listUsersQuerySchema,
  createUserSchema,
  updateUserSchema,
  resetUserPasswordSchema,
  deactivateUserSchema,
} from './user.dto.js';
import { ROLE_LIST } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

const optionsQuery = z.object({
  departmentId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  role: z.enum(ROLE_LIST).optional(),
  includeInactive: queryBoolean(),
});

/**
 * @openapi
 * tags:
 *   name: Users
 *   description: |
 *     Employee administration. Every endpoint here is scoped: Management sees
 *     the whole company, a Tech Lead sees only their own department, and an
 *     Employee sees only themselves. The scope is applied in the repository, not
 *     in the controller — see accessScope.js.
 */

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     summary: List users (paginated, searchable, filterable, sortable — all server-side)
 *     parameters:
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: pageSize, schema: { type: integer, default: 25, maximum: 200 } }
 *       - { in: query, name: search, schema: { type: string }, description: Matches name, email, employee code or designation }
 *       - { in: query, name: departmentId, schema: { type: string } }
 *       - { in: query, name: teamId, schema: { type: string } }
 *       - { in: query, name: role, schema: { type: string, enum: [MANAGEMENT, TECH_LEAD, EMPLOYEE] } }
 *       - { in: query, name: status, schema: { type: string, enum: [ACTIVE, INACTIVE, LOCKED] } }
 *       - { in: query, name: sortBy, schema: { type: string } }
 *       - { in: query, name: sortOrder, schema: { type: string, enum: [asc, desc] } }
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 *   post:
 *     tags: [Users]
 *     summary: Create a user (Management)
 *     description: |
 *       Generates a strong temporary password when none is supplied, emails a
 *       welcome message, and forces a password change on first sign-in. The
 *       temporary password is returned to the caller ONCE and never again.
 *     responses:
 *       201: { description: User created }
 *       409: { description: Email or employee code already in use }
 */
router
  .route('/')
  .get(
    authorize(PERMISSIONS.USER_READ),
    validate({ query: listUsersQuerySchema }),
    asyncHandler(async (req, res) => {
      const { items, ...pagination } = await service.list(req.scope, req.query);
      return paginated(res, items, pagination);
    }),
  )
  .post(
    authorize(PERMISSIONS.USER_CREATE),
    validate({ body: createUserSchema }),
    asyncHandler(async (req, res) => {
      const result = await service.create(req.scope, req.body, req.user);
      return created(res, result, { message: 'User created successfully' });
    }),
  );

/**
 * @openapi
 * /users/options:
 *   get:
 *     tags: [Users]
 *     summary: Lightweight user list for dropdowns
 *     description: |
 *       Backs the employee selector on the monitoring screen. Automatically
 *       scoped — a Tech Lead's copy of this dropdown can only ever contain their
 *       own department's staff.
 *     responses:
 *       200: { description: id / name / code triples }
 */
router.get(
  '/options',
  authorize(PERMISSIONS.USER_READ),
  validate({ query: optionsQuery }),
  asyncHandler(async (req, res) => ok(res, await service.options(req.scope, req.query))),
);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags: [Users]
 *     summary: One user
 *     responses:
 *       200: { description: User }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *   patch:
 *     tags: [Users]
 *     summary: Update a user
 *     description: |
 *       Changing role, department or status revokes all of that user's sessions
 *       immediately — a stale access token must not outlive a demotion.
 *     responses:
 *       200: { description: Updated }
 */
router
  .route('/:id')
  .get(
    authorize(PERMISSIONS.USER_READ),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => ok(res, await service.getById(req.scope, req.params.id))),
  )
  .patch(
    authorize(PERMISSIONS.USER_UPDATE),
    validate({ params: idParam, body: updateUserSchema }),
    asyncHandler(async (req, res) =>
      ok(res, await service.update(req.scope, req.params.id, req.body, req.user), {
        message: 'User updated',
      }),
    ),
  );

/**
 * @openapi
 * /users/{id}/deactivate:
 *   post:
 *     tags: [Users]
 *     summary: Deactivate a user
 *     description: |
 *       Users are never deleted. Deactivation preserves their task history and
 *       every audit row that names them, while revoking all access immediately.
 *     responses:
 *       200: { description: Deactivated }
 *       409: { description: Last Management account, or still leads a team }
 */
router.post(
  '/:id/deactivate',
  authorize(PERMISSIONS.USER_DEACTIVATE),
  validate({ params: idParam, body: deactivateUserSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.deactivate(req.scope, req.params.id, req.body, req.user), {
      message: 'User deactivated',
    }),
  ),
);

/**
 * @openapi
 * /users/{id}/reactivate:
 *   post:
 *     tags: [Users]
 *     summary: Reactivate a user
 *     responses:
 *       200: { description: Reactivated }
 */
router.post(
  '/:id/reactivate',
  authorize(PERMISSIONS.USER_DEACTIVATE),
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    ok(res, await service.reactivate(req.scope, req.params.id), { message: 'User reactivated' }),
  ),
);

/**
 * @openapi
 * /users/{id}/delete-preview:
 *   get:
 *     tags: [Users]
 *     summary: What deleting this user would destroy
 *     description: |
 *       Called before the confirmation dialog, so the admin sees the real numbers
 *       — "this will destroy 412 task entries" — rather than a generic
 *       "are you sure?". Also returns an honest recommendation: for anyone who has
 *       actually logged work, deactivation is almost always the right answer.
 *     responses:
 *       200: { description: Counts, blockers and a recommendation }
 */
router.get(
  '/:id/delete-preview',
  authorize(PERMISSIONS.USER_DELETE),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await service.previewDelete(req.scope, req.params.id))),
);

/**
 * @openapi
 * /users/{id}:
 *   delete:
 *     tags: [Users]
 *     summary: PERMANENTLY delete a user (Management)
 *     description: |
 *       **Irreversible.** Destroys the person's entire task history — every hour
 *       they logged, every revision, every approval.
 *
 *       The AUDIT LOG survives: every row they ever caused keeps their email and
 *       role as plain text. An audit trail that forgets its actor the moment they
 *       leave the company is not an audit trail.
 *
 *       Work they *touched* but did not *own* also survives — if they corrected a
 *       colleague's entry, that entry stays and only the `updatedBy` pointer goes
 *       null. The work belongs to whoever's hour it was, not to whoever typed it.
 *
 *       For someone who has simply left the company, use `/deactivate` instead:
 *       their history is company history and stays reportable.
 *     responses:
 *       200: { description: Deleted, with a count of what was destroyed }
 *       409: { description: Last Management account, or still leads a team }
 */
router.delete(
  '/:id',
  authorize(PERMISSIONS.USER_DELETE),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const result = await service.destroy(req.scope, req.params.id, req.user);
    return ok(res, result, { message: result.message });
  }),
);

/**
 * @openapi
 * /users/{id}/reset-password:
 *   post:
 *     tags: [Users]
 *     summary: Reset a user's password (Management)
 *     description: Revokes all of the target's sessions and forces a change at next sign-in.
 *     responses:
 *       200: { description: Password reset; temporary password returned once }
 */
router.post(
  '/:id/reset-password',
  authorize(PERMISSIONS.USER_RESET_PASSWORD),
  validate({ params: idParam, body: resetUserPasswordSchema }),
  asyncHandler(async (req, res) => {
    const result = await service.resetPassword(req.scope, req.params.id, req.body, req.user);
    return ok(res, result, { message: result.message });
  }),
);

export default router;
