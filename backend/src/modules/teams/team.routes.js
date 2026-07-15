import { Router } from 'express';
import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import * as service from './team.service.js';
import { ok, created, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { paginationSchema } from '../../core/pagination.js';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

const listQuery = paginationSchema.extend({
  departmentId: z.string().cuid().optional(),
  leadId: z.string().cuid().optional(),
  isActive: queryBoolean(),
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(48)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  departmentId: z.string().cuid(),
  leadId: z.string().cuid().nullish(),
});

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

const assignSchema = z.object({
  userIds: z.array(z.string().cuid()).min(1, 'Select at least one employee').max(200),
});

/**
 * @openapi
 * tags:
 *   name: Teams
 *   description: |
 *     Teams belong to exactly one department, and a team's lead must be a Tech
 *     Lead from that same department. Those two rules are what keep the four
 *     departments genuinely isolated from one another.
 */

/**
 * @openapi
 * /teams:
 *   get:
 *     tags: [Teams]
 *     summary: List teams (scoped)
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 *   post:
 *     tags: [Teams]
 *     summary: Create a team
 *     responses:
 *       201: { description: Team created }
 *       400: { description: The chosen lead is not a Tech Lead in this department }
 */
router
  .route('/')
  .get(
    authorize(PERMISSIONS.TEAM_READ),
    validate({ query: listQuery }),
    asyncHandler(async (req, res) => {
      const { items, ...pagination } = await service.list(req.scope, req.query);
      return paginated(res, items, pagination);
    }),
  )
  .post(
    authorize(PERMISSIONS.TEAM_MANAGE),
    validate({ body: createSchema }),
    asyncHandler(async (req, res) =>
      created(res, await service.create(req.scope, req.body), { message: 'Team created' }),
    ),
  );

/**
 * @openapi
 * /teams/options:
 *   get:
 *     tags: [Teams]
 *     summary: Teams for a dropdown
 *     responses:
 *       200: { description: id / name / code triples }
 */
router.get(
  '/options',
  authorize(PERMISSIONS.TEAM_READ),
  validate({ query: z.object({ departmentId: z.string().cuid().optional() }) }),
  asyncHandler(async (req, res) => ok(res, await service.options(req.scope, req.query))),
);

/**
 * @openapi
 * /teams/{id}:
 *   get:
 *     tags: [Teams]
 *     summary: One team, with its members
 *     responses:
 *       200: { description: Team with members }
 *   patch:
 *     tags: [Teams]
 *     summary: Update a team (including assigning its Tech Lead)
 *     responses:
 *       200: { description: Updated }
 */
router
  .route('/:id')
  .get(
    authorize(PERMISSIONS.TEAM_READ),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => ok(res, await service.getById(req.scope, req.params.id))),
  )
  .patch(
    authorize(PERMISSIONS.TEAM_MANAGE),
    validate({ params: idParam, body: updateSchema }),
    asyncHandler(async (req, res) =>
      ok(res, await service.update(req.scope, req.params.id, req.body), { message: 'Team updated' }),
    ),
  );

/**
 * @openapi
 * /teams/{id}/delete-preview:
 *   get:
 *     tags: [Teams]
 *     summary: What deleting this team would cost
 *     description: |
 *       Called before the confirmation dialog, so the admin sees real numbers
 *       rather than a generic "are you sure?" — how many members are in the way,
 *       and how many logged task entries would stop being attributable to a team.
 *     responses:
 *       200: { description: Member count, entry count, blockers and a recommendation }
 */
router.get(
  '/:id/delete-preview',
  authorize(PERMISSIONS.TEAM_MANAGE),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await service.previewDelete(req.scope, req.params.id))),
);

/**
 * @openapi
 * /teams/{id}:
 *   delete:
 *     tags: [Teams]
 *     summary: Delete a team
 *     description: |
 *       **Refused while the team still has members.** Deleting a team out from
 *       under the people in it would silently orphan them: their `teamId` goes
 *       null, they vanish from every team-scoped view, and their Tech Lead stops
 *       seeing them on the follow-up panel — with nothing anywhere to explain why.
 *       Reassign or remove the members first; the error says how many are in the way.
 *
 *       Logged work is **not** destroyed. A task entry belongs to the EMPLOYEE
 *       whose hour it was, not to the team, so the team reference simply nulls out.
 *       Note that historical per-team reports for that period will no longer add up —
 *       which is why `delete-preview` recommends deactivating instead when the team
 *       has any logged work.
 *     responses:
 *       200: { description: Deleted }
 *       409: { description: The team still has members }
 */
router.delete(
  '/:id',
  authorize(PERMISSIONS.TEAM_MANAGE),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => {
    const result = await service.remove(req.scope, req.params.id, req.user);
    return ok(res, result, { message: result.message });
  }),
);

/**
 * @openapi
 * /teams/{id}/members:
 *   post:
 *     tags: [Teams]
 *     summary: Assign employees to a team
 *     description: Rejects any employee who belongs to a different department.
 *     responses:
 *       200: { description: Members assigned }
 */
router.post(
  '/:id/members',
  authorize(PERMISSIONS.TEAM_MANAGE),
  validate({ params: idParam, body: assignSchema }),
  asyncHandler(async (req, res) =>
    ok(res, await service.assignMembers(req.scope, req.params.id, req.body), {
      message: 'Members assigned',
    }),
  ),
);

/**
 * @openapi
 * /teams/{id}/members/{userId}:
 *   delete:
 *     tags: [Teams]
 *     summary: Remove an employee from a team
 *     responses:
 *       200: { description: Member removed }
 */
router.delete(
  '/:id/members/:userId',
  authorize(PERMISSIONS.TEAM_MANAGE),
  validate({ params: idParam.extend({ userId: z.string().cuid() }) }),
  asyncHandler(async (req, res) =>
    ok(res, await service.removeMember(req.scope, req.params.id, req.params.userId), {
      message: 'Member removed',
    }),
  ),
);

export default router;
