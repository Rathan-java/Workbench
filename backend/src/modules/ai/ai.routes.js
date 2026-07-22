import { Router } from 'express';
import { z } from 'zod';
import * as service from './ai.service.js';
import { getAiStatus, pingGemini } from '../../config/gemini.js';
import { prisma } from '../../config/prisma.js';
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
  kind: z.enum(service.INSIGHT_KINDS).optional(),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  unacknowledged: queryBoolean(),
  /** ON_TRACK is hidden by default — it is the audit trail, not the worklist. */
  includeOnTrack: queryBoolean(),
  /**
   * Scheduled findings and period reviews answer different questions and must
   * not read as one list. Absent = the scheduled feed, which is what the page
   * has always shown.
   */
  isReview: queryBoolean(),
});

/** A review is deliberate and bounded: one department, a sane number of days. */
const reviewSchema = z.object({
  departmentId: z.string().cuid(),
  // 30 is the ceiling because a review is a period check, not an archive trawl —
  // and because every extra day is tokens on every employee in the department.
  days: z.number().int().min(2).max(30).default(10),
  /**
   * Both OPTIONAL, and absent means what it has always meant: the whole
   * department, every project. They narrow the question, never a prerequisite
   * for asking it. Empty strings are accepted and dropped, because that is what
   * an untouched "All projects" dropdown posts.
   */
  projectId: z.string().cuid().optional().or(z.literal('')).transform((v) => v || undefined),
  userId: z.string().cuid().optional().or(z.literal('')).transform((v) => v || undefined),
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
  asyncHandler(async (req, res) => {
    // Which departments have opted out, by name. Without this, "no findings for
    // Video Editing" is ambiguous — it could mean the analyser looked and found
    // nothing wrong, or that it was never allowed to look. Those are very
    // different facts for a manager to act on, so the screen states which.
    const optedOut = await prisma.department.findMany({
      where: { isActive: true, aiAnalysisEnabled: false },
      select: { id: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });
    // The cadence is a runtime setting, so report the LIVE value rather than the
    // env default — otherwise this screen confidently describes a schedule the
    // system stopped using the moment somebody changed it.
    const intervalHours = await service.getAnalysisIntervalHours();
    ok(res, {
      ...getAiStatus(),
      intervalHours,
      windowHours: intervalHours,
      departmentsOptedOut: optedOut,
    });
  }),
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
 * /ai/review:
 *   post:
 *     tags: [AI]
 *     summary: Review a department's employees over a period of days
 *     description: |
 *       The on-demand efficiency check. Management picks a department and a number
 *       of days; every active employee in it is assessed against their whole
 *       period at once — the daily log, the assignments, and the status of the
 *       project modules that work belongs to.
 *
 *       This is what can find what the two-hourly run structurally cannot: the
 *       same work described three times in three different wordings while the
 *       module it belongs to was closed a week ago.
 *
 *       Nobody is notified. The results go to the person who asked for them.
 *     responses:
 *       200: { description: Review complete }
 *       400: { description: Not configured, or the department has opted out }
 */
router.post(
  '/review',
  // The same gate as "run now": it spends money, and it produces a judgement
  // about a whole team at once.
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: reviewSchema }),
  asyncHandler(async (req, res) => {
    const result = await service.reviewPeriod({
      departmentId: req.body.departmentId,
      days: req.body.days,
      projectId: req.body.projectId,
      userId: req.body.userId,
      actor: req.user,
    });

    // Names the narrowing back, so nobody reads a one-project answer as a
    // verdict on the department.
    const where = [result.scope?.project && `on ${result.scope.project}`, `in ${result.department}`]
      .filter(Boolean)
      .join(' ');
    const message = result.assessed
      ? `Reviewed ${result.assessed} ${where} over ${result.days} days — ${result.flagged} flagged`
      : `Nobody ${where} had anything to review over ${result.days} days`;

    return ok(res, result, { message });
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
