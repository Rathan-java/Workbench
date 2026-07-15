/**
 * Everything the department screens need to talk about working hours, colours and
 * custom fields — shared by the create wizard and the detail drawer so the two
 * can never drift apart.
 *
 * The wire format for an hour is MINUTES FROM MIDNIGHT (10:00 = 600), never a
 * display string: minutes sort, subtract and compare; "10:00 AM" does none of
 * those things. The `<input type="time">` values are converted at the boundary.
 */
import { z } from 'zod';
import { FIELD_TYPE } from '../../../utils/constants.js';

/** A department's identity is its colour. These are the hues that read well in both themes. */
export const PRESET_COLORS = Object.freeze([
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#CA8A04',
  '#059669',
  '#0891B2',
]);

export const DEFAULT_COLOR = PRESET_COLORS[0];

/** ISO-8601 weekday numbers: Monday is 1, Sunday is 7. The API stores exactly these. */
export const WEEKDAYS = Object.freeze([
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
]);

export const DEFAULT_WEEKDAYS = Object.freeze([1, 2, 3, 4, 5]);

export const FIELD_TYPE_OPTIONS = Object.freeze([
  { value: FIELD_TYPE.TEXT, label: 'Text' },
  { value: FIELD_TYPE.TEXTAREA, label: 'Long text' },
  { value: FIELD_TYPE.NUMBER, label: 'Number' },
  { value: FIELD_TYPE.SELECT, label: 'Dropdown (pick one)' },
  { value: FIELD_TYPE.MULTISELECT, label: 'Dropdown (pick many)' },
  { value: FIELD_TYPE.DATE, label: 'Date' },
  { value: FIELD_TYPE.BOOLEAN, label: 'Yes / no' },
  { value: FIELD_TYPE.DURATION_MINUTES, label: 'Duration (minutes)' },
  { value: FIELD_TYPE.URL, label: 'Link' },
]);

/** Only these two types carry a list of choices. */
export const hasOptions = (type) => type === FIELD_TYPE.SELECT || type === FIELD_TYPE.MULTISELECT;

const pad = (n) => String(n).padStart(2, '0');

/** 600 -> "10:00". The value an `<input type="time">` expects. */
export const minutesToTime = (minutes) =>
  `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;

/** "10:00" -> 600. Returns null for a blank or malformed value. */
export const timeToMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value ?? '');
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
};

/** The label the API would generate for an unlabelled column. */
export const slotLabel = (startMinute, endMinute) =>
  `${minutesToTime(startMinute)} - ${minutesToTime(endMinute)}`;

export const bySortOrder = (a, b) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.startMinute - b.startMinute;

/** The react-query key for one department's full config (hours + fields). */
export const departmentConfigKey = (id) => ['department-config', id];

/** "Mon–Fri" for a contiguous run, otherwise the explicit list. */
export const weekdaySummary = (days = []) => {
  const sorted = [...days].sort((a, b) => a - b);
  const labels = sorted.map(
    (day) => WEEKDAYS.find((weekday) => weekday.value === day)?.label ?? day,
  );

  const isRun = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
  return isRun && sorted.length > 2 ? `${labels[0]}–${labels[labels.length - 1]}` : labels.join(', ');
};

/**
 * The company's standard day, mirroring prisma/seed.js: 10:00–18:00 with an hour
 * for lunch. Eight columns, seven of them working — which is exactly the API's
 * default `requiredSlotsPerDay` of 7.
 */
export const STANDARD_DAY = Object.freeze(
  [
    [600, 660],
    [660, 720],
    [720, 780],
    [780, 840, true],
    [840, 900],
    [900, 960],
    [960, 1020],
    [1020, 1080],
  ].map(([startMinute, endMinute, isBreak = false]) => ({
    startMinute,
    endMinute,
    isBreak,
    label: isBreak ? 'Lunch' : slotLabel(startMinute, endMinute),
  })),
);

/** Working columns only — a break is not an hour anyone logs work against. */
export const workingSlotCount = (slots) => slots.filter((slot) => !slot.isBreak).length;

/**
 * The first pair of rows that share a minute.
 *
 * Two columns covering the same minute would let the same hour be logged twice and
 * counted twice in every report, so the API refuses them (TIME_SLOT_OVERLAP). It is
 * kinder to catch it here, while the admin is still holding all eight rows in their
 * head, than to bounce a whole wizard on submit.
 *
 * @param {Array<{startMinute: number, endMinute: number}>} slots
 * @param {string} [ignoreId] — the row being edited, which cannot overlap itself.
 */
export const findOverlap = (slots, ignoreId) => {
  const rows = slots
    .filter((slot) => ignoreId === undefined || slot.id !== ignoreId)
    .filter((slot) => Number.isInteger(slot.startMinute) && Number.isInteger(slot.endMinute))
    .slice()
    .sort((a, b) => a.startMinute - b.startMinute);

  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].startMinute < rows[i - 1].endMinute) {
      return { a: rows[i - 1], b: rows[i] };
    }
  }

  return null;
};

export const overlapMessage = (overlap) =>
  `"${overlap.a.label ?? slotLabel(overlap.a.startMinute, overlap.a.endMinute)}" and "${
    overlap.b.label ?? slotLabel(overlap.b.startMinute, overlap.b.endMinute)
  }" overlap. Two columns covering the same minute would let one hour of work be counted twice.`;

/* ------------------------------------------------------------------ *
 * Schemas — mirrors of backend/src/modules/departments/department.routes.js
 * ------------------------------------------------------------------ */

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a hex colour like #2563EB');

/** Step 1 of the wizard, and (minus `code`) the drawer's Details tab. */
export const departmentDetailsSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(48)
    .regex(/^[A-Z0-9_-]+$/, 'Letters, numbers, hyphens and underscores only'),
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  description: z.string().trim().max(500).or(z.literal('')),
  colorHex: hexColorSchema,
  icon: z.string().trim().max(48).or(z.literal('')),
  requiredSlotsPerDay: z.coerce
    .number()
    .int('Whole hours only')
    .min(1, 'At least 1')
    .max(24, 'At most 24'),
  workingWeekdays: z
    .array(z.number().int().min(1).max(7))
    .min(1, 'Pick at least one working day')
    .max(7),
});

/** The drawer's Details tab: `code` is immutable, `isActive` and `sortOrder` are not. */
export const departmentEditSchema = departmentDetailsSchema.omit({ code: true }).extend({
  isActive: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export const timeSlotSchema = z
  .object({
    label: z.string().trim().max(32).or(z.literal('')),
    start: z.string().min(1, 'Required'),
    end: z.string().min(1, 'Required'),
    isBreak: z.boolean(),
  })
  .superRefine((values, ctx) => {
    const startMinute = timeToMinutes(values.start);
    const endMinute = timeToMinutes(values.end);

    if (startMinute === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['start'], message: 'Enter a valid time' });
    }
    if (endMinute === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'Enter a valid time' });
      return;
    }
    if (endMinute === 0) {
      // 1440, not 0: an hour that ends at midnight ends at the END of the day.
      // The API's endMinute range is 1..1440, so a literal 0 would be rejected.
      return;
    }
    if (startMinute !== null && endMinute <= startMinute) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['end'],
        message: 'The hour must end after it starts',
      });
    }
  });

/** `endMinute` 0 means midnight-at-the-end-of-the-day, which the API calls 1440. */
export const endMinuteFor = (value) => {
  const minutes = timeToMinutes(value);
  return minutes === 0 ? 1440 : minutes;
};

export const taskFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Required')
      .max(64)
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_]*$/,
        'Start with a letter; then letters, numbers and underscores only',
      ),
    label: z.string().trim().min(1, 'Required').max(120),
    type: z.enum(Object.values(FIELD_TYPE)),
    isRequired: z.boolean(),
    showInTable: z.boolean(),
    options: z.array(z.string().trim().min(1).max(80)).max(50),
  })
  .superRefine((values, ctx) => {
    // A dropdown with nothing to drop down is a dead control on someone's daily form.
    if (hasOptions(values.type) && values.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'A dropdown needs at least one choice',
      });
    }
  });

export const EMPTY_FIELD = Object.freeze({
  key: '',
  label: '',
  type: FIELD_TYPE.TEXT,
  isRequired: false,
  showInTable: false,
  options: [],
});

/** Shapes a field (from the form or from the API) into the API's create/update body. */
export const toFieldBody = (field) => ({
  key: field.key,
  label: field.label,
  type: field.type,
  isRequired: field.isRequired,
  showInTable: field.showInTable,
  options: hasOptions(field.type) ? field.options : undefined,
});
