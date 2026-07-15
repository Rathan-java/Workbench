/**
 * Audit logging.
 *
 * TWO RULES, BOTH LOAD-BEARING:
 *
 * 1. AUDIT WRITES MUST NEVER BREAK A USER ACTION.
 *    `record()` is fire-and-forget and swallows its own errors. If the audit
 *    insert fails, we log loudly — but we do not roll back the user's password
 *    change. An audit system that can take down the product will be disabled by
 *    the first on-call engineer it wakes up.
 *
 * 2. AUDIT IS APPEND-ONLY.
 *    There is no update() and no delete() in this file, and the 180-day
 *    retention job explicitly excludes audit_logs. Compliance requires that the
 *    record of "who deleted the data" outlives the data.
 *
 * `recordInTransaction()` is the exception: when the audit entry must be atomic
 * with the mutation (approvals, role changes), pass the transaction client and
 * it joins that transaction's fate.
 */
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { getContext } from '../../core/requestContext.js';

/** Fields that must never reach the audit table, even in a before/after diff. */
const SENSITIVE = new Set([
  'passwordHash',
  'password',
  'otpHash',
  'tokenHash',
  'resetTokenHash',
  'refreshToken',
  'accessToken',
]);

const sanitize = (value, depth = 0) => {
  if (value == null || typeof value !== 'object' || depth > 5) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE.has(k)) continue; // dropped entirely, not even masked
    out[k] = sanitize(v, depth + 1);
  }
  return out;
};

/**
 * Compute a minimal diff so the audit table stores what changed, not two full
 * copies of every row. At a few hundred writes a day this is the difference
 * between a lean audit table and one nobody can query in two years.
 */
export const diff = (before, after) => {
  if (!before || !after) return { before: sanitize(before), after: sanitize(after) };

  const changedBefore = {};
  const changedAfter = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (SENSITIVE.has(key)) continue;
    const a = before[key];
    const b = after[key];
    const same =
      a instanceof Date && b instanceof Date
        ? a.getTime() === b.getTime()
        : JSON.stringify(a) === JSON.stringify(b);
    if (!same) {
      changedBefore[key] = sanitize(a);
      changedAfter[key] = sanitize(b);
    }
  }

  return { before: changedBefore, after: changedAfter };
};

/**
 * @typedef {object} AuditEntry
 * @property {string} action        An AuditAction enum value.
 * @property {object} [actor]       Defaults to the ambient request user.
 * @property {string} [entityType]
 * @property {string} [entityId]
 * @property {string} [departmentId]
 * @property {string} [summary]     Human-readable, shown verbatim in the UI.
 * @property {object} [before]
 * @property {object} [after]
 * @property {boolean} [success]
 */

const buildRow = (entry) => {
  const ctx = getContext();
  const actor = entry.actor ?? ctx?.user;

  return {
    action: entry.action,
    actorId: actor?.id ?? null,
    actorEmail: actor?.email ?? entry.actorEmail ?? null,
    actorRole: actor?.role ?? null,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    departmentId: entry.departmentId ?? actor?.departmentId ?? null,
    summary: entry.summary?.slice(0, 500) ?? null,
    before: entry.before ? sanitize(entry.before) : undefined,
    after: entry.after ? sanitize(entry.after) : undefined,
    ip: ctx?.ip ?? null,
    userAgent: ctx?.userAgent ?? null,
    correlationId: ctx?.correlationId ?? null,
    success: entry.success ?? true,
  };
};

/**
 * Fire-and-forget. Deliberately NOT awaited by callers on the hot path.
 * @param {AuditEntry} entry
 */
export const record = (entry) => {
  const row = buildRow(entry);
  // Detach: the user's response should not wait on an audit INSERT.
  void prisma.auditLog.create({ data: row }).catch((error) => {
    logger.error('AUDIT WRITE FAILED — investigate immediately', {
      action: row.action,
      entityId: row.entityId,
      error: error.message,
    });
  });
};

/**
 * Atomic audit. Use when the audit row and the mutation must succeed or fail
 * together — role changes, approvals, deactivations.
 * @param {import('@prisma/client').Prisma.TransactionClient} tx
 * @param {AuditEntry} entry
 */
export const recordInTransaction = (tx, entry) => tx.auditLog.create({ data: buildRow(entry) });

export default { record, recordInTransaction, diff };
