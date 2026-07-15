/**
 * Date handling. This file exists because timezone bugs in a *timesheet* app
 * are not cosmetic — they silently file Monday's work under Sunday.
 *
 * THE CONTRACT
 *  - A "work date" is a calendar day, not an instant. It is stored in MySQL as
 *    DATE and represented in JS as a Date pinned to 00:00:00 UTC.
 *  - Anything that asks "what day is it *now*" must do so in the department's
 *    timezone (env.CRON_TIMEZONE / user.timezone), never the server's — an
 *    Azure App Service instance runs in UTC and would roll the day over at
 *    05:30 IST, mid-morning, wiping the grid out from under everybody.
 */
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import isoWeek from 'dayjs/plugin/isoWeek.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import { env } from '../config/env.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(isoWeek);
dayjs.extend(customParseFormat);

export const DATE_FORMAT = 'YYYY-MM-DD';

/** The business timezone. All "today" questions resolve against this. */
export const businessTz = () => env.CRON_TIMEZONE;

/**
 * 'YYYY-MM-DD' → a Date at exactly 00:00:00.000Z.
 * Prisma writes this into a MySQL DATE column with no drift in either direction.
 */
export const toWorkDate = (input) => {
  const s = typeof input === 'string' ? input : dayjs(input).format(DATE_FORMAT);
  const d = dayjs.utc(s, DATE_FORMAT, true);
  if (!d.isValid()) throw new Error(`Invalid work date: ${input}`);
  return d.startOf('day').toDate();
};

/** Date | string → 'YYYY-MM-DD'. Safe for API responses. */
export const formatWorkDate = (date) => dayjs.utc(date).format(DATE_FORMAT);

/** Today, in the business timezone, as a work date. */
export const todayWorkDate = (tz = businessTz()) =>
  toWorkDate(dayjs().tz(tz).format(DATE_FORMAT));

/** Minutes elapsed since local midnight, in the business timezone. */
export const minutesSinceMidnight = (tz = businessTz()) => {
  const now = dayjs().tz(tz);
  return now.hour() * 60 + now.minute();
};

/** ISO weekday of the business "today": 1 = Monday … 7 = Sunday. */
export const isoWeekdayToday = (tz = businessTz()) => dayjs().tz(tz).isoWeekday();

export const isoWeekdayOf = (date) => dayjs.utc(date).isoWeekday();

/** Inclusive [from, to] range, both work dates. */
export const workDateRange = (from, to) => ({
  gte: toWorkDate(from),
  lte: toWorkDate(to),
});

export const addDays = (date, days) => dayjs.utc(date).add(days, 'day').toDate();
export const subDays = (date, days) => dayjs.utc(date).subtract(days, 'day').toDate();

/** The cutoff for the 180-day retention job. */
export const retentionCutoff = (days = env.TASK_RETENTION_DAYS, tz = businessTz()) =>
  toWorkDate(dayjs().tz(tz).subtract(days, 'day').format(DATE_FORMAT));

export const startOfMonth = (date) => dayjs.utc(date).startOf('month').toDate();
export const endOfMonth = (date) => dayjs.utc(date).endOf('month').startOf('day').toDate();

/** Every date in [from, to] inclusive. Used by rollups and report gap-filling. */
export const eachWorkDate = (from, to) => {
  const out = [];
  let cursor = dayjs.utc(from);
  const end = dayjs.utc(to);
  // Guard against an accidental 10-year loop from a bad query param.
  let guard = 0;
  while (!cursor.isAfter(end) && guard++ < 3660) {
    out.push(cursor.toDate());
    cursor = cursor.add(1, 'day');
  }
  return out;
};

/** 600 → "10:00". Used for slot labels and reminder emails. */
export const minutesToLabel = (minutes) => {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const humanDate = (date) => dayjs.utc(date).format('DD MMM YYYY');

export { dayjs };
