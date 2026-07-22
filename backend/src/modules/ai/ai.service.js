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
import { createHash } from 'node:crypto';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { generateJson, isAiConfigured } from '../../config/gemini.js';
import { notifyMany } from '../notifications/notification.service.js';
import * as settings from '../settings/setting.service.js';
import { fullName } from '../../utils/name.js';
import { formatWorkDate, toWorkDate, todayWorkDate, dayjs } from '../../utils/date.js';
import { scopedWhereWithFilters } from '../../core/accessScope.js';
import { and, toPrismaPage } from '../../core/pagination.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../core/errors.js';
import { ROLE, SETTING_KEY } from '../../config/constants.js';
import * as audit from '../audit/audit.service.js';
import { isoWeekdayOf } from '../../utils/date.js';

/** Every verdict the model may return. One list, so the schema it is given and the
 *  value we trust on the way back can never drift apart. */
export const INSIGHT_KINDS = ['MISALIGNED', 'IDLE', 'LOW_SUBSTANCE', 'AT_RISK', 'NO_PROGRESS', 'ON_TRACK'];

/** The shape the model must return. Pinned so we never parse prose. */
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: {
      type: 'STRING',
      enum: INSIGHT_KINDS,
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

You are given, for ONE employee over a short window (its exact start and end are in the evidence): the work assigned to them, and the hours they logged. Judge ONLY whether the logged hours plausibly advance the assigned work.

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

/**
 * Compact JSON, not pretty-printed.
 *
 * `JSON.stringify(evidence, null, 2)` cost 243 of the 1,028 tokens in a typical
 * call — a quarter of every request spent on indentation the model does not read.
 * Measured on this exact payload: 693 tokens pretty, 450 compact, identical
 * verdicts. The stored `evidence` column keeps the full object, so nothing is
 * lost from the audit trail; this is only what goes over the wire.
 */
const buildPrompt = (evidence) =>
  `Assess this employee's last window.\n\n${JSON.stringify(evidence)}`;

/**
 * Fingerprint the evidence that could actually change a verdict.
 *
 * The window timestamps are excluded on purpose: they move every single run, so
 * including them would make every fingerprint unique and the check pointless.
 * What is left is the assignments and the hours — if those are byte-identical to
 * what we last judged, the model has already answered this question.
 */
const fingerprint = (evidence) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        assignments: evidence.assignments,
        hours: evidence.hoursLoggedInWindow,
      }),
    )
    .digest('hex');

/**
 * How often Management has asked for the analysis to run, in hours.
 *
 * Falls back to the environment value if the setting has never been written,
 * and finally to 2. It is clamped rather than trusted: this number divides the
 * clock and sizes the window, and a zero or a negative here would mean either an
 * endless loop of runs or a window with no hours in it.
 */
export const getAnalysisIntervalHours = async () => {
  const raw = await settings.get(SETTING_KEY.AI_ANALYSIS_INTERVAL_HOURS, env.AI_ANALYSIS_WINDOW_HOURS);
  const n = Number(raw);
  if (!Number.isFinite(n)) return 2;
  return Math.min(12, Math.max(1, Math.round(n)));
};

/**
 * Run the analysis for one window.
 *
 * @param {object} [options]
 * @param {Date}   [options.windowEnd] defaults to now — injectable for tests.
 * @returns {Promise<string>} a one-line summary for the job log
 */
export const analyseWindow = async ({ windowEnd = new Date(), windowHours } = {}) => {
  if (!isAiConfigured()) return 'AI analysis skipped — no GEMINI_API_KEY, or disabled in settings';

  /**
   * The window ALWAYS matches the cadence Management has set.
   *
   * If it did not, the two numbers would drift apart and one of two silent bugs
   * would follow: a window shorter than the interval leaves hours nobody ever
   * looks at, and a window longer than it re-reads work that has already been
   * judged. Deriving one from the other makes both impossible.
   */
  const hours = windowHours ?? (await getAnalysisIntervalHours());
  const windowStart = dayjs(windowEnd).subtract(hours, 'hour').toDate();
  const workDate = toWorkDate(todayWorkDate());

  // Candidates: anyone who EITHER has open assigned work OR logged something in
  // the window. Somebody with neither has nothing to assess (rule 3), and asking
  // the model about them would only invite an invented concern.
  const candidates = await prisma.user.findMany({
    where: {
      status: 'ACTIVE',
      role: { in: [ROLE.EMPLOYEE, ROLE.TECH_LEAD] },
      departmentId: { not: null },
      /**
       * THE OPT-OUT IS ENFORCED HERE, IN THE SELECT — deliberately.
       *
       * A department that has switched analysis off is excluded before any of
       * its work is read. Its people are never candidates, so their assignments
       * and their hour descriptions are never loaded, never built into evidence,
       * and never sent anywhere. The alternative — analyse everyone and filter
       * the findings afterwards — would mean their work had already left the
       * network by the time we honoured the setting. That is not an opt-out.
       */
      department: { aiAnalysisEnabled: true },
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
  let skipped = 0;

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
        const evidenceHash = fingerprint(evidence);

        /**
         * NOTHING HAS CHANGED — SO SAY NOTHING.
         *
         * If the last finding for this person TODAY was reached from byte-identical
         * evidence, re-asking the model buys a second copy of an answer we already
         * have. It is the single largest source of waste in this job: on a normal
         * day most people's evidence is unchanged between two consecutive runs, and
         * every one of those was a paid call.
         *
         * Bounded to the current work date deliberately. Everyone still gets at
         * least one real assessment a day, so a carried-forward verdict can never
         * become the standing view of somebody's work for a week. And the finding
         * already on record stays visible and stays the finding — skipping means
         * "no new judgement", not "no judgement".
         */
        const lastToday = await prisma.aiInsight.findFirst({
          where: { userId: user.id, createdAt: { gte: workDate } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, evidenceHash: true },
        });

        if (lastToday?.evidenceHash && lastToday.evidenceHash === evidenceHash) {
          skipped += 1;
          continue;
        }

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
        const kind = INSIGHT_KINDS.includes(verdict.kind)
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
            evidenceHash,
            model: env.GEMINI_MODEL,
          },
          update: {
            kind,
            severity,
            alignmentScore: score,
            finding: String(verdict.finding ?? '').slice(0, 4000),
            recommendation: verdict.recommendation ? String(verdict.recommendation).slice(0, 2000) : null,
            evidence,
            evidenceHash,
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

  // `skipped` is reported, not hidden. A run that assessed nobody because nothing
  // changed looks identical in the logs to a run that was silently broken, and
  // the difference between those two matters at 3am.
  const skippedNote = skipped ? `, ${skipped} unchanged (not re-sent)` : '';
  return `AI analysis: ${analysed} assessed, ${flagged} flagged, ${failed} failed${skippedNote} (${env.GEMINI_MODEL})`;
};

// ---------------------------------------------------------------------------
// The period review — on demand, never on a schedule
// ---------------------------------------------------------------------------

/**
 * A DIFFERENT QUESTION, SO A DIFFERENT INSTRUCTION.
 *
 * The two-hourly analyser asks "is this hour going where it should?". This asks
 * "has this person actually moved in a fortnight?" — and the tell is not one bad
 * entry, it is a shape across days: the same work described three times in three
 * different wordings while the module it belongs to was closed a week ago.
 *
 * The conservatism here is deliberate and load-bearing. A review is run when
 * somebody already suspects something, which is exactly when a model is most
 * likely to be agreed with uncritically. Long, repetitive work is NORMAL on
 * large modules; saying so plainly is what keeps the finding worth reading when
 * it does fire.
 */
const REVIEW_INSTRUCTION = `You are reviewing ONE employee's logged work over a period of days in an engineering company's timesheet system.

You are given: the period, a per-day log of what they wrote, the work assigned to them, and the status of the project modules that work belongs to. Judge whether the period shows REAL PROGRESS.

What you are looking for:
- NO_PROGRESS: the same activity described repeatedly in different words across days, while the thing it refers to has not advanced. Strong evidence: the module is already COMPLETED, or logged effort has passed the estimate with the status unchanged. Quote the wordings side by side.
- IDLE: open assignments and working days with little or nothing logged.
- LOW_SUBSTANCE: entries too vague across the whole period to evidence any specific progress.
- MISALIGNED: sustained work on something the assignments do not call for.
- AT_RISK: a due date that the effort pattern will clearly not reach.
- ON_TRACK: the period shows real, varied, advancing work. This is a COMMON and correct answer.

Rules you must follow:
- Judge the WORK, never the person. No speculation about motive, character or honesty.
- REPETITION ALONE IS NOT A FINDING. Testing one large module for three weeks is normal engineering. Only report NO_PROGRESS when repetition is combined with hard evidence that the work was already finished or has overrun its estimate with nothing moving.
- A COMPLETED MODULE ALONE IS NOT A FINDING EITHER. Work logged after a module is marked complete is routine — bug fixes, review comments, follow-ups and hardening all arrive after sign-off. What matters is WHAT THE ENTRIES SAY. Distinct entries describing different, advancing work after completion are normal: answer ON_TRACK. NO_PROGRESS is for entries that RESTATE THE SAME ACTIVITY in different words, adding nothing — that is the pattern, and the completion date is only the corroboration.
- Before reporting NO_PROGRESS, ask yourself: could I quote two entries that describe the same activity in different words? If not, it is not NO_PROGRESS.
- ABSENCE OF DATA IS NOT EVIDENCE. This system holds no record of leave, sick days, secondments or onboarding, so a quiet period is explained just as well by any of them. If someone logged little or nothing, report IDLE at severity WARNING at most, and say plainly in the finding that leave or holiday would explain it equally well and should be checked first. Never CRITICAL for an empty period.
- CRITICAL requires POSITIVE evidence of a problem — work logged against a module already marked COMPLETED, sustained effort on something the assignments do not call for, or effort far past an estimate with nothing moving. Never for silence.
- IF "scope.project" IS SET, YOU ARE SEEING ONE PROJECT'S SHARE OF THIS PERSON'S TIME AND NOTHING ELSE. Every hour they logged on other projects has been withheld from you; "coverage.entriesElsewhere" is how many. A thin log with a non-zero count there means they were busy on other work, NOT that they were idle — do not report IDLE, and do not describe the period as quiet. Judge only whether the NAMED PROJECT advanced, and say so in those terms. Likewise MISALIGNED cannot be judged from a project-scoped view: work outside this project is invisible here, not absent.
- A Tech Lead's own sheet is often sparse by design: their day is spread across reviewing and unblocking other people. Do not read a lead's light log as idleness.
- If assignments are absent, say you could not assess alignment. Do not invent a concern.
- Be specific. Quote what they wrote, with dates, when it supports the point.
- alignmentScore: 0-100, how productive the period looks on this evidence. Omit it if you cannot judge.
- severity CRITICAL only for a clear, repeated, unambiguous problem across multiple days.
- assignmentRef: the id of the assignment your finding is about, or "" if none.

Write it for a manager to read in ten seconds and be able to defend in a conversation with the employee.`;

/** How many entries and assignments one review may show the model. */
const REVIEW_MAX_ENTRIES = 90;
const REVIEW_MAX_ASSIGNMENTS = 25;

/**
 * Everything the model sees about one person's period.
 *
 * Grouped BY DAY rather than as a flat list, because the pattern being looked
 * for is temporal: "these three sentences are nine days apart" is the finding,
 * and a flat list buries exactly that.
 */
const buildReviewEvidence = ({
  user,
  assignments,
  entries,
  from,
  to,
  workingDays,
  project = null,
  entriesElsewhere = 0,
}) => {
  const byDate = new Map();
  for (const e of entries) {
    const key = formatWorkDate(e.workDate);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push({
      wrote: String(e.description ?? '').slice(0, 200),
      project: e.project?.name ?? null,
      against: e.assignment?.title ?? null,
    });
  }

  return {
    employee: {
      name: fullName(user),
      code: user.employeeCode,
      department: user.department?.name ?? null,
    },
    period: { from: formatWorkDate(from), to: formatWorkDate(to), workingDays },
    /**
     * Present ONLY when the manager narrowed the review to one project, and it
     * changes how everything below must be read: the log is this project's
     * share of the period, not the period.
     */
    ...(project ? { scope: { project: project.name } } : {}),
    // Cheap, and it is what lets the model say "logged on 3 of 10 working days"
    // instead of guessing at coverage from the log alone.
    coverage: {
      daysWithEntries: byDate.size,
      totalEntries: entries.length,
      expectedPerDay: user.department?.requiredSlotsPerDay ?? null,
      /**
       * THE ONE NUMBER THAT STOPS A PROJECT FILTER LIBELLING SOMEBODY.
       *
       * Narrow a review to Schoolmate and a person who spent the fortnight
       * heads-down on Customer Portal shows up with an empty log — which reads
       * exactly like idleness and is nothing of the sort. Withholding their
       * other hours is right (the manager asked about Schoolmate), but
       * withholding the FACT of them turns a filter into an accusation. One
       * integer buys the model the difference between "did nothing" and
       * "was doing something else".
       */
      ...(project ? { entriesElsewhere } : {}),
    },
    assignments: assignments.map((a) => ({
      id: a.id,
      title: a.title,
      detail: a.description ?? null,
      project: a.project?.name ?? null,
      /**
       * THE HARD SIGNAL. A module carrying a COMPLETED status and a completion
       * date is not a similarity score — it is the project's own record that the
       * work is finished. Hours logged against it afterwards are a contradiction,
       * and that is the difference between a suspicion and a finding.
       */
      module: a.module
        ? {
            name: a.module.name,
            status: a.module.status,
            completedAt: a.module.completedAt ? formatWorkDate(a.module.completedAt) : null,
          }
        : null,
      status: a.status,
      priority: a.priority,
      dueDate: a.dueDate ? formatWorkDate(a.dueDate) : null,
      estimatedHours: a.estimatedHours ?? null,
      hoursLoggedTotal: a._count?.entries ?? 0,
    })),
    dailyLog: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, hours]) => ({ date, hours })),
  };
};

/**
 * Review a department's employees over a period.
 *
 * ── WHY THIS IS NOT A JOB ───────────────────────────────────────────────────
 *
 * It is only ever run by a person: Management picks a department and a number of
 * days and presses a button. That is a feature, not a limitation. A cron job
 * quietly building a case file about somebody every night is a different product
 * from a manager deliberately asking a question, and the second one is the one
 * worth having. It also means the cost is visible and chosen.
 *
 * NOBODY IS NOTIFIED. The scheduled analyser alerts leads because it catches
 * things worth correcting the same day. A review is retrospective — there is
 * nothing to correct in real time — so the result goes on the screen of the
 * person who asked for it, and no further. An employee receiving "you have been
 * reviewed" would learn only that they are under suspicion, which helps nobody.
 *
 * ── THE TWO NARROWINGS ──────────────────────────────────────────────────────
 *
 * Both optional, and BOTH DEFAULT TO OFF: press the button with neither set and
 * this is exactly the whole-department review it has always been. They exist
 * because "how is Schoolmate going?" and "what has Arjun been doing?" are real
 * questions a manager has, and answering them by reading a department-wide
 * result is work the machine should have done.
 *
 * They also make the expensive thing cheap. A review is one model call PER
 * PERSON; narrowing to one employee is one call instead of a dozen.
 *
 * @param {object} options
 * @param {string} options.departmentId
 * @param {number} options.days how far back to look
 * @param {string} [options.projectId] narrow the evidence to one project
 * @param {string} [options.userId] review one person instead of everybody
 * @param {object} options.actor
 */
export const reviewPeriod = async ({ departmentId, days, projectId, userId, actor }) => {
  if (!isAiConfigured()) {
    throw new BadRequestError('The AI analyser is not configured', { code: 'AI_NOT_CONFIGURED' });
  }

  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, name: true, aiAnalysisEnabled: true, requiredSlotsPerDay: true, workingWeekdays: true },
  });
  if (!department) throw new NotFoundError('Department');

  // The same opt-out, honoured the same way. A department that has switched
  // analysis off is not analysable on request either — otherwise the setting
  // means "not on a schedule", which is not what it says.
  if (!department.aiAnalysisEnabled) {
    throw new BadRequestError(
      `${department.name} has AI analysis switched off. Turn it on in the department settings first.`,
      { code: 'DEPARTMENT_OPTED_OUT' },
    );
  }

  /**
   * Both narrowings are validated AGAINST THE CHOSEN DEPARTMENT, not merely for
   * existence. A project id from another department would otherwise silently
   * match nothing and return "0 flagged" — a clean bill of health for a question
   * that was never actually asked.
   */
  let project = null;
  if (projectId) {
    project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, departmentId: true },
    });
    if (!project) throw new NotFoundError('Project');
    if (project.departmentId !== departmentId) {
      throw new BadRequestError(`${project.name} does not belong to ${department.name}`, {
        code: 'PROJECT_DEPARTMENT_MISMATCH',
      });
    }
  }

  let person = null;
  if (userId) {
    person = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, departmentId: true, status: true, role: true },
    });
    if (!person) throw new NotFoundError('Employee');
    if (person.departmentId !== departmentId) {
      throw new BadRequestError(`${fullName(person)} is not in ${department.name}`, {
        code: 'USER_DEPARTMENT_MISMATCH',
      });
    }
    /**
     * Said out loud rather than left to the people query, which would return an
     * empty set and report "0 assessed, 0 flagged" — a phrase a manager reads as
     * "nothing wrong with them", not as "I did not look".
     */
    if (person.status !== 'ACTIVE') {
      throw new BadRequestError(`${fullName(person)}'s account is not active, so there is nothing to review`, {
        code: 'USER_NOT_ACTIVE',
      });
    }
    if (![ROLE.EMPLOYEE, ROLE.TECH_LEAD].includes(person.role)) {
      throw new BadRequestError(`${fullName(person)} does not log hours, so there is nothing to review`, {
        code: 'USER_NOT_REVIEWABLE',
      });
    }
  }

  const to = toWorkDate(todayWorkDate());
  const from = toWorkDate(dayjs(to).subtract(days - 1, 'day').format('YYYY-MM-DD'));

  const weekdays = Array.isArray(department.workingWeekdays) ? department.workingWeekdays : [1, 2, 3, 4, 5];
  let workingDays = 0;
  for (let d = 0; d < days; d += 1) {
    if (weekdays.includes(isoWeekdayOf(dayjs(from).add(d, 'day').toDate()))) workingDays += 1;
  }

  /**
   * WHO GETS ASSESSED.
   *
   * Unnarrowed, this is EVERY active person in the department, not only those
   * with recent activity — idleness is the question being asked, and selecting
   * on "has logged something" would quietly exclude the exact people a manager
   * ran this to find.
   *
   * A named employee wins outright, even one with no visible connection to the
   * chosen project: an explicit instruction is not a filter to be second-guessed.
   * A project on its own gathers everyone connected to it three ways — on the
   * member list, holding an assignment, or having logged an hour in the period.
   * Membership alone would miss whoever is helping out without being on the
   * list, and hours alone would miss the person assigned to it who has not
   * started, who is the more interesting of the two.
   */
  const projectPeopleFilter = project
    ? {
        OR: [
          { projectMemberships: { some: { projectId: project.id } } },
          { assignedToMe: { some: { projectId: project.id } } },
          { taskEntries: { some: { projectId: project.id, workDate: { gte: from, lte: to } } } },
        ],
      }
    : {};

  const people = await prisma.user.findMany({
    where: {
      departmentId,
      status: 'ACTIVE',
      role: { in: [ROLE.EMPLOYEE, ROLE.TECH_LEAD] },
      ...(person ? { id: person.id } : projectPeopleFilter),
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      departmentId: true,
      teamId: true,
      department: { select: { id: true, name: true, requiredSlotsPerDay: true } },
    },
    orderBy: [{ firstName: 'asc' }],
    take: env.AI_MAX_EMPLOYEES_PER_RUN,
  });

  const scopeDto = { project: project?.name ?? null, employee: person ? fullName(person) : null };

  if (!people.length) {
    return {
      department: department.name,
      days,
      scope: scopeDto,
      assessed: 0,
      flagged: 0,
      failed: 0,
      results: [],
    };
  }

  const results = [];
  let flagged = 0;
  let failed = 0;

  const POOL = 4;
  const queue = [...people];

  const worker = async () => {
    while (queue.length) {
      const user = queue.shift();
      if (!user) return;

      try {
        const [assignments, entries, entriesElsewhere] = await Promise.all([
          prisma.assignment.findMany({
            where: {
              assigneeId: user.id,
              ...(project ? { projectId: project.id } : {}),
              // Open work, plus anything closed DURING the period — a module
              // completed mid-review is the most informative row on the page.
              OR: [
                { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED'] } },
                { updatedAt: { gte: from } },
              ],
            },
            select: {
              id: true,
              title: true,
              description: true,
              status: true,
              priority: true,
              dueDate: true,
              estimatedHours: true,
              project: { select: { name: true } },
              module: { select: { name: true, status: true, completedAt: true } },
              _count: { select: { entries: true } },
            },
            orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
            take: REVIEW_MAX_ASSIGNMENTS,
          }),
          prisma.taskEntry.findMany({
            where: {
              userId: user.id,
              workDate: { gte: from, lte: to },
              ...(project ? { projectId: project.id } : {}),
            },
            select: {
              description: true,
              workDate: true,
              project: { select: { name: true } },
              assignment: { select: { title: true } },
            },
            orderBy: { workDate: 'asc' },
            take: REVIEW_MAX_ENTRIES,
          }),
          // Counted, never read. See `coverage.entriesElsewhere`.
          project
            ? prisma.taskEntry.count({
                where: {
                  userId: user.id,
                  workDate: { gte: from, lte: to },
                  projectId: { not: project.id },
                },
              })
            : Promise.resolve(0),
        ]);

        const evidence = buildReviewEvidence({
          user,
          assignments,
          entries,
          from,
          to,
          workingDays,
          project,
          entriesElsewhere,
        });

        const result = await generateJson({
          prompt: `Review this employee's period.\n\n${JSON.stringify(evidence)}`,
          schema: RESPONSE_SCHEMA,
          system: REVIEW_INSTRUCTION,
        });

        if (!result.ok) {
          failed += 1;
          logger.warn('AI review failed for one employee', { userId: user.id, error: result.error });
          continue;
        }

        const verdict = result.data;
        const kind = INSIGHT_KINDS.includes(verdict.kind) ? verdict.kind : 'ON_TRACK';
        let severity = ['INFO', 'WARNING', 'CRITICAL'].includes(verdict.severity)
          ? verdict.severity
          : 'INFO';

        /**
         * ABSENCE OF DATA CANNOT BE THE STRONGEST POSSIBLE SIGNAL.
         *
         * Asked to review a quiet fortnight, the model reliably returns
         * IDLE/CRITICAL — and it is not wrong that nothing was logged, it is
         * wrong about what that proves. This system does not know about leave,
         * secondments, sick days or onboarding, so an empty period is equally
         * well explained by any of them. A manager reading CRITICAL against
         * somebody who was on annual leave learns to distrust the whole screen.
         *
         * Enforced HERE rather than in the prompt because the prompt already
         * says it and the model still did it. A rule that matters this much
         * belongs somewhere that cannot be talked out of it.
         */
        if (!entries.length && severity === 'CRITICAL') severity = 'WARNING';

        /**
         * THE SAME CLAMP, TIGHTENED FOR A PROJECT-SCOPED VIEW.
         *
         * "Logged nothing on Schoolmate this fortnight" while logging thirty
         * hours on Customer Portal is a fact about ALLOCATION, not about effort,
         * and the person reading it did not ask a question that could possibly
         * justify a warning against somebody's name. The instruction says so and
         * the model mostly obeys; this is what happens when it does not.
         */
        if (project && !entries.length && entriesElsewhere > 0) severity = 'INFO';
        const assignmentId = assignments.some((a) => a.id === verdict.assignmentRef)
          ? verdict.assignmentRef
          : null;
        const score =
          Number.isInteger(verdict.alignmentScore) &&
          verdict.alignmentScore >= 0 &&
          verdict.alignmentScore <= 100
            ? verdict.alignmentScore
            : null;

        /**
         * Keyed on the period, so re-running the same review updates its rows
         * rather than stacking a second opinion beside the first.
         *
         * The PROJECT is part of the key because a project-scoped verdict and a
         * whole-period verdict on the same fortnight are different findings, and
         * one must not overwrite the other. The EMPLOYEE narrowing deliberately
         * is not: reviewing one person over a period they were already reviewed
         * over is the same question asked again, and it should refresh the
         * answer rather than duplicate it.
         *
         * The unnarrowed key is byte-for-byte what it was, so reviews already on
         * file keep updating in place instead of stacking against a new format.
         */
        const dedupeKey = project
          ? `ai-review:${formatWorkDate(from)}:${formatWorkDate(to)}:p:${project.id}:${user.id}`
          : `ai-review:${formatWorkDate(from)}:${formatWorkDate(to)}:${user.id}`;

        const row = {
          dedupeKey,
          isReview: true,
          windowStart: from,
          windowEnd: to,
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
        };

        const insight = await prisma.aiInsight.upsert({
          where: { dedupeKey },
          create: row,
          update: {
            kind: row.kind,
            severity: row.severity,
            alignmentScore: row.alignmentScore,
            finding: row.finding,
            recommendation: row.recommendation,
            evidence: row.evidence,
            model: row.model,
          },
        });

        if (kind !== 'ON_TRACK') flagged += 1;
        results.push(toInsightDto({ ...insight, department: { id: department.id, name: department.name } }));
      } catch (error) {
        failed += 1;
        logger.warn('AI review errored for one employee', { userId: user.id, error: error.message });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(POOL, people.length) }, worker));

  // Worst first: a manager reading this wants the exceptions, not an alphabet.
  const rank = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  results.sort(
    (a, b) => rank[a.severity] - rank[b.severity] || (a.alignmentScore ?? 101) - (b.alignmentScore ?? 101),
  );

  // The narrowing belongs in the audit line. "Reviewed Tech Team" and "reviewed
  // Arjun Nair" are different acts, and only one of them is about a person.
  const narrowing = [project && `project ${project.name}`, person && fullName(person)]
    .filter(Boolean)
    .join(', ');

  audit.record({
    action: 'REPORT_EXPORTED',
    entityType: 'Department',
    entityId: departmentId,
    summary: `AI period review run on ${department.name}${narrowing ? ` (${narrowing})` : ''} over ${days} days — ${results.length} assessed, ${flagged} flagged`,
    actorId: actor?.id,
  });

  logger.info('AI period review complete', {
    departmentId,
    days,
    projectId: project?.id ?? null,
    userId: person?.id ?? null,
    assessed: results.length,
    flagged,
    failed,
  });

  return {
    department: department.name,
    days,
    scope: scopeDto,
    from: formatWorkDate(from),
    to: formatWorkDate(to),
    workingDays,
    assessed: results.length,
    flagged,
    failed,
    results,
  };
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
    // Default to the SCHEDULED feed. A review is a separate, deliberate artefact
    // and mixing the two would make a fortnight-long judgement look like
    // something that happened this afternoon.
    { isReview: query.isReview === true },
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
  isReview: i.isReview ?? false,
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
