import { Router } from 'express';
import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import * as service from './department.service.js';
import { ok, created, noContent } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import { FIELD_TYPE } from '../../config/constants.js';

const router = Router();
router.use(authenticate);

const idParam = z.object({ id: z.string().cuid() });

const hexColour = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex colour like #2563EB');

const timeSlotSchema = z
  .object({
    label: z.string().trim().max(32).optional(),
    /** Minutes from midnight. 600 = 10:00. Never a display string. */
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    isBreak: z.boolean().default(false),
    isOvertime: z.boolean().default(false),
  })
  .refine((s) => s.endMinute > s.startMinute, {
    message: 'The hour must end after it starts',
    path: ['endMinute'],
  });

const fieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'Use a code-style key: letters, numbers, underscores'),
  label: z.string().trim().min(1).max(120),
  type: z.enum(Object.values(FIELD_TYPE)),
  isRequired: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(80)).max(50).optional(),
  placeholder: z.string().trim().max(160).optional().or(z.literal('')),
  helpText: z.string().trim().max(240).optional().or(z.literal('')),
  maxLength: z.number().int().min(1).max(5000).optional().nullable(),
  minValue: z.number().int().optional().nullable(),
  maxValue: z.number().int().optional().nullable(),
  showInTable: z.boolean().default(false),
});

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(48)
    .regex(/^[A-Z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores only'),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  colorHex: hexColour.default('#2563EB'),
  icon: z.string().trim().max(48).optional().or(z.literal('')),
  sortOrder: z.number().int().min(0).max(999).optional(),
  requiredSlotsPerDay: z.number().int().min(1).max(24).default(7),
  workingWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
  aiAnalysisEnabled: z.boolean().default(true),
  timeSlots: z.array(timeSlotSchema).max(24).optional(),
  fields: z.array(fieldSchema).max(30).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  colorHex: hexColour,
  icon: z.string().trim().max(48).optional().or(z.literal('')),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(999),
  requiredSlotsPerDay: z.number().int().min(1).max(24),
  workingWeekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  // Optional, not required: an older client that omits it leaves the setting
  // untouched rather than defaulting analysis back on.
  aiAnalysisEnabled: z.boolean().optional(),
});

/**
 * The logging cadence. Every field is optional: an administrator changing only
 * the interval should not have to restate the working day they are happy with.
 * `breakStartMinute: null` is meaningful — it removes the break — which is why
 * these are nullable rather than merely absent.
 */
const minuteOfDay = z.number().int().min(0).max(1440);
const cadenceSchema = z.object({
  slotIntervalMinutes: z.number().int().min(15).max(480).optional(),
  dayStartMinute: minuteOfDay.optional(),
  dayEndMinute: minuteOfDay.optional(),
  breakStartMinute: minuteOfDay.nullable().optional(),
  breakEndMinute: minuteOfDay.nullable().optional(),
  dryRun: z.boolean().optional().default(false),
});

/**
 * @openapi
 * tags:
 *   name: Departments
 *   description: |
 *     Departments are DATA, not an enum — they can be created, edited and deleted
 *     at runtime, along with their working hours and their bespoke task fields.
 *
 *     Creating one is the whole payoff of the design: a new department's employees
 *     immediately get a task grid with its own columns and its own form, and it
 *     appears in Management's dropdowns, with no code change anywhere.
 */

/**
 * @openapi
 * /departments:
 *   get:
 *     tags: [Departments]
 *     summary: Departments visible to you
 *     responses:
 *       200: { description: Departments with headcount/team/project counts }
 *   post:
 *     tags: [Departments]
 *     summary: Create a department, with its working hours and custom fields
 *     responses:
 *       201: { description: Created }
 *       409: { description: That code is already in use }
 */
router
  .route('/')
  .get(
    authorize(PERMISSIONS.DEPARTMENT_READ),
    validate({ query: z.object({ includeInactive: queryBoolean() }) }),
    asyncHandler(async (req, res) =>
      ok(res, await service.listVisible(req.scope, { includeInactive: req.query.includeInactive })),
    ),
  )
  .post(
    authorize(PERMISSIONS.DEPARTMENT_MANAGE),
    validate({ body: createSchema }),
    asyncHandler(async (req, res) =>
      created(res, await service.create(req.body, req.user), { message: 'Department created' }),
    ),
  );

/**
 * @openapi
 * /departments/{id}/config:
 *   get:
 *     tags: [Departments]
 *     summary: Task-grid configuration for a department
 *     description: |
 *       The department's working-hour columns and its bespoke task fields. The task
 *       entry screen is rendered entirely from this payload — which is why every
 *       department has its own entry form without its own codebase.
 *     responses:
 *       200: { description: timeSlots + fieldDefinitions }
 */
router.get(
  '/:id/config',
  authorize(PERMISSIONS.DEPARTMENT_READ),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => ok(res, await service.getConfig(req.params.id, req.scope))),
);

/**
 * @openapi
 * /departments/{id}:
 *   get:
 *     tags: [Departments]
 *     summary: One department
 *   patch:
 *     tags: [Departments]
 *     summary: Update a department
 *   delete:
 *     tags: [Departments]
 *     summary: Delete a department
 *     description: |
 *       Refused if the department still contains employees, teams, projects or
 *       logged work — deleting it would orphan or destroy that history. The error
 *       names exactly what is in the way. To retire a department that holds history,
 *       set `isActive: false` instead: it vanishes from every dropdown while every
 *       row that references it stays intact and reportable.
 *     responses:
 *       204: { description: Deleted }
 *       409: { description: The department is not empty }
 */
router
  .route('/:id')
  .get(
    authorize(PERMISSIONS.DEPARTMENT_READ),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => ok(res, await service.getById(req.params.id, req.scope))),
  )
  .patch(
    authorize(PERMISSIONS.DEPARTMENT_MANAGE),
    validate({ params: idParam, body: updateSchema }),
    asyncHandler(async (req, res) =>
      ok(res, await service.update(req.params.id, req.body), { message: 'Department updated' }),
    ),
  )
  .delete(
    authorize(PERMISSIONS.DEPARTMENT_MANAGE),
    validate({ params: idParam }),
    asyncHandler(async (req, res) => {
      await service.remove(req.params.id, req.user);
      return noContent(res);
    }),
  );

// ---------------------------------------------------------------------------
// Working hours
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /departments/{id}/time-slots:
 *   post:
 *     tags: [Departments]
 *     summary: Add a working-hour column
 *     description: Rejects any hour that overlaps an existing column.
 *     responses:
 *       201: { description: Column added }
 *       409: { description: Overlaps an existing column }
 */
/**
 * @openapi
 * /departments/{id}/time-slots/rebuild:
 *   post:
 *     tags: [Departments]
 *     summary: Regenerate the grid columns from a working day and a logging interval
 *     description: |
 *       Management's control over how often employees must describe what they
 *       completed: every 1, 2 or 3 hours (any interval from 15 minutes to 8 hours).
 *
 *       Send `dryRun: true` to get the exact plan — the columns it would produce,
 *       and which existing ones would be retired — without writing anything. The
 *       preview is computed by the same planner as the write.
 *
 *       Columns carrying logged work are RETIRED, never deleted. Overtime columns
 *       are untouched.
 *     responses:
 *       200: { description: Rebuilt, or the plan when dryRun }
 *       400: { description: The working day, interval or break is not usable }
 */
router.post(
  '/:id/time-slots/rebuild',
  authorize(PERMISSIONS.DEPARTMENT_MANAGE),
  validate({ params: idParam, body: cadenceSchema }),
  asyncHandler(async (req, res) => {
    const result = await service.rebuildTimeSlots(req.params.id, req.body, req.user);
    return ok(res, result, {
      message: result.applied
        ? `Working hours rebuilt — ${result.requiredSlotsPerDay} columns of ${result.interval} minutes`
        : 'Preview only — nothing has been changed',
    });
  }),
);

router.post(
  '/:id/time-slots',
  authorize(PERMISSIONS.DEPARTMENT_MANAGE),
  validate({ params: idParam, body: timeSlotSchema }),
  asyncHandler(async (req, res) =>
    created(res, await service.addTimeSlot(req.params.id, req.body, req.scope), {
      message: 'Working hour added',
    }),
  ),
);

/**
 * @openapi
 * /departments/{id}/time-slots/overtime:
 *   post:
 *     tags: [Departments]
 *     summary: Append an overtime hour ("+" at the end of the task grid)
 *     description: |
 *       Adds the next hour after the department's current last column, flagged as
 *       overtime. An employee still working at 18:00 clicks "+", gets an 18:00–19:00
 *       column, and logs what they did — instead of having nowhere to put it, which
 *       is how overtime becomes invisible to the company.
 *
 *       The column is EXCLUDED from the required-hours count, so filling it never
 *       inflates a compliance score and — more importantly — NOT filling it never
 *       damages one. An overtime column that counted toward the requirement would
 *       silently make overtime mandatory.
 *
 *       Employees hold this permission: the person who worked late is the person
 *       who knows they worked late.
 *     responses:
 *       201: { description: Overtime hour appended }
 *       400: { description: The working day already reaches midnight }
 */
router.post(
  '/:id/time-slots/overtime',
  authorize(PERMISSIONS.TASK_ADD_OVERTIME),
  validate({ params: idParam }),
  asyncHandler(async (req, res) =>
    created(res, await service.addOvertimeSlot(req.params.id, req.scope), {
      message: 'Overtime hour added',
    }),
  ),
);

/**
 * @openapi
 * /departments/{id}/time-slots/overtime/{slotId}:
 *   delete:
 *     tags: [Departments]
 *     summary: Undo an extra (overtime) hour
 *     description: |
 *       The counterpart to the "+" button. Same permission as adding one, because
 *       an extra hour you cannot take back is a trap. Removes ONLY an overtime
 *       column, and ONLY while it is empty — a column with any logged work is
 *       kept, so nobody's record of a real hour can be undone out from under them.
 *     responses:
 *       200: { description: Extra hour removed }
 *       409: { description: The extra hour has work logged against it }
 */
router.delete(
  '/:id/time-slots/overtime/:slotId',
  authorize(PERMISSIONS.TASK_ADD_OVERTIME),
  validate({ params: idParam.extend({ slotId: z.string().cuid() }) }),
  asyncHandler(async (req, res) => {
    const result = await service.removeOvertimeSlot(req.params.id, req.params.slotId, req.scope);
    return ok(res, result, { message: result.message ?? 'Extra hour removed' });
  }),
);

/**
 * @openapi
 * /departments/{id}/time-slots/{slotId}:
 *   patch:
 *     tags: [Departments]
 *     summary: Edit a working-hour column
 *   delete:
 *     tags: [Departments]
 *     summary: Remove a working-hour column
 *     description: |
 *       Soft-deleted if work has already been logged against it — a hard delete
 *       would cascade those entries away and silently erase real work. The column
 *       simply stops appearing on new task sheets.
 */
router
  .route('/:id/time-slots/:slotId')
  .patch(
    authorize(PERMISSIONS.DEPARTMENT_MANAGE),
    validate({
      params: idParam.extend({ slotId: z.string().cuid() }),
      body: z.object({
        label: z.string().trim().max(32).optional(),
        startMinute: z.number().int().min(0).max(1439).optional(),
        endMinute: z.number().int().min(1).max(1440).optional(),
        isBreak: z.boolean().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().min(0).optional(),
      }),
    }),
    asyncHandler(async (req, res) =>
      ok(res, await service.updateTimeSlot(req.params.id, req.params.slotId, req.body), {
        message: 'Working hour updated',
      }),
    ),
  )
  .delete(
    authorize(PERMISSIONS.DEPARTMENT_MANAGE),
    validate({ params: idParam.extend({ slotId: z.string().cuid() }) }),
    asyncHandler(async (req, res) => {
      const result = await service.removeTimeSlot(req.params.id, req.params.slotId);
      return ok(res, result, { message: result.message ?? 'Working hour removed' });
    }),
  );

// ---------------------------------------------------------------------------
// Department-specific task fields
// ---------------------------------------------------------------------------

/**
 * @openapi
 * /departments/{id}/fields:
 *   post:
 *     tags: [Departments]
 *     summary: Add a department-specific task field
 *     description: |
 *       This field appears immediately on that department's task entry form, and
 *       nowhere else. It is validated server-side on every save, so the JSON column
 *       it lives in cannot become a schemaless dumping ground.
 */
router.post(
  '/:id/fields',
  authorize(PERMISSIONS.DEPARTMENT_MANAGE),
  validate({ params: idParam, body: fieldSchema }),
  asyncHandler(async (req, res) =>
    created(res, await service.addField(req.params.id, req.body), { message: 'Field added' }),
  ),
);

/**
 * @openapi
 * /departments/{id}/fields/{fieldId}:
 *   patch:
 *     tags: [Departments]
 *     summary: Edit a department-specific field
 *     description: |
 *       The KEY becomes immutable once tasks have been logged against it — renaming
 *       it would orphan every value already stored under the old key. Change the
 *       LABEL instead; that is what users actually see.
 *   delete:
 *     tags: [Departments]
 *     summary: Retire a field
 *     description: Soft delete. It leaves the form; its stored values remain queryable.
 */
router
  .route('/:id/fields/:fieldId')
  .patch(
    authorize(PERMISSIONS.DEPARTMENT_MANAGE),
    validate({
      params: idParam.extend({ fieldId: z.string().cuid() }),
      body: fieldSchema.partial().extend({
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().min(0).optional(),
      }),
    }),
    asyncHandler(async (req, res) =>
      ok(res, await service.updateField(req.params.id, req.params.fieldId, req.body), {
        message: 'Field updated',
      }),
    ),
  )
  .delete(
    authorize(PERMISSIONS.DEPARTMENT_MANAGE),
    validate({ params: idParam.extend({ fieldId: z.string().cuid() }) }),
    asyncHandler(async (req, res) =>
      ok(res, await service.removeField(req.params.id, req.params.fieldId), {
        message: 'Field retired',
      }),
    ),
  );

export default router;
