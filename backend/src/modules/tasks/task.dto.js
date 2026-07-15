import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import { paginationSchema } from '../../core/pagination.js';
import {
  DAY_STATUSES,
  TASK_DESCRIPTION_MIN,
  TASK_DESCRIPTION_MAX,
  TASK_REMARKS_MAX,
} from '../../config/constants.js';
import { formatWorkDate } from '../../utils/date.js';
import { fullName } from '../../utils/name.js';

const workDate = z.string().date('Use the format YYYY-MM-DD');

export const gridQuerySchema = z.object({
  date: workDate.optional(),
  /** Management/Tech Lead viewing someone else's sheet. Omitted = your own. */
  userId: z.string().cuid().optional(),
});

/**
 * Saving one hourly cell — WHAT you finished, and WHAT it was for.
 *
 * Two required fields. That is the whole contract, and it is deliberate: this
 * form is filled in roughly 1,500 times a day across the company, so every
 * additional required field costs real hours and buys a column nobody reads.
 *
 * `projectId` is required rather than optional. An optional index is not an
 * index — the moment 30% of hours have no project, "how is Project X going"
 * stops being answerable and every project report carries an invisible asterisk.
 * The department's "Internal / Non-project" project exists precisely so that
 * requiring it never forces anyone to lie.
 *
 * `version` is the optimistic-concurrency token. The client echoes back the
 * version it last read; if the server's row has moved on, we return 409 with the
 * current row rather than silently overwriting whatever the other tab wrote.
 * Omit it only when creating a brand-new entry.
 */
/**
 * The raw shape, BEFORE the project rule is applied.
 *
 * Kept as a plain ZodObject on purpose: `.superRefine()` returns a ZodEffects,
 * which has no `.extend()`. The routes layer needs to extend this with `date`
 * and `userId`, so the object and the rule are kept separate and recombined by
 * `withProjectRule()` below. Export the refined version as the default; nobody
 * should reach for the bare shape unless they are extending it.
 */
export const saveEntryShape = z.object({
  timeSlotId: z.string().cuid(),
  description: z
    .string()
    .trim()
    .min(
      TASK_DESCRIPTION_MIN,
      `Describe what you completed in at least ${TASK_DESCRIPTION_MIN} characters`,
    )
    .max(TASK_DESCRIPTION_MAX, `Keep it under ${TASK_DESCRIPTION_MAX} characters`),
  projectId: z.string().cuid().nullish(),
  remarks: z.string().trim().max(TASK_REMARKS_MAX).nullish(),
  /** Department-specific OPTIONAL fields; validated against TaskFieldDefinition. */
  attributes: z.record(z.unknown()).nullish(),
  version: z.number().int().min(1).optional(),
  /** true while the user is still typing — relaxes required-field checks. */
  isAutoSave: z.boolean().default(false),
});

/**
 * Whether a project is REQUIRED depends on WHOSE sheet it is, and the DTO cannot
 * know that — it has the payload, not the target user's role. An employee must
 * name a project; a Tech Lead's hours fall to the department's Internal bucket
 * when they leave it blank. So the requirement is enforced in task.service,
 * which has resolved the target and its role, and this stays a pass-through.
 *
 * Kept as a named wrapper (rather than deleted) so the routes layer, which
 * extends the shape with `date`/`userId`, has one obvious place to compose — and
 * so re-adding a payload-only rule later is a one-line change here.
 */
export const withProjectRule = (schema) => schema;

export const saveEntrySchema = withProjectRule(saveEntryShape);

/**
 * Saving the whole grid in one call.
 *
 * Why offer this at all when a per-cell endpoint exists? Because "Save all" on a
 * seven-column grid would otherwise be seven round trips, seven transactions and
 * seven chances to half-succeed. One request, one transaction, all-or-nothing.
 */
export const saveGridSchema = z.object({
  date: workDate,
  userId: z.string().cuid().optional(),
  entries: z.array(saveEntrySchema).min(1).max(24),
});

export const deleteEntrySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/** Approval transitions. A note is mandatory on rejection — "rejected, no
 *  reason given" is how an approval workflow loses the trust of its users. */
export const submitDaySchema = z.object({
  date: workDate,
  userId: z.string().cuid().optional(),
});

export const reviewDaySchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT', 'REOPEN']),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.decision === 'REJECT' && !data.note?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['note'],
        message: 'Explain what needs to change so the employee can act on it',
      });
    }
  });

/**
 * The monitoring / search screen.
 *
 * The three axes management actually asks about — an INDIVIDUAL, a PROJECT, a
 * DEPARTMENT — plus a date range. Everything here is either one of those or a
 * way of narrowing them. The old status/priority/module filters are gone with
 * the columns they filtered.
 */
export const listEntriesQuerySchema = paginationSchema.extend({
  departmentId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  projectId: z.string().cuid().optional(),
  dayStatus: z.enum(DAY_STATUSES).optional(),
  dateFrom: workDate.optional(),
  dateTo: workDate.optional(),
  /** Convenience filters — a manager thinks in months, not date ranges. */
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  isLate: queryBoolean(),
  editedByLead: queryBoolean(),
});

export const listDaysQuerySchema = paginationSchema.extend({
  departmentId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  status: z.enum(DAY_STATUSES).optional(),
  dateFrom: workDate.optional(),
  dateTo: workDate.optional(),
  /** Only sheets with at least one unfilled required slot. */
  incompleteOnly: queryBoolean(),
});

// ---------------------------------------------------------------------------
// Output DTOs
// ---------------------------------------------------------------------------

const toPersonDto = (u) =>
  u ? { id: u.id, fullName: fullName(u), avatarPath: u.avatarPath ?? null } : null;

/**
 * The employee whose hour this was — even if their account is gone.
 *
 * A deleted employee's work is PRESERVED (see user.service.destroy). The row
 * survives with `userId = NULL` and their name stamped into `employeeName`. This
 * resolver is what makes that stamped name visible everywhere the live user used
 * to be: in the monitor, in the history drawer, in every report and export.
 *
 * Without it, a preserved timesheet would render as an anonymous blank — the work
 * would technically still be there and would be useless, which is the worst of
 * both worlds.
 */
const toOwnerDto = (row) => {
  if (row.user) {
    return {
      id: row.user.id,
      fullName: fullName(row.user),
      employeeCode: row.user.employeeCode ?? row.employeeCode ?? null,
      avatarPath: row.user.avatarPath ?? null,
      isFormerEmployee: false,
    };
  }

  if (row.employeeName) {
    return {
      id: null,
      fullName: row.employeeName,
      employeeCode: row.employeeCode ?? null,
      avatarPath: null,
      /** The UI badges these — "this person no longer has an account". */
      isFormerEmployee: true,
    };
  }

  return null;
};

export const toEntryDto = (e) => ({
  id: e.id,
  timeSlotId: e.timeSlotId,
  timeSlot: e.timeSlot
    ? {
        id: e.timeSlot.id,
        label: e.timeSlot.label,
        startMinute: e.timeSlot.startMinute,
        endMinute: e.timeSlot.endMinute,
        sortOrder: e.timeSlot.sortOrder,
      }
    : undefined,
  description: e.description,
  projectId: e.projectId,
  project: e.project
    ? {
        id: e.project.id,
        code: e.project.code,
        name: e.project.name,
        isInternal: e.project.isInternal ?? false,
      }
    : null,
  remarks: e.remarks ?? null,
  attributes: e.attributes ?? null,
  version: e.version,
  isLate: e.isLate,
  editedByLead: e.editedByLead,
  workDate: formatWorkDate(e.workDate),
  userId: e.userId,
  // Falls back to the stamped name when the account has been deleted, so a
  // preserved timesheet is still attributable rather than anonymous.
  user: toOwnerDto(e),
  createdBy: toPersonDto(e.createdBy),
  updatedBy: toPersonDto(e.updatedBy),
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
  revisionCount: e._count?.revisions ?? undefined,
});

export const toDayDto = (d) => ({
  id: d.id,
  userId: d.userId,
  user: d.user
    ? {
        id: d.user.id,
        employeeCode: d.user.employeeCode,
        fullName: fullName(d.user),
        avatarPath: d.user.avatarPath ?? null,
        designation: d.user.designation ?? null,
        isFormerEmployee: false,
      }
    : // The account is gone but the timesheet was preserved. Render the name we
      // stamped onto the row at delete time.
      toOwnerDto(d),
  departmentId: d.departmentId,
  department: d.department
    ? { id: d.department.id, code: d.department.code, name: d.department.name, colorHex: d.department.colorHex }
    : null,
  teamId: d.teamId ?? null,
  team: d.team ? { id: d.team.id, name: d.team.name } : null,
  workDate: formatWorkDate(d.workDate),
  status: d.status,
  submittedAt: d.submittedAt ?? null,
  reviewedAt: d.reviewedAt ?? null,
  reviewedBy: toPersonDto(d.reviewedBy),
  reviewNote: d.reviewNote ?? null,
  filledSlots: d.filledSlots,
  expectedSlots: d.expectedSlots,
  completionRate:
    d.expectedSlots > 0 ? Math.round((d.filledSlots / d.expectedSlots) * 100) : 0,
  entries: d.entries?.map(toEntryDto),
  createdAt: d.createdAt,
  updatedAt: d.updatedAt,
});

export const toRevisionDto = (r) => ({
  id: r.id,
  revision: r.revision,
  action: r.action,
  snapshot: r.snapshot,
  changedFields: r.changedFields ?? null,
  reason: r.reason ?? null,
  actor: toPersonDto(r.actor),
  createdAt: r.createdAt,
});
