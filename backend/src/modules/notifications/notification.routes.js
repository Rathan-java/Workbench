import { Router } from 'express';
import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import * as service from './notification.service.js';
import { ok, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { paginationSchema } from '../../core/pagination.js';

const router = Router();
router.use(authenticate);

const listQuery = paginationSchema.extend({
  unreadOnly: queryBoolean(),
  type: z
    .enum([
      'MISSED_HOURLY_UPDATE',
      'TEAM_COMPLIANCE_ALERT',
      'DAILY_SUMMARY',
      'TASK_APPROVED',
      'TASK_REJECTED',
      'TASK_EDITED_BY_LEAD',
      'ACCOUNT',
      'SYSTEM',
    ])
    .optional(),
});

/**
 * @openapi
 * tags:
 *   name: Notifications
 *   description: |
 *     In-app notifications. Every notification is persisted here FIRST and only
 *     then emailed — email is best-effort and silently fails (full mailbox,
 *     greylisting, a typo'd address), so the bell is the system of record.
 *
 *     Note there is no `userId` parameter anywhere in this module: you can only
 *     ever read and mark your own notifications.
 */

/**
 * @openapi
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Your notifications
 *     parameters:
 *       - { in: query, name: unreadOnly, schema: { type: boolean } }
 *       - { in: query, name: type, schema: { type: string } }
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 */
router.get(
  '/',
  authorize(PERMISSIONS.NOTIFICATION_READ),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const { items, unreadCount, ...pagination } = await service.list(req.user.id, req.query);
    return paginated(res, items, pagination, { message: `${unreadCount} unread` });
  }),
);

/**
 * @openapi
 * /notifications/unread-count:
 *   get:
 *     tags: [Notifications]
 *     summary: Unread count for the bell badge
 *     description: Deliberately tiny — the SPA polls this on an interval.
 *     responses:
 *       200: { description: The count }
 */
router.get(
  '/unread-count',
  authorize(PERMISSIONS.NOTIFICATION_READ),
  asyncHandler(async (req, res) => ok(res, { count: await service.unreadCount(req.user.id) })),
);

/**
 * @openapi
 * /notifications/{id}/read:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark one notification read
 *     responses:
 *       200: { description: Marked read }
 */
router.post(
  '/:id/read',
  authorize(PERMISSIONS.NOTIFICATION_READ),
  validate({ params: z.object({ id: z.string().cuid() }) }),
  asyncHandler(async (req, res) => ok(res, await service.markRead(req.user.id, req.params.id))),
);

/**
 * @openapi
 * /notifications/read-all:
 *   post:
 *     tags: [Notifications]
 *     summary: Mark everything read
 *     responses:
 *       200: { description: All marked read }
 */
router.post(
  '/read-all',
  authorize(PERMISSIONS.NOTIFICATION_READ),
  asyncHandler(async (req, res) =>
    ok(res, await service.markAllRead(req.user.id), { message: 'All notifications marked read' }),
  ),
);

export default router;
