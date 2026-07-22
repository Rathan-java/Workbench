/**
 * The AI analysis run.
 *
 * Thin on purpose: the judgement lives in ai.service, and this file only decides
 * WHETHER to run and holds the distributed lock so N App Service instances
 * produce exactly one run — the same discipline as every other job here, and it
 * matters more for this one, because a duplicate run means duplicate calls to a
 * metered API.
 *
 * ── WHY THE CADENCE IS CHECKED HERE RATHER THAN IN THE CRON EXPRESSION ───────
 *
 * Management sets how often the analyser runs, from the Settings screen, and it
 * has to take effect without a redeploy. The obvious implementation — rewrite
 * the cron expression when the setting changes — means every instance has to be
 * told, and an instance that misses the message keeps the old schedule. So the
 * schedule is fixed and generous (hourly, working hours only) and the DECISION
 * lives here: has enough time passed since the last successful run?
 *
 * `lastRunAt` is on the lock row, which is shared by every instance, so the
 * answer is the same everywhere and a restart cannot cause a double run.
 *
 * A failure here is contained by design. withLock swallows the throw so a bad
 * response from the provider cannot take down the process that people are using
 * to log their hours.
 */
import { withLock, getLockState } from './lock.js';
import { analyseWindow, getAnalysisIntervalHours } from '../modules/ai/ai.service.js';
import { isAiConfigured } from '../config/gemini.js';

const JOB_NAME = 'ai-analysis';

export const runAiAnalysis = ({ force = false } = {}) =>
  withLock(JOB_NAME, 15 * 60, async () => {
    if (!isAiConfigured()) return 'AI analysis is not configured (no GEMINI_API_KEY, or disabled)';

    const intervalHours = await getAnalysisIntervalHours();

    if (!force) {
      const state = await getLockState(JOB_NAME);
      const lastRunAt = state?.lastRunAt;
      if (lastRunAt) {
        const elapsedHours = (Date.now() - new Date(lastRunAt).getTime()) / 3_600_000;
        // A minute of slack: cron fires a hair early or late, and without it a
        // 2-hour cadence would silently become a 3-hour one every other run.
        if (elapsedHours < intervalHours - 1 / 60) {
          const wait = (intervalHours - elapsedHours).toFixed(1);
          return `AI analysis not due — runs every ${intervalHours}h, next in ~${wait}h`;
        }
      }
    }

    // The window equals the cadence, so every logged hour is examined exactly once.
    return analyseWindow({ windowHours: intervalHours });
  });

export const AI_ANALYSIS_JOB_NAME = JOB_NAME;
