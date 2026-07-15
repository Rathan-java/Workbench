import { Router } from 'express';
import { z } from 'zod';
import { ok } from '../core/ApiResponse.js';
import { asyncHandler } from '../core/asyncHandler.js';
import { authenticate, authorize } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { PERMISSIONS } from '../core/permissions.js';
import { getJobStatus, runJobNow, JOB_NAMES } from '../jobs/scheduler.js';
import { getMailStatus, sendTestMail } from '../config/mailer.js';
import { BadRequestError } from '../core/errors.js';
import { PERMISSIONS as ALL_PERMISSIONS, ROLE_PERMISSIONS } from '../core/permissions.js';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * tags:
 *   name: System
 *   description: Operational visibility — scheduled jobs and the permission matrix.
 */

/**
 * @openapi
 * /system/jobs:
 *   get:
 *     tags: [System]
 *     summary: Scheduled job status
 *     description: |
 *       What is scheduled, when it last ran, whether it succeeded, and whether it
 *       is running right now on some instance. This is how you find out that the
 *       retention job has been silently failing for a fortnight.
 *     responses:
 *       200: { description: Job status }
 */
router.get(
  '/jobs',
  authorize(PERMISSIONS.SETTINGS_READ),
  asyncHandler(async (_req, res) => ok(res, await getJobStatus())),
);

/**
 * @openapi
 * /system/jobs/{name}/run:
 *   post:
 *     tags: [System]
 *     summary: Trigger a job immediately (Management)
 *     description: |
 *       Still goes through the distributed lock — a manual trigger cannot collide
 *       with the scheduled run or with a manual trigger on another instance.
 *     responses:
 *       200: { description: Job executed (or skipped because it was already running) }
 */
router.post(
  '/jobs/:name/run',
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate({ params: z.object({ name: z.enum(JOB_NAMES) }) }),
  asyncHandler(async (req, res) =>
    ok(res, await runJobNow(req.params.name), { message: `Job "${req.params.name}" executed` }),
  ),
);

/**
 * @openapi
 * /system/mail:
 *   get:
 *     tags: [System]
 *     summary: SMTP status — is mail actually working?
 *     description: |
 *       Shows the live SMTP configuration and whether the connection verified at
 *       boot. The password is never returned.
 *
 *       This exists because the failure mode of a broken mail config is *silence*:
 *       a user clicks "forgot password", the API says "a code has been sent", and
 *       nothing arrives. Ever. This endpoint turns that silence into an answer.
 *     responses:
 *       200: { description: SMTP configuration and last verification result }
 */
router.get(
  '/mail',
  authorize(PERMISSIONS.SETTINGS_READ),
  asyncHandler(async (_req, res) => ok(res, getMailStatus())),
);

/**
 * @openapi
 * /system/mail/test:
 *   post:
 *     tags: [System]
 *     summary: Send a test email
 *     description: |
 *       Proves the SMTP setup works, without having to trigger a real password
 *       reset on somebody's account and hope. On failure, the error message names
 *       the likely cause — "port 587 needs SMTP_SECURE=false", "Gmail needs an App
 *       Password" — rather than just echoing `ECONNREFUSED`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to]
 *             properties:
 *               to: { type: string, format: email }
 *     responses:
 *       200: { description: Sent }
 *       400: { description: SMTP rejected it — the message says why }
 */
router.post(
  '/mail/test',
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: z.object({ to: z.string().email() }) }),
  asyncHandler(async (req, res) => {
    try {
      const result = await sendTestMail(req.body.to);
      return ok(res, result, { message: `Test email sent to ${req.body.to}` });
    } catch (error) {
      throw new BadRequestError(error.message, { code: 'SMTP_FAILED' });
    }
  }),
);

/**
 * @openapi
 * /system/permissions:
 *   get:
 *     tags: [System]
 *     summary: The full permission matrix
 *     description: |
 *       Every capability in the system, and which roles hold it. This endpoint is
 *       the answer to "who can approve a timesheet?" — one lookup instead of
 *       grepping the codebase.
 *     responses:
 *       200: { description: Permission matrix }
 */
router.get(
  '/permissions',
  authorize(PERMISSIONS.SETTINGS_READ),
  asyncHandler(async (_req, res) =>
    ok(res, {
      permissions: Object.values(ALL_PERMISSIONS),
      roles: ROLE_PERMISSIONS,
    }),
  ),
);

/**
 * @openapi
 * /system/me/permissions:
 *   get:
 *     tags: [System]
 *     summary: Your own permissions and scope
 *     description: The SPA uses this to decide which navigation items and buttons to render.
 *     responses:
 *       200: { description: Your permissions and access scope }
 */
router.get(
  '/me/permissions',
  asyncHandler(async (req, res) =>
    ok(res, {
      role: req.user.role,
      permissions: req.user.permissions,
      scope: {
        kind: req.scope.kind,
        departmentId: req.scope.departmentId,
        teamId: req.scope.teamId,
        ledTeamIds: req.scope.ledTeamIds,
      },
    }),
  ),
);

export default router;
