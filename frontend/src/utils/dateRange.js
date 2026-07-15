/**
 * The date-range vocabulary shared by the dashboard and the reports builder.
 *
 * Presets stay RELATIVE in the URL (`?preset=last7`), never baked down to the
 * dates they happened to resolve to. A bookmarked "last 7 days" that silently
 * froze to one week in July is a link that lies to whoever opens it tomorrow.
 * Only `custom` persists explicit dateFrom/dateTo.
 */
import dayjs from 'dayjs';
import { formatApiDate, formatDate } from './format.js';

export const RANGE_PRESETS = Object.freeze([
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'custom', label: 'Custom range' },
]);

export const DEFAULT_PRESET = 'last30';

const PRESET_VALUES = RANGE_PRESETS.map((p) => p.value);

export const isRangePreset = (value) => PRESET_VALUES.includes(value);

/**
 * `thisMonth` ends TODAY, not on the last day of the month.
 * The trend endpoint gap-fills every day in the window with zeros, so a range
 * running into the future would paint a fortnight of 0% compliance for days
 * that simply haven't happened yet — a cliff that reads as a collapse.
 */
export const resolvePresetRange = (preset, now = dayjs()) => {
  const today = dayjs(now).startOf('day');

  switch (preset) {
    case 'today':
      return { dateFrom: formatApiDate(today), dateTo: formatApiDate(today) };

    case 'last7':
      return { dateFrom: formatApiDate(today.subtract(6, 'day')), dateTo: formatApiDate(today) };

    case 'thisMonth':
      return { dateFrom: formatApiDate(today.startOf('month')), dateTo: formatApiDate(today) };

    case 'lastMonth': {
      const previous = today.subtract(1, 'month');
      return {
        dateFrom: formatApiDate(previous.startOf('month')),
        dateTo: formatApiDate(previous.endOf('month')),
      };
    }

    case 'last30':
    default:
      return { dateFrom: formatApiDate(today.subtract(29, 'day')), dateTo: formatApiDate(today) };
  }
};

/**
 * The effective window for a filter state. A half-finished custom range, or one
 * entered backwards, must never reach the API — it would 422 or return nonsense.
 * @param {{preset?: string, dateFrom?: string, dateTo?: string}} value
 * @returns {{dateFrom: string, dateTo: string}}
 */
export const resolveRange = (value = {}) => {
  const preset = isRangePreset(value.preset) ? value.preset : DEFAULT_PRESET;

  if (preset !== 'custom') return resolvePresetRange(preset);

  const from = dayjs(value.dateFrom);
  const to = dayjs(value.dateTo);

  if (!from.isValid() || !to.isValid()) return resolvePresetRange(DEFAULT_PRESET);

  return from.isAfter(to)
    ? { dateFrom: formatApiDate(to), dateTo: formatApiDate(from) }
    : { dateFrom: formatApiDate(from), dateTo: formatApiDate(to) };
};

/**
 * The single day the snapshot endpoints (summary, compliance) are anchored to.
 * They take `date`, not a range — so a range is represented by its last day,
 * clamped to today because there is nothing to snapshot in the future.
 */
export const anchorDate = (range, now = dayjs()) => {
  const today = dayjs(now).startOf('day');
  const to = dayjs(range?.dateTo);

  if (!to.isValid() || to.isAfter(today)) return formatApiDate(today);
  return formatApiDate(to);
};

/** "13 Jul 2026" for a single day, "1 – 13 Jul 2026" for a window. */
export const describeRange = ({ dateFrom, dateTo } = {}) => {
  const from = dayjs(dateFrom);
  const to = dayjs(dateTo);

  if (!from.isValid() || !to.isValid()) return '';
  if (from.isSame(to, 'day')) return formatDate(from);

  if (from.isSame(to, 'year')) {
    const left = from.isSame(to, 'month') ? from.format('D') : from.format('D MMM');
    return `${left} – ${formatDate(to)}`;
  }

  return `${formatDate(from)} – ${formatDate(to)}`;
};

/** Inclusive day count — used to caption "over N days". */
export const countDays = ({ dateFrom, dateTo } = {}) => {
  const from = dayjs(dateFrom);
  const to = dayjs(dateTo);
  if (!from.isValid() || !to.isValid()) return 0;
  return Math.abs(to.diff(from, 'day')) + 1;
};

export const MONTH_OPTIONS = Object.freeze(
  Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: dayjs().month(i).format('MMMM'),
  })),
);

/** The API's year bound is 2020..2100; offer the window a manager plausibly wants. */
export const yearOptions = (now = dayjs()) => {
  const current = dayjs(now).year();
  return Array.from({ length: 6 }, (_, i) => current - i).filter((y) => y >= 2020);
};
