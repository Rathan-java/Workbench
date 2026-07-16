/**
 * Auto-approval of stale task sheets.
 *
 * A submitted sheet waits on a Tech Lead's review. If that review never comes —
 * the lead is on leave, swamped, or the sheet simply slipped past them — the
 * employee's day stays frozen: not the official record, and locked against their
 * own edits. That is a penalty for someone else's inaction.
 *
 * So once a sheet has gone unreviewed past the configured window (a full day by
 * default, tunable in Settings without a redeploy), the system approves it on
 * its own authority. Every such approval is written to the audit log and the
 * day's transition history, distinctly marked as automatic — so it is always
 * clear which sheets a human actually reviewed and which the clock did — and a
 * lead can still reopen and correct one afterwards.
 *
 * Runs hourly, so a sheet is approved within the hour of crossing the window.
 * Like every job here it takes a distributed lock first, so N App Service
 * instances still produce exactly one run.
 */
import { withLock } from './lock.js';
import * as settings from '../modules/settings/setting.service.js';
import { autoApproveStaleDays } from '../modules/tasks/task.service.js';
import { SETTING_KEY } from '../config/constants.js';

const JOB_NAME = 'auto-approval';

export const runAutoApproval = () =>
  withLock(JOB_NAME, 10 * 60, async () => {
    const [enabled, hours] = await Promise.all([
      settings.get(SETTING_KEY.AUTO_APPROVE_ENABLED, true),
      settings.get(SETTING_KEY.AUTO_APPROVE_HOURS, 24),
    ]);

    if (!enabled) return 'Auto-approval is disabled in settings';

    return autoApproveStaleDays(Number(hours) || 24);
  });

export const AUTO_APPROVAL_JOB_NAME = JOB_NAME;
