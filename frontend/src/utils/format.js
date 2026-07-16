import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import utc from 'dayjs/plugin/utc.js';

dayjs.extend(relativeTime);
dayjs.extend(utc);

export const DATE_FORMAT = 'DD MMM YYYY';
export const DATE_TIME_FORMAT = 'DD MMM YYYY, HH:mm';
/** The wire format the API expects for `date`, `dateFrom`, `dateTo`. */
export const API_DATE_FORMAT = 'YYYY-MM-DD';

const EM_DASH = '—';

export const formatDate = (value, format = DATE_FORMAT) => {
  if (!value) return EM_DASH;
  const date = dayjs(value);
  return date.isValid() ? date.format(format) : EM_DASH;
};

export const formatDateTime = (value) => formatDate(value, DATE_TIME_FORMAT);

/** For the API: always a plain calendar date, never an ISO timestamp. */
export const formatApiDate = (value) => {
  const date = dayjs(value);
  return date.isValid() ? date.format(API_DATE_FORMAT) : '';
};

/** "3 hours ago", "in 2 days". */
export const formatRelative = (value) => {
  if (!value) return EM_DASH;
  const date = dayjs(value);
  return date.isValid() ? date.fromNow() : EM_DASH;
};

/**
 * Two-letter monogram for an avatar fallback.
 * Accepts "Ada Lovelace" or a user-ish object with a fullName/first/last.
 */
export const initials = (name) => {
  if (!name) return '';

  const text =
    typeof name === 'string'
      ? name
      : [name.firstName, name.lastName].filter(Boolean).join(' ') || name.fullName || '';

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();

  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
};

export const truncate = (text, max = 60, suffix = '…') => {
  if (typeof text !== 'string') return '';
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - suffix.length)).trimEnd()}${suffix}`;
};

/**
 * Turn a machine identifier into readable words.
 *   'IN_PROGRESS'  -> 'In Progress'   (enum)
 *   'graceMinutes' -> 'Grace Minutes' (camelCase settings key)
 *   'toLead'       -> 'To Lead'
 *
 * The camelCase split is why a space is inserted BEFORE lowercasing — otherwise
 * the lowercase/uppercase boundary that marks a new word is gone before we can
 * see it, and 'graceMinutes' collapses to the run-on 'Graceminutes'.
 */
export const humanizeEnum = (value) => {
  if (!value) return '';
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase -> two words
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

/** 135 -> "2h 15m". Task durations come back from the API as minutes. */
export const formatDuration = (minutes) => {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return EM_DASH;

  const hours = Math.floor(total / 60);
  const mins = Math.round(total % 60);

  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
};

export const formatNumber = (value, options = {}) => {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat(undefined, options).format(number) : EM_DASH;
};

export const formatPercent = (value, fractionDigits = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(fractionDigits)}%` : EM_DASH;
};

export const fullName = (user) =>
  user?.fullName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || EM_DASH;

/** Re-exported so pages get the SAME dayjs instance, with our plugins already
 *  registered. Importing dayjs directly elsewhere silently loses relativeTime. */
export { dayjs };
