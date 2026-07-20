/**
 * The two-hourly AI analysis run.
 *
 * Thin on purpose: the judgement lives in ai.service, and this file only decides
 * WHETHER to run and holds the distributed lock so N App Service instances
 * produce exactly one run — the same discipline as every other job here, and it
 * matters more for this one, because a duplicate run means duplicate calls to a
 * metered API.
 *
 * A failure here is contained by design. withLock swallows the throw so a bad
 * response from the provider cannot take down the process that people are using
 * to log their hours.
 */
import { withLock } from './lock.js';
import { analyseWindow } from '../modules/ai/ai.service.js';
import { isAiConfigured } from '../config/gemini.js';

const JOB_NAME = 'ai-analysis';

export const runAiAnalysis = () =>
  withLock(JOB_NAME, 15 * 60, async () => {
    if (!isAiConfigured()) return 'AI analysis is not configured (no GEMINI_API_KEY, or disabled)';
    return analyseWindow();
  });

export const AI_ANALYSIS_JOB_NAME = JOB_NAME;
