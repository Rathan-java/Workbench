import { Router } from 'express';
import { z } from 'zod';
import * as service from './setting.service.js';
import { ok } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';

const router = Router();
router.use(authenticate);

/**
 * @openapi
 * tags:
 *   name: Settings
 *   description: |
 *     Runtime configuration an administrator can change without a redeploy —
 *     reminder grace period, the backdated-edit window, whether daily submission
 *     is mandatory.
 *
 *     Secrets and infrastructure config (database URL, JWT keys, SMTP host)
 *     deliberately do NOT live here: an admin UI that can rewrite the JWT secret
 *     is an admin UI that can compromise the whole system.
 */

/**
 * @openapi
 * /settings:
 *   get:
 *     tags: [Settings]
 *     summary: All settings, including unmodified defaults
 *     responses:
 *       200: { description: Settings grouped by category }
 */
router.get(
  '/',
  authorize(PERMISSIONS.SETTINGS_READ),
  asyncHandler(async (_req, res) => ok(res, await service.list())),
);

/**
 * @openapi
 * /settings/{key}:
 *   put:
 *     tags: [Settings]
 *     summary: Change a setting
 *     description: Only known keys are accepted — an open key-value store just ships typos.
 *     responses:
 *       200: { description: Updated }
 *       404: { description: Unknown setting key }
 */
router.put(
  '/:key',
  authorize(PERMISSIONS.SETTINGS_MANAGE),
  validate({
    params: z.object({ key: z.string().max(96) }),
    // Deliberately permissive on type: settings are booleans, numbers and
    // strings. The per-key contract is enforced in the service, which knows the
    // shape each key expects.
    body: z.object({ value: z.union([z.boolean(), z.number(), z.string()]) }),
  }),
  asyncHandler(async (req, res) =>
    ok(res, await service.set(req.params.key, req.body.value, req.user), {
      message: 'Setting updated',
    }),
  ),
);

export default router;
