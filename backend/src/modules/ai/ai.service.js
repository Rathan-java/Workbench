/**
 * THE ANALYSER — what the AI actually does, and what it is not allowed to do.
 *
 * Every two hours this compares, per person, the work they were ASSIGNED against
 * the hours they actually LOGGED, and records a finding. The join that makes it
 * possible already exists in the schema:
 *
 *     hour (TaskEntry) -> assignment -> module -> project
 *
 * so a logged hour resolves all the way up to a deliverable, and the question
 * stops being "did they type something?" and becomes "did this hour move the
 * part of the project it was supposed to move?".
 *
 * ── THE RULES THIS FILE ENFORCES ────────────────────────────────────────────
 *
 * 1. WRITE THE FINDING BEFORE TELLING ANYONE. A model's judgement about a
 *    person's work is an accusation with consequences. It lands in a durable row
 *    — with the evidence it saw and the model that said it — so a disputed
 *    finding can be audited against its inputs instead of re-argued from memory.
 *
 * 2. THE EMPLOYEE IS NOTIFIED, NOT SHOWN. Leads and Management get the finding.
 *    The employee gets a neutral, actionable nudge naming the assignment — never
 *    the model's reasoning, never the word "suspicious". They can fix the record;
 *    they are not handed a machine's opinion of them.
 *
 * 3. EVIDENCE OR SILENCE. If somebody has no assignments and logged nothing,
 *    there is nothing to judge — they may be on leave, in interviews, or simply
 *    not yet started. Absence of data is not evidence of idleness, and inventing
 *    a finding from it is how a tool like this loses its users' trust in a week.
 *
 * 4. IT NEVER BLOCKS ANYTHING. No timesheet is rejected, no account touched. The
 *    output is a notification and a row. An observer that can halt the thing it
 *    observes is a liability, and the failure path (no key, no quota, bad JSON)
 *    always degrades to "no insights this run".
 */
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { generateJson, isAiConfigured } from '../../config/gemini.js';
import { notifyMany } from '../notifications/notification.service.js';
import { fullName } from '../../utils/name.js';
import { formatWorkDate, toWorkDate, todayWorkDate, dayjs } from '../../utils/date.js';
import { scopedWhereWithFilters } from '../../core/accessScope.js';
import { and, toPrismaPage } from '../../core/pagination.js';
import { NotFoundError, ForbiddenError } from '../../core/errors.js';
import { ROLE } from '../../config/constants.js';

/** The shape the model must return. Pinned so we never parse prose. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: {
      type: 'STRING',
      enum: ['MISALIGNED', 'IDLE', 'LOW_SUBSTANCE', 'AT_RISK', 'ON_TRACK'],
    },
    severity: { type: 'STRING', enum: ['INFO', 'WARNING', 'CRITICAL'] },
    alignmentScore: { type: 'INTEGER' },
    finding: { type: 'STRING' },
    recommendation: { type: 'STRING' },
    assignmentRef: { type: 'STRING' },
  },
  required: ['kind', 'severity', 'finding'],
};

const SYSTEM_INSTRUCTION = `You review work logs in an engineering company's timesheet system.

You are given, for ONE employee over a ~2 hour window: the work assigned to them, and the hours they logged. Judge ONLY whether the logged hours plausibly advance the assigned work.

Rules you must follow:
- Judge the WORK, never the person. No speculation about motive, attitude, or character.
- "ON_TRACK" is a real and common answer. Say it when the work matches. Do not manufacture concerns.
- If the evidence is thin (no assignments, or a window covering a break), answer ON_TRACK with severity INFO and say there was not enough to assess. Never infer idleness from absence of data.
- MISALIGNED = hours logged, but on something the assignment does not call for.
- IDLE = open assignments and elapsed working hours, but nothing logged at all.
- LOW_SUBSTANCE = entries so vague or repetitive they do not evidence real progress ("worked on task", the same sentence four times).
- AT_RISK = the assignment's due date is close and the logged effort will clearly not reach it.
- Be specific and short. Quote what they wrote when it supports the point.
- alignmentScore: 0-100, how well the hours match the assignment. Omit it if you cannot judge.
- severity CRITICAL only for a clear, repeated, unambiguous problem.
- assignmentRef: the id of the assignment your finding is about, or "" if none.

Write the finding for a team lead to read in five seconds.`;

/**
 * Everything the model is shown about one person, and nothing else.
 * Built here (not inline in the prompt) so what leaves the network is one
 * reviewable object, and so the same structure can be stored as `evidence`.
 */
const buildEvidence = (user, assignments, entries, windowStart, windowEnd) => ({
  employee: {
    name: fullName(user),
    code: user.employeeCode,
    department: user.department?.name ?? null,
  },
  window: {
    from: dayjs(windowStart).format('YYYY-MM-DD HH:mm'),
    to: dayjs(windowEnd).format('YYYY-MM-DD HH:mm'),
  },
  assignments: assignments.map((a) => ({
    id: a.id,
    title: a.title,
    detail: a.description ?? null,
    project: a.project?.name ?? null,
    module: a.module ? { name: a.module.name, status: a.module.status } : null,
    status: a.status,
    priority: a.priority,
    dueDate: a.dueDate ? formatWorkDate(a.dueDate) : null,
    estimatedHours: a.estimatedHours ?? null,
    hoursLoggedTotal: a._count?.entries ?? 0,
  })),
  hoursLoggedInWindow: entries.map((e) => ({
    hour: e.timeSlot?.label ?? null,
    wrote: e.description,
    project: e.project?.name ?? null,
    againstAssignment: e.assignment?.title ?? null,
  })),
});

const buildPrompt = (evidence) =>
  `Assess this employee's last window.\n\n${JSON.stringify(evidence, null, 2)}`;

/**
 * Run the analysis for one window.
 *
 * @param {object} [options]
 * @param {Date}   [options.windowEnd] defaults to now — injectable for tests.
 * @returns {Promise<string>} a one-line summary for the job log
 */
export const analyseWindow = async ({ windowEnd = new Date() } = {}) => {
  if (!isAiConfigured()) return 'AI analysis skipped — no GEMINI_API_KEY, or disabled in settings';

  const windowStart = dayjs(windowEnd).subtract(env.AI_ANALYSIS_WINDOW_HOURS, 'hour').toDate();
  const workDate = toWorkDate(todayWorkDate());

  // Candidates: anyone who EITHER has open assigned work OR logged something in
  // the window. Somebody with neither has nothing to assess (rule 3), and asking
  // the model about them would only invite an invented concern.
  const candidates = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      role: { in: [ROLE.EMPLOYEE, ROLE.TECH_LEAD] },
      departmentId: { not: null },
      OR: [
        { assignedToMe: { some: { status: { in: ['ASSIGNED', 'IN_PROGRESS'] } } } },
        { taskEntries: { some: { createdAt: { gte: windowStart, lte: windowEnd } } } },
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      role: true,
      departmentId: true,
      teamId: true,
      department: { select: { id: true, name: true } },
    },
    take: env.AI_MAX_EMPLOYEES_PER_RUN,
  });

  if (!candidates.length) return 'AI analysis: nobody with assignments or logged hours in this window';

  let analysed = 0;
  let flagged = 0;
  let failed = 0;

  // Small concurrency: enough to keep a 60-person run inside a couple of minutes,
  // low enough not to trip provider rate limits or open 60 sockets at once.
  const POOL = 4;
  const queue = [...candidates];

  const worker = async () => {
    while (queue.length) {
      const user = queue.shift();
      if (!user) return;

      try {
        const [assignments, entries] = await Promise.all([
          prisma.assignment.findMany({
            where: { assigneeId: user.id, status: { in: ['ASSIGNED', 'IN_PROGRESS'] } },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              dueDate: true,
              estimatedHours: true,
              project: { select: { name: true } },
              module: { select: { name: true, status: true } },
              _count: { select: { entries: true } },
            },
            orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
            take: 20,
          }),
          prisma.taskEntry.findMany({
            where: { userId: user.id, createdAt: { gte: windowStart, lte: windowEnd } },
            select: {
              description: true,
              timeSlot: { select: { label: true } },
              project: { select: { name: true } },
              assignment: { select: { title: true } },
            },
            orderBy: { createdAt: 'asc' },
            take: 12,
          }),
        ]);

        // Nothing assigned AND nothing logged — no evidence, no judgement.
        if (!assignments.length && !entries.length) continue;

        const evidence = buildEvidence(user, assignments, entries, windowStart, windowEnd);

        const result = await generateJson({
          prompt: buildPrompt(evidence),
          schema: RESPONSE_SCHEMA,
          system: SYSTEM_INSTRUCTION,
        });

        if (!result.ok) {
          failed += 1;
          logger.warn('AI analysis failed for one employee', { userId: user.id, error: result.error });
          continue;
        }

        const verdict = result.data;
        const kind = ['MISALIGNED', 'IDLE', 'LOW_SUBSTANCE', 'AT_RISK', 'ON_TRACK'].includes(verdict.kind)
          ? verdict.kind
          : 'ON_TRACK';
        const severity = ['INFO', 'WARNING', 'CRITICAL'].includes(verdict.severity)
          ? verdict.severity
          : 'INFO';

        // Only trust an id the model was actually shown — a hallucinated one
        // would attach the finding to somebody else's work.
        const assignmentId = assignments.some((a) => a.id === verdict.assignmentRef)
          ? verdict.assignmentRef
          : null;

        const score =
          Number.isInteger(verdict.alignmentScore) &&
          verdict.alignmentScore >= 0 &&
          verdict.alignmentScore <= 100
            ? verdict.alignmentScore
            : null;

        // Keyed on the WINDOW, so re-running the same window (a retry, a manual
        // trigger) updates rather than duplicates. The unique index enforces it
        // across instances.
        const dedupeKey = `ai:${windowStart.toISOString()}:${user.id}`;

        const insight = await prisma.aiInsight.upsert({
          where: { dedupeKey },
          create: {
            dedupeKey,
            windowStart,
            windowEnd,
            departmentId: user.departmentId,
            teamId: user.teamId,
            userId: user.id,
            userName: fullName(user),
            assignmentId,
            kind,
            severity,
            alignmentScore: score,
            finding: String(verdict.finding ?? '').slice(0, 4000),
            recommendation: verdict.recommendation ? String(verdict.recommendation).slice(0, 2000) : null,
            evidence,
            model: env.GEMINI_MODEL,
          },
          update: {
            kind,
            severity,
            alignmentScore: score,
            finding: String(verdict.finding ?? '').slice(0, 4000),
            recommendation: verdict.recommendation ? String(verdict.recommendation).slice(0, 2000) : null,
            evidence,
            model: env.GEMINI_MODEL,
          },
        });

        analysed += 1;

        // ON_TRACK and INFO are recorded but nobody is interrupted. Alerting on
        // "everything is fine" is how people learn to ignore the alerts that matter.
        if (kind !== 'ON_TRACK' && severity !== 'INFO') {
          flagged += 1;
          await raiseAlerts({ insight, user, workDate });
        }
      } catch (error) {
        failed += 1;
        logger.warn('AI analysis errored for one employee', { userId: user.id, error: error.message });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(POOL, candidates.length) }, worker));

  return `AI analysis: ${analysed} assessed, ${flagged} flagged, ${failed} failed (${env.GEMINI_MODEL})`;
};

/**
 * Tell the right people, in the right words.
 *
 * Leads and Management get the finding itself. The employee gets a nudge that
 * names the assignment and asks them to check it — enough to act on, without
 * handing them a model's assessment of their work (see rule 2).
 */
const raiseAlerts = async ({ insight, user, workDate }) => {
  const dateKey = formatWorkDate(workDate);
  const who = fullName(user);
  const level = insight.severity === 'CRITICAL' ? 'CRITICAL' : 'WARNING';

  // One alert per person per kind per day. Without this the same fact is raised
  // every two hours until somebody mutes the whole category.
  const dedupe = (audience) => `ai:${dateKey}:${insight.userId}:${insight.kind}:${audience}`;

  const recipients = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      OR: [
        { role: ROLE.MANAGEMENT },
        { role: ROLE.TECH_LEAD, departmentId: user.departmentId },
      ],
    },
    select: { id: true, role: true },
  });

  // notifyMany, not notify: only the bulk path carries `dedupeKey`, and the
  // UNIQUE index behind it is what stops the same fact being raised every two
  // hours until somebody mutes the category.
  const alerts = recipients
    // A lead is not alerted about their own logged hours.
    .filter((r) => r.id !== user.id)
    .map((r) => ({
      userId: r.id,
      type: 'AI_WORK_ALIGNMENT',
      level,
      title: `${who}: ${insight.kind.replace(/_/g, ' ').toLowerCase()}`,
      body: insight.finding.slice(0, 500),
      link: `/insights?userId=${insight.userId}`,
      entityType: 'AiInsight',
      entityId: insight.id,
      dedupeKey: dedupe(r.role),
    }));

  alerts.push({
    userId: user.id,
    type: 'AI_WORK_ALIGNMENT',
    level: 'WARNING',
    title: 'Your logged hours need a look',
    // Deliberately neutral and actionable. No score, no reasoning, no verdict —
    // the employee is told to check something, not handed a judgement of them.
    body: insight.assignmentId
      ? 'Your recent entries may not reflect the work assigned to you. Please review your task sheet and update it if anything is missing.'
      : 'Your recent entries look incomplete. Please review your task sheet and add anything you have finished.',
    link: `/tasks?date=${dateKey}`,
    entityType: 'AiInsight',
    entityId: insight.id,
    dedupeKey: dedupe('self'),
  });

  await notifyMany(alerts).catch((error) =>
    logger.warn('AI alert delivery failed', { error: error.message }),
  );
};

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

/**
 * List findings.
 *
 * SCOPED, and then some: an employee must never read the assessments, their own
 * included (rule 2). The route guards this with a permission, and this is the
 * second lock on the same door — the one that still holds if a permission bundle
 * is widened by accident in two years.
 */
export const listInsights = async (scope, user, query = {}) => {
  if (user.role === ROLE.EMPLOYEE) {
    throw new ForbiddenError('AI findings are visible to Tech Leads and Management only');
  }

  const { skip, take, page, pageSize } = toPrismaPage(query);

  const where = and(
    scopedWhereWithFilters(scope, { departmentId: query.departmentId, userId: query.userId }),
    query.kind ? { kind: query.kind } : undefined,
    query.severity ? { severity: query.severity } : undefined,
    query.unacknowledged === true ? { acknowledgedAt: null } : undefined,
    // Findings worth a human's attention by default; ON_TRACK is the audit trail.
    query.includeOnTrack === true ? undefined : { kind: { not: 'ON_TRACK' } },
  );

  const [items, total] = await prisma.$transaction([
    prisma.aiInsight.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        assignment: { select: { id: true, title: true, project: { select: { name: true } } } },
        department: { select: { id: true, name: true, colorHex: true } },
        acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.aiInsight.count({ where }),
  ]);

  return { items: items.map(toInsightDto), total, page, pageSize };
};

const toInsightDto = (i) => ({
  id: i.id,
  windowStart: i.windowStart,
  windowEnd: i.windowEnd,
  userId: i.userId,
  userName: i.userName,
  department: i.department,
  assignment: i.assignment
    ? { id: i.assignment.id, title: i.assignment.title, project: i.assignment.project?.name ?? null }
    : null,
  kind: i.kind,
  severity: i.severity,
  alignmentScore: i.alignmentScore,
  finding: i.finding,
  recommendation: i.recommendation,
  evidence: i.evidence,
  model: i.model,
  acknowledgedAt: i.acknowledgedAt,
  acknowledgedBy: i.acknowledgedBy ? fullName(i.acknowledgedBy) : null,
  createdAt: i.createdAt,
});

/** Marking a finding as read is how a lead says "seen it, handled". */
export const acknowledge = async (scope, user, id) => {
  if (user.role === ROLE.EMPLOYEE) {
    throw new ForbiddenError('AI findings are visible to Tech Leads and Management only');
  }

  const insight = await prisma.aiInsight.findUnique({ where: { id }, select: { id: true, departmentId: true } });
  if (!insight) throw new NotFoundError('Insight');

  if (!scope.isGlobal && insight.departmentId !== scope.departmentId) {
    throw new ForbiddenError('That finding belongs to another department');
  }

  const updated = await prisma.aiInsight.update({
    where: { id },
    data: { acknowledgedById: user.id, acknowledgedAt: new Date() },
    include: {
      assignment: { select: { id: true, title: true, project: { select: { name: true } } } },
      department: { select: { id: true, name: true, colorHex: true } },
      acknowledgedBy: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  return toInsightDto(updated);
};
