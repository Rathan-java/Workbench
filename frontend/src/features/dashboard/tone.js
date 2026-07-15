/**
 * Compliance thresholds, in one place.
 *
 * 85% is "logged the day", 60% is "logged some of it", below that the sheet is
 * effectively empty. These bands are what turn a number into a judgement, so
 * the leaderboard, the compliance panel and the KPI rail must all agree on them
 * — three components with three private opinions about what counts as bad is
 * how a dashboard stops being trusted.
 */
export const COMPLIANCE_GOOD = 85;
export const COMPLIANCE_FAIR = 60;

/** @returns {string} a resolved theme colour for the rate. */
export const complianceTone = (rate, theme) => {
  const value = Number(rate) || 0;
  if (value >= COMPLIANCE_GOOD) return theme.palette.success.main;
  if (value >= COMPLIANCE_FAIR) return theme.palette.warning.main;
  return theme.palette.warning.main;
};

/**
 * Team follow-up statuses, as the API classifies them.
 *
 * BACKFILLING is the one that earns its own colour: the team filled the hours
 * (fillRate is fine, often 100%) but filled them LATE. A green chip there would
 * hide precisely the behaviour the follow-up panel exists to surface, so it gets
 * amber — "done, but the data was a day late and the lead was flying blind".
 */
export const FOLLOW_UP_LABELS = {
  ON_TRACK: 'On track',
  BACKFILLING: 'Back-filling',
  AT_RISK: 'At risk',
  NOT_DUE: 'Nothing due yet',
};

/** @returns {string} a resolved theme colour for a follow-up status. */
export const followUpTone = (status, theme) => {
  if (status === 'ON_TRACK') return theme.palette.success.main;
  if (status === 'BACKFILLING') return theme.palette.warning.main;
  if (status === 'AT_RISK') return theme.palette.warning.main;
  return theme.palette.text.disabled;
};
