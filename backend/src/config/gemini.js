/**
 * The Gemini client.
 *
 * Deliberately a thin fetch wrapper rather than the vendor SDK: this app needs
 * exactly one call shape (one prompt in, one JSON object out), and a dependency
 * that ships its own transport, retry policy and auth handling is a large
 * surface to adopt for that. `fetch` is in the runtime already.
 *
 * TWO THINGS THIS FILE EXISTS TO GUARANTEE
 *
 * 1. THE MODEL RETURNS JSON, NOT PROSE. A model asked politely for JSON will,
 *    eventually, return ```json fenced markdown, or a sentence of preamble, and
 *    the parse blows up in the middle of the night. So the request pins
 *    `responseMimeType: application/json` AND a `responseSchema`, and the reader
 *    still defends itself against fences — belt and braces, because this runs
 *    unattended every two hours.
 *
 * 2. FAILURE IS NEVER FATAL. Every function here returns a result object rather
 *    than throwing. The analyser is an observer of the timesheet, and an
 *    observer that can take down the thing it observes is a liability: no key,
 *    no quota, no network, malformed answer — all of it degrades to "no insights
 *    this run" and the app carries on.
 */
import { env } from './env.js';
import { logger } from './logger.js';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Configured = a key exists AND the feature is on. Both are required. */
export const isAiConfigured = () => Boolean(env.GEMINI_API_KEY) && env.AI_ANALYSIS_ENABLED;

export const getAiStatus = () => ({
  configured: isAiConfigured(),
  enabled: env.AI_ANALYSIS_ENABLED,
  hasKey: Boolean(env.GEMINI_API_KEY),
  model: env.GEMINI_MODEL,
  windowHours: env.AI_ANALYSIS_WINDOW_HOURS,
});

/**
 * Models wrap JSON in ```json fences often enough that parsing the raw text is
 * a coin flip. Strip a fence if present, then parse; if THAT fails, salvage the
 * outermost {...} — a truncated-but-recoverable answer beats discarding a run.
 *
 * @param {string} text
 * @returns {object|null}
 */
export const parseModelJson = (text) => {
  if (!text || typeof text !== 'string') return null;

  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(unfenced);
  } catch {
    const first = unfenced.indexOf('{');
    const last = unfenced.lastIndexOf('}');
    if (first === -1 || last <= first) return null;
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
    } catch {
      return null;
    }
  }
};

/**
 * Ask Gemini for one structured JSON answer.
 *
 * @param {object}  options
 * @param {string}  options.prompt        the full prompt
 * @param {object}  [options.schema]      responseSchema, so the model is constrained
 * @param {string}  [options.system]      system instruction
 * @returns {Promise<{ ok: boolean, data?: object, error?: string, raw?: string }>}
 */
export const generateJson = async ({ prompt, schema, system }) => {
  if (!env.GEMINI_API_KEY) return { ok: false, error: 'GEMINI_API_KEY is not set' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${API_ROOT}/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          // Header, not a query string: a key in the URL ends up in access logs
          // and proxy history.
          'x-goog-api-key': env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          generationConfig: {
            // Near-deterministic: this is a judgement about a person's work, and
            // the same evidence should not produce a different verdict because
            // the sampler rolled differently.
            temperature: 0.2,
            responseMimeType: 'application/json',
            ...(schema ? { responseSchema: schema } : {}),
          },
        }),
      },
    );

    const bodyText = await response.text();

    if (!response.ok) {
      // Surface Google's own message — "API key not valid" and "quota exceeded"
      // need completely different responses from whoever reads the log.
      let detail = bodyText.slice(0, 300);
      try {
        detail = JSON.parse(bodyText)?.error?.message ?? detail;
      } catch {
        /* keep the raw slice */
      }
      return { ok: false, error: `Gemini ${response.status}: ${detail}` };
    }

    const payload = JSON.parse(bodyText);
    const candidate = payload?.candidates?.[0];

    // A blocked or truncated answer is not an answer. Say which, so the log
    // distinguishes "the model refused" from "the model broke".
    if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
      return { ok: false, error: `Gemini stopped: ${candidate.finishReason}` };
    }

    const raw = candidate?.content?.parts?.map((p) => p.text).join('') ?? '';
    const data = parseModelJson(raw);

    if (!data) return { ok: false, error: 'Gemini returned unparseable JSON', raw: raw.slice(0, 500) };

    return { ok: true, data, raw };
  } catch (error) {
    const reason = error.name === 'AbortError' ? `timed out after ${env.AI_REQUEST_TIMEOUT_MS}ms` : error.message;
    return { ok: false, error: `Gemini request failed: ${reason}` };
  } finally {
    clearTimeout(timeout);
  }
};

/** Round-trip check for the Settings screen: proves key, model and quota. */
export const pingGemini = async () => {
  if (!env.GEMINI_API_KEY) return { ok: false, error: 'GEMINI_API_KEY is not set' };

  const result = await generateJson({
    prompt: 'Reply with exactly {"ok":true} and nothing else.',
    schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] },
  });

  if (!result.ok) logger.warn('Gemini ping failed', { error: result.error });
  return result;
};
