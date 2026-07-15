/**
 * Shared Zod primitives for query-string parsing.
 *
 * ── THE BOOLEAN TRAP ─────────────────────────────────────────────────────────
 * `z.coerce.boolean()` is a footgun in a query string, and it is one that ships
 * silently. It applies JavaScript's `Boolean()`:
 *
 *     Boolean("true")   === true
 *     Boolean("false")  === true      ← every non-empty string is truthy
 *     Boolean("0")      === true
 *
 * So `GET /audit?success=false` — "show me only the FAILED events" — arrives at
 * the service as `success: true` and returns exactly the opposite of what was
 * asked for. Nothing errors. The filter just quietly lies.
 *
 * The same bug affects every boolean filter in a REST API written this way:
 * ?isLate=false, ?unreadOnly=false, ?includeInactive=false, ?isActive=false.
 *
 * `queryBoolean` parses the STRING, the way HTTP actually delivers it.
 */
import { z } from 'zod';

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off', '']);

/**
 * A boolean that survives the trip through a query string.
 *
 * Accepts: true/false (already boolean), "true"/"false", "1"/"0", "yes"/"no",
 * "on"/"off", and "" (= false). Anything else is a validation error rather than
 * a silent coercion — `?isLate=maybe` should be a 422, not a `true`.
 */
export const queryBoolean = () =>
  z
    .union([z.boolean(), z.string()])
    .transform((value, ctx) => {
      if (typeof value === 'boolean') return value;

      const normalised = value.trim().toLowerCase();
      if (TRUE_VALUES.has(normalised)) return true;
      if (FALSE_VALUES.has(normalised)) return false;

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Must be true or false',
      });
      return z.NEVER;
    })
    .optional();

/**
 * A boolean with a default, for bodies (where JSON gives us a real boolean but
 * a form post might give us a string).
 */
export const bodyBoolean = (defaultValue = false) =>
  z
    .union([z.boolean(), z.string()])
    .default(defaultValue)
    .transform((value) => {
      if (typeof value === 'boolean') return value;
      return TRUE_VALUES.has(value.trim().toLowerCase());
    });

export { z };
