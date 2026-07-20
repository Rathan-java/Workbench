import { Router } from 'express';
import { z } from 'zod';
import * as service from './ai.service.js';
import { getAiStatus, pingGemini } from '../../config/gemini.js';
import { ok, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorizeAny, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { paginationSchema } from '../../core/pagination.js';
import { queryBoolean } from '../../core/zod.js';

const router = Router();
router.use(authenticate);

/**
 * Findings are for the people who can act on them. DASHBOARD_TEAM is held by
 * Tech Leads and Management and by nobody else, which makes it exactly the right
 * gate — an employee is NOTIFIED that something needs attention, but never reads
 * the assessment itself. The service re-checks the role, so widening a permission
 * bundle by accident does not silently open this up.
 */
const canReadInsights = authorizeAny(PERMISSIONS.DASHBOARD_TEAM, PERMISSIONS.DASHBOARD_GLOBAL);

const listQuery = paginationSchema.extend({
  departmentId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  kind: z.enum(['MISALIGNED', 'IDLE', 'LOW_SUBSTANCE', 'AT_RISK', 'ON_TRACK']).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  unacknowledged: queryBoolean(),
  /** ON_TRACK is hidden by default — it is the audit trail, not the worklist. */
  includeOnTrack: queryBoolean(),
});

/**
 * @openapi
 * tags:
 *   name: AI
 *   description: |
 *     The two-hourly analyser. It compares what each person was ASSIGNED against
 *     the hours they LOGGED and records a finding before anyone is notified.
 *
 *     Findings are readable by Tech Leads (their own department) and Management.
 *     Employees are notified that their entries need a look; they never see the
 *     assessment, its score, or its reasoning.
 */

/**
 * @openapi
 * /ai/status:
 *   get:
 *     tags: [AI]
 *     summary: Is the analyser configured, and which model
 *     responses:
 *       200: { description: Configuration status (never returns the API key) }
 */
router.get(
  '/status',
  canReadInsights,
  asyncHandler(async (req, res) => ok(res, getAiStatus())),
);

/**
 * @openapi
 * /ai/ping:
 *   post:
 *     tags: [AI]
 *     summary: Round-trip the model to prove key, model and quota
 *     responses:
 *       200: { description: Reachable }
 *       400: { description: Not configured, or the provider rejected the call }
 */
router.post(
  '/ping',
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  asyncHandler(async (req, res) => {
    const result = await pingGemini();
    return ok(res, result, {
      message: result.ok ? 'Gemini responded' : `Gemini did not respond: ${result.error}`,
    });
  }),
);

/**
 * @openapi
 * /ai/insights:
 *   get:
 *     tags: [AI]
 *     summary: Findings (scoped, paginated)
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 *       403: { description: Employees cannot read findings }
 */
router.get(
  '/insights',
  canReadInsights,
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { items, ...pagination } = await service.listInsights(req.scope, req.user, req.query);
    return paginated(res, items, pagination);
  }),
);

/**
 * @openapi
 * /ai/insights/{id}/acknowledge:
 *   post:
 *     tags: [AI]
 *     summary: Mark a finding as seen and handled
 *     responses:
 *       200: { description: Acknowledged }
 */
router.post(
  '/insights/:id/acknowledge',
  canReadInsights,
  validate({ params: z.object({ id: z.string().cuid() }) }),
  asyncHandler(async (req, res) =>
    ok(res, await service.acknowledge(req.scope, req.user, req.params.id), {
      message: 'Finding acknowledged',
    }),
  ),
);

/**
 * @openapi
 * /ai/analyse:
 *   post:
 *     tags: [AI]
 *     summary: Run the analysis now, without waiting for the schedule
 *     description: |
 *       Same code path as the cron job. Useful to prove the integration works
 *       and after changing the window, rather than waiting up to two hours.
 *     responses:
 *       200: { description: Run summary }
 */
router.post(
  '/analyse',
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  asyncHandler(async (req, res) => {
    const summary = await service.analyseWindow();
    return ok(res, { summary }, { message: summary });
  }),
);

export default router;
