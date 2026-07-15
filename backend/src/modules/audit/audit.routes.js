import { Router } from 'express';
import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import { prisma } from '../../config/prisma.js';
import { ok, paginated } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { and, buildOrderBy, toPrismaPage, paginationSchema } from '../../core/pagination.js';
import { toWorkDate } from '../../utils/date.js';
import { scopedWhereWithFilters } from '../../core/accessScope.js';
import { fullName } from '../../utils/name.js';

const router = Router();
router.use(authenticate);

const AUDIT_ACTIONS = [
  'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', 'TOKEN_REUSE_DETECTED',
  'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGED',
  'PASSWORD_RESET_BY_ADMIN', 'PROFILE_UPDATED', 'AVATAR_UPLOADED',
  'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'USER_DELETED', 'ROLE_CHANGED',
  'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DELETED', 'TEAM_LEAD_ASSIGNED', 'TEAM_MEMBER_ASSIGNED',
  'PROJECT_CREATED', 'PROJECT_UPDATED',
  'DEPARTMENT_CREATED', 'DEPARTMENT_UPDATED', 'DEPARTMENT_DELETED',
  'TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'TASK_EDITED_BY_LEAD',
  'TASK_DAY_SUBMITTED', 'TASK_DAY_APPROVED', 'TASK_DAY_REJECTED', 'TASK_DAY_REOPENED',
  'REPORT_EXPORTED', 'SETTING_UPDATED', 'RETENTION_CLEANUP',
];

const listQuery = paginationSchema.extend({
  action: z.enum(AUDIT_ACTIONS).optional(),
  actorId: z.string().cuid().optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  departmentId: z.string().cuid().optional(),
  success: queryBoolean(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
});

const SORTABLE = ['createdAt', 'action'];

/**
 * @openapi
 * tags:
 *   name: Audit
 *   description: |
 *     The immutable audit trail. Rows are only ever INSERTed — there is no update
 *     or delete endpoint, and the 180-day task retention job explicitly spares
 *     this table. The record of who deleted the data must outlive the data.
 */

/**
 * @openapi
 * /audit:
 *   get:
 *     tags: [Audit]
 *     summary: Search the audit trail (Management)
 *     description: |
 *       Every logged event: sign-ins, failed sign-ins, password resets, profile
 *       changes, task edits, lead overrides, role changes, user creation and
 *       deactivation, approvals, exports, and setting changes — each with the
 *       actor, their IP, their user agent, the correlation id of the request, and
 *       a before/after diff of what changed.
 *     parameters:
 *       - { in: query, name: action, schema: { type: string } }
 *       - { in: query, name: actorId, schema: { type: string } }
 *       - { in: query, name: entityType, schema: { type: string } }
 *       - { in: query, name: entityId, schema: { type: string } }
 *       - { in: query, name: departmentId, schema: { type: string } }
 *       - { in: query, name: success, schema: { type: boolean } }
 *       - { in: query, name: dateFrom, schema: { type: string, format: date } }
 *       - { in: query, name: dateTo, schema: { type: string, format: date } }
 *     responses:
 *       200: { $ref: '#/components/responses/PaginatedList' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get(
  '/',
  authorize(PERMISSIONS.AUDIT_READ),
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => {
    const q = req.query;
    const { skip, take, page, pageSize } = toPrismaPage(q);

    const where = and(
      // Audit rows carry departmentId as a plain string tag (not a relation), so
      // the scope filter still applies — a Tech Lead granted AUDIT_READ in a
      // future release would see only their own department's events.
      req.scope.isGlobal ? {} : { departmentId: req.scope.departmentId ?? '__none__' },
      q.action ? { action: q.action } : undefined,
      q.actorId ? { actorId: q.actorId } : undefined,
      q.entityType ? { entityType: q.entityType } : undefined,
      q.entityId ? { entityId: q.entityId } : undefined,
      q.departmentId ? { departmentId: q.departmentId } : undefined,
      q.success !== undefined ? { success: q.success } : undefined,
      q.dateFrom || q.dateTo
        ? {
            createdAt: {
              ...(q.dateFrom ? { gte: toWorkDate(q.dateFrom) } : {}),
              ...(q.dateTo ? { lte: new Date(`${q.dateTo}T23:59:59.999Z`) } : {}),
            },
          }
        : undefined,
      q.search
        ? {
            OR: [
              { summary: { contains: q.search } },
              { actorEmail: { contains: q.search } },
              { correlationId: { contains: q.search } },
            ],
          }
        : undefined,
    );

    const [items, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: buildOrderBy(q.sortBy, q.sortOrder, SORTABLE, { createdAt: 'desc' }),
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return paginated(
      res,
      items.map((a) => ({
        id: a.id,
        action: a.action,
        actor: a.actor
          ? {
              id: a.actor.id,
              fullName: fullName(a.actor),
              avatarPath: a.actor.avatarPath,
            }
          : null,
        actorEmail: a.actorEmail,
        actorRole: a.actorRole,
        entityType: a.entityType,
        entityId: a.entityId,
        departmentId: a.departmentId,
        summary: a.summary,
        before: a.before,
        after: a.after,
        ip: a.ip,
        userAgent: a.userAgent,
        correlationId: a.correlationId,
        success: a.success,
        createdAt: a.createdAt,
      })),
      { page, pageSize, total },
    );
  }),
);

/**
 * @openapi
 * /audit/actions:
 *   get:
 *     tags: [Audit]
 *     summary: The audit action vocabulary, for the filter dropdown
 *     responses:
 *       200: { description: Every action the system records }
 */
router.get(
  '/actions',
  authorize(PERMISSIONS.AUDIT_READ),
  asyncHandler(async (_req, res) => ok(res, AUDIT_ACTIONS)),
);

export default router;
