/**
 * Tone → hex, for the admin enums: roles, user status, PROJECT status, audit
 * action families. These are the enums that survived — a task entry has no
 * status and no priority, because it records an hour that has already been
 * worked, so there is nothing left for it to be "in progress" on.
 *
 * The two extra hues are functions of the theme mode: a 600-weight hue that is
 * legible on white turns to mud on #020617.
 */
const EXTRA_HUES = {
  purple: { light: '#7C3AED', dark: '#A78BFA' },
  amber: { light: '#B45309', dark: '#FBBF24' },
};

export const toneHex = (tone, theme) => {
  if (EXTRA_HUES[tone]) return EXTRA_HUES[tone][theme.palette.mode];

  switch (tone) {
    case 'success':
      return theme.palette.success.main;
    case 'error':
      return theme.palette.error.main;
    case 'warning':
      return theme.palette.warning.main;
    case 'info':
      return theme.palette.info.main;
    case 'primary':
      return theme.palette.primary.main;
    default:
      return theme.palette.text.secondary;
  }
};

export const USER_STATUS_TONE = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  LOCKED: 'error',
};

export const ROLE_TONE = {
  MANAGEMENT: 'purple',
  TECH_LEAD: 'info',
  EMPLOYEE: 'neutral',
};

export const PROJECT_STATUS_TONE = {
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'info',
  ARCHIVED: 'neutral',
};

export const MODULE_STATUS_TONE = {
  PENDING: 'neutral',
  IN_PROGRESS: 'primary',
  COMPLETED: 'success',
};

/**
 * AI findings.
 *
 * NOTHING HERE IS RED, INCLUDING CRITICAL. Red in this product means "this
 * destroys data". A finding destroys nothing — it is the analyser asking a lead
 * to go and look at somebody's afternoon. Amber carries that urgency honestly;
 * red would make a routine two-hourly sweep read like an outage, and a screen
 * that cries wolf every two hours stops being read at all.
 */
export const INSIGHT_SEVERITY_TONE = {
  INFO: 'neutral',
  WARNING: 'warning',
  CRITICAL: 'amber',
};

export const INSIGHT_KIND_TONE = {
  MISALIGNED: 'purple',
  IDLE: 'amber',
  LOW_SUBSTANCE: 'warning',
  AT_RISK: 'warning',
  NO_PROGRESS: 'amber',
  ON_TRACK: 'success',
};

/**
 * Audit actions, coloured by FAMILY rather than individually — 35 distinct hues
 * is noise. The one thing an auditor scans for is the red band: destruction and
 * failed authentication.
 */
const DESTRUCTIVE = new Set([
  'USER_DEACTIVATED',
  'TASK_DELETED',
  'RETENTION_CLEANUP',
  'LOGIN_FAILED',
  'TOKEN_REUSE_DETECTED',
]);

const AUTH_ACTIONS = new Set([
  'LOGIN',
  'LOGOUT',
  'TOKEN_REFRESH',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_BY_ADMIN',
  'PROFILE_UPDATED',
  'AVATAR_UPLOADED',
]);

export const actionTone = (action) => {
  if (DESTRUCTIVE.has(action)) return 'error';
  if (AUTH_ACTIONS.has(action)) return 'info';
  if (action?.startsWith('TASK_')) return 'purple';

  // Administrative changes to the shape of the organisation itself.
  if (
    action?.startsWith('USER_') ||
    action === 'ROLE_CHANGED' ||
    action?.startsWith('TEAM_') ||
    action?.startsWith('PROJECT_') ||
    action?.startsWith('DEPARTMENT_') ||
    action === 'SETTING_UPDATED'
  ) {
    return 'amber';
  }

  return 'neutral';
};
