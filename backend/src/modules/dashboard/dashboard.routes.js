import { Router } from 'express';
import { z } from 'zod';
import * as service from './dashboard.service.js';
import { ok } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorizeAny, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';

const router = Router();
router.use(authenticate);

/**
 * One filter schema for every analytics endpoint. Consistency here means the
 * frontend can drive the whole dashboard from a single filter-bar component
 * whose state maps 1:1 onto the query string.
 */
const analyticsQuery = z.object({
  date: z.string().date().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  departmentId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  projectId: z.string().cuid().optional(),
});

/** Anyone signed in can see *a* dashboard; the scope decides whose numbers. */
const anyDashboard = authorizeAny(
  PERMISSIONS.DASHBOARD_SELF,
  PERMISSIONS.DASHBOARD_TEAM,
  PERMISSIONS.DASHBOARD_GLOBAL,
);

const route = (path, handler, guard = anyDashboard) =>
  router.get(
    path,
    guard,
    validate({ query: analyticsQuery }),
    asyncHandler(async (req, res) => ok(res, await handler(req.scope, req.query))),
  );

/**
 * @openapi
 * tags:
 *   name: Dashboard
 *   description: |
 *     Executive analytics. Today's figures are read live; historical trends come
 *     from a nightly rollup table so a six-month chart does not scan the entire
 *     task fact table on every page load.
 *
 *     Every endpoint is scoped: a Tech Lead's dashboard contains their
 *     department's numbers and nobody else's — enforced in SQL, not in the UI.
 */

/**
 * @openapi
 * /dashboard/overview:
 *   get:
 *     tags: [Dashboard]
 *     summary: The CEO overview — one card per department, plus who to chase
 *     description: |
 *       The first screen anyone opens. It answers two questions and nothing else:
 *       **"is each department keeping up?"** and **"who do I chase?"**
 *
 *       ### How `27 / 30` is arrived at
 *       The denominator is `employees × hours that have actually FINISHED`.
 *
 *       At 13:15, with a day starting at 10:00, exactly three hour-windows have
 *       closed (10–11, 11–12, 12–13). The 13:00 hour is still being worked. So for
 *       10 employees the honest expectation is **3 × 10 = 30** — not 7 × 10 = 70,
 *       which is what a naive full-day requirement gives you.
 *
 *       That distinction is the difference between a number a CEO can trust and one
 *       that reads *"12/70 — the company is failing"* at 11am every single morning.
 *       A metric that is red by construction every morning is a metric everyone has
 *       learned to ignore by lunchtime — and then the day it means something, nobody
 *       looks.
 *
 *       The in-progress hour is excluded on purpose. Nobody is behind on an hour
 *       they are still living through. Breaks and overtime are excluded too.
 *
 *       ### `updateRequired`
 *       Employees who have gone more than `dashboard.updateRequiredHours` (default
 *       **3**) without logging a closed hour, grouped by department, each with the
 *       number of updates they owe. Deliberately a LONGER threshold than the
 *       2-hour reminder grace: 2 hours earns a private nudge, 3 hours puts your
 *       name on the CEO's screen.
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: Defaults to today. A past date treats every hour as closed.
 *     responses:
 *       200: { description: Department cards, the update-required list, and totals }
 */
router.get(
  '/overview',
  anyDashboard,
  validate({ query: analyticsQuery }),
  asyncHandler(async (req, res) => ok(res, await service.getOverview(req.scope, req.query))),
);

/**
 * @openapi
 * /dashboard/summary:
 *   get:
 *     tags: [Dashboard]
 *     summary: The executive summary cards
 *     description: |
 *       Hours logged today, active staff, who has NOT logged anything, late
 *       updates, pending approvals, projects that actually moved today, and
 *       teams — in one round trip.
 *     parameters:
 *       - { in: query, name: date, schema: { type: string, format: date } }
 *       - { in: query, name: departmentId, schema: { type: string } }
 *       - { in: query, name: teamId, schema: { type: string } }
 *     responses:
 *       200: { description: Summary cards and headline rates }
 */
route('/summary', service.getSummary);

// NOTE: /status-breakdown and /priority-breakdown are GONE, along with the
// columns behind them. Every logged hour is completed work, so a status donut
// would have been one slice, and priority was never meaningful on an hour that
// has already been lived. What replaced them is /project-progress below — the
// axis management actually asks about.

/**
 * @openapi
 * /dashboard/hourly-activity:
 *   get:
 *     tags: [Dashboard]
 *     summary: Entries logged per working hour
 *     description: The shape of the working day — and where the late updates cluster.
 *     responses:
 *       200: { description: Activity per time slot }
 */
route('/hourly-activity', service.getHourlyActivity);

/**
 * @openapi
 * /dashboard/trend:
 *   get:
 *     tags: [Dashboard]
 *     summary: Daily trend over a date range
 *     description: |
 *       Gap-filled — a day nobody logged anything renders as a zero rather than
 *       disappearing from the chart.
 *     responses:
 *       200: { description: One point per day }
 */
route('/trend', service.getTrend);

/**
 * @openapi
 * /dashboard/productivity/employee:
 *   get:
 *     tags: [Dashboard]
 *     summary: Employee productivity leaderboard
 *     responses:
 *       200: { description: Per-employee compliance, punctuality and output }
 */
route('/productivity/employee', service.getEmployeeProductivity);

/**
 * @openapi
 * /dashboard/productivity/team:
 *   get:
 *     tags: [Dashboard]
 *     summary: Team productivity
 *     responses:
 *       200: { description: Per-team rollup }
 */
route('/productivity/team', service.getTeamProductivity, authorizeAny(PERMISSIONS.DASHBOARD_TEAM, PERMISSIONS.DASHBOARD_GLOBAL));

/**
 * @openapi
 * /dashboard/productivity/department:
 *   get:
 *     tags: [Dashboard]
 *     summary: Department productivity — the Management view
 *     description: |
 *       Departments with zero activity are still returned. A department that
 *       logged nothing is the most important bar on this chart, and dropping it
 *       because the GROUP BY produced no row would hide the exact problem the
 *       dashboard exists to surface.
 *     responses:
 *       200: { description: Per-department rollup }
 */
route(
  '/productivity/department',
  service.getDepartmentProductivity,
  authorizeAny(PERMISSIONS.DASHBOARD_TEAM, PERMISSIONS.DASHBOARD_GLOBAL),
);

/**
 * @openapi
 * /dashboard/productivity/project:
 *   get:
 *     tags: [Dashboard]
 *     summary: Project productivity
 *     responses:
 *       200: { description: Hours logged and completion rate per project }
 */
route('/productivity/project', service.getProjectProductivity);

/**
 * @openapi
 * /dashboard/team-follow-up:
 *   get:
 *     tags: [Dashboard]
 *     summary: Which teams are filling their tasks, ON TIME
 *     description: |
 *       The question Management opens the dashboard to answer, and it is genuinely
 *       different from the productivity leaderboard.
 *
 *       Productivity asks *"how much work got done"* (from the nightly rollup).
 *       This asks *"is the process being followed, right now"* (live).
 *
 *       A team can be highly productive and still be a follow-up problem, because
 *       they write the whole day up at 6pm. Their data is a day late, their lead is
 *       flying blind, and no rollup will ever tell you.
 *
 *       Hence the three separate numbers per team:
 *       - `fillRate`   — did they log the hour at all?
 *       - `onTimeRate` — **the headline.** Did they log it within the grace period?
 *       - `overdueEntries` — hours now past grace with nothing in them.
 *
 *       A team at 100% fill and 30% on-time is **BACKFILLING**, not complying.
 *       Reporting them as green would hide exactly the behaviour this system exists
 *       to surface. Statuses: `ON_TRACK` · `BACKFILLING` · `AT_RISK` · `NOT_DUE`.
 *     parameters:
 *       - { in: query, name: date, schema: { type: string, format: date } }
 *       - { in: query, name: departmentId, schema: { type: string } }
 *     responses:
 *       200: { description: Per-team follow-up, worst first, plus who to chase }
 */
router.get(
  '/team-follow-up',
  authorize(PERMISSIONS.DASHBOARD_TEAM),
  validate({ query: analyticsQuery }),
  asyncHandler(async (req, res) => ok(res, await service.getTeamFollowUp(req.scope, req.query))),
);

/**
 * @openapi
 * /dashboard/compliance:
 *   get:
 *     tags: [Dashboard]
 *     summary: Who has not logged their hours today
 *     description: |
 *       Live, not rolled up — a nightly aggregate is no use for chasing people
 *       today. Sorted worst-first, because that is who needs chasing.
 *     responses:
 *       200: { description: Per-employee compliance for the date, plus a summary }
 */
router.get(
  '/compliance',
  authorize(PERMISSIONS.DASHBOARD_TEAM),
  validate({ query: analyticsQuery }),
  asyncHandler(async (req, res) => ok(res, await service.getComplianceToday(req.scope, req.query))),
);

export default router;
