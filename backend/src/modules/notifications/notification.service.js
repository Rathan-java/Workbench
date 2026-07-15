/**
 * Notifications.
 *
 * Every notification is persisted in-app FIRST, then optionally emailed. That
 * ordering matters: email is best-effort and can silently fail (full mailbox,
 * greylisting, a typo'd address). The in-app bell is the system of record, so a
 * user who never got the mail still sees the reminder when they open the app.
 */
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { sendMailSafe } from '../../config/mailer.js';
import { and, buildOrderBy, toPrismaPage } from '../../core/pagination.js';
import { NotFoundError } from '../../core/errors.js';

/**
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.type
 * @param {string} input.title
 * @param {string} input.body
 * @param {string} [input.level]
 * @param {string} [input.link]
 * @param {{subject: string, html: string, text: string}} [input.email]
 */
export const notify = async ({ userId, type, title, body, level = 'INFO', link, email, entityType, entityId }) => {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      level,
      title,
      body,
      link,
      entityType,
      entityId,
      emailedAt: email ? new Date() : null,
    },
  });

  if (email) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, status: true },
    });
    // Never mail a deactivated account — that address may have been reassigned.
    if (user?.status === 'ACTIVE') {
      sendMailSafe({ to: user.email, ...email });
    }
  }

  return notification;
};

/**
 * Bulk create, with DE-DUPLICATION.
 *
 * Used by the overdue check, which runs every hour. A notification carrying a
 * `dedupeKey` is inserted at most once, ever — the second attempt is dropped.
 *
 * `skipDuplicates: true` makes MySQL do the dropping (INSERT IGNORE), so the
 * guarantee holds even when two App Service instances run the job in the same
 * second. An application-level "have I already sent this?" check races itself and
 * would let the duplicate through exactly when it is under load.
 *
 * We then re-read which rows actually landed, and email ONLY those. Otherwise the
 * insert would be correctly de-duplicated while the mailbox still received the
 * same message every hour — which is the noise we were trying to prevent.
 *
 * @param {Array<object>} notifications
 * @returns {Promise<number>} how many were genuinely new
 */
export const notifyMany = async (notifications) => {
  if (!notifications.length) return 0;

  const { count } = await prisma.notification.createMany({
    data: notifications.map((n) => ({
      userId: n.userId,
      type: n.type,
      level: n.level ?? 'INFO',
      title: n.title,
      body: n.body,
      link: n.link,
      entityType: n.entityType,
      entityId: n.entityId,
      dedupeKey: n.dedupeKey ?? null,
      emailedAt: n.email ? new Date() : null,
    })),
    skipDuplicates: true,
  });

  if (count === 0) {
    logger.debug('All notifications were duplicates; nothing sent');
    return 0;
  }

  // Which dedupeKeys are ours, i.e. were created just now? Anything already
  // present was suppressed, and must not be emailed either.
  const keyed = notifications.filter((n) => n.dedupeKey);
  let deliverable = notifications;

  if (keyed.length && count < notifications.length) {
    const fresh = await prisma.notification.findMany({
      where: {
        dedupeKey: { in: keyed.map((n) => n.dedupeKey) },
        // Anything inserted in this run. A 60-second window is generous and
        // cannot pick up an alert from a previous hourly tick.
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      select: { dedupeKey: true },
    });
    const freshKeys = new Set(fresh.map((f) => f.dedupeKey));
    deliverable = notifications.filter((n) => !n.dedupeKey || freshKeys.has(n.dedupeKey));
  }

  for (const n of deliverable) {
    if (n.email && n.to) sendMailSafe({ to: n.to, ...n.email });
  }

  logger.info('Notifications dispatched', {
    requested: notifications.length,
    created: count,
    suppressedAsDuplicate: notifications.length - count,
  });

  return count;
};

const SORTABLE = ['createdAt', 'level', 'type'];

export const list = async (userId, query) => {
  const { skip, take, page, pageSize } = toPrismaPage(query);

  const where = and(
    { userId },
    query.unreadOnly ? { readAt: null } : undefined,
    query.type ? { type: query.type } : undefined,
  );

  const [items, total, unreadCount] = await prisma.$transaction([
    prisma.notification.findMany({
      where,
      skip,
      take,
      orderBy: buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, { createdAt: 'desc' }),
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);

  return { items, total, page, pageSize, unreadCount };
};

export const unreadCount = (userId) =>
  prisma.notification.count({ where: { userId, readAt: null } });

/** Scoped by userId in the WHERE — you cannot mark someone else's alert read. */
export const markRead = async (userId, id) => {
  const { count } = await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
  if (count === 0) {
    const exists = await prisma.notification.findFirst({ where: { id, userId } });
    if (!exists) throw new NotFoundError('Notification');
  }
  return { id, readAt: new Date() };
};

export const markAllRead = async (userId) => {
  const { count } = await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return { markedRead: count };
};

export default { notify, notifyMany, list, unreadCount, markRead, markAllRead };
