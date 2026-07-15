/**
 * The password policy, in one place.
 *
 * This is a mirror of `passwordField` in backend/src/modules/auth/auth.dto.js —
 * same minimum, same maximum, same four composition rules, same messages. When
 * the backend policy moves, this file moves with it; if the two drift, the user
 * gets a form that validates clean and a server that 422s, which is the worst
 * possible outcome.
 */
import { z } from 'zod';

/**
 * Must equal PASSWORD_MIN_LENGTH in the backend's .env, which auth.dto.js reads.
 * If these two drift, the user gets a form that validates clean and a server that
 * 422s — the worst of both worlds.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

/**
 * The checklist rendered live by <PasswordPolicy>. Order matters — it is the
 * order the user reads. Each `test` is the same predicate as the zod regex
 * below, kept as a function so the checklist can tick without running the whole
 * schema on every keystroke.
 */
export const PASSWORD_RULES = Object.freeze([
  { id: 'length', label: `At least ${PASSWORD_MIN} characters`, test: (v) => v.length >= PASSWORD_MIN },
  { id: 'lowercase', label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { id: 'uppercase', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'number', label: 'One number', test: (v) => /[0-9]/.test(v) },
  { id: 'special', label: 'One special character', test: (v) => /[^A-Za-z0-9]/.test(v) },
]);

/** The shared field schema — used by reset, force-change and the security tab. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Password must be at most ${PASSWORD_MAX} characters`)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

/**
 * Attaches the "confirmation must match" refinement. All three password forms
 * use the same `newPassword` / `confirmPassword` field names, so this composes
 * over any of their object schemas.
 */
export const withPasswordConfirmation = (schema) =>
  schema.refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/** True when every rule passes — drives the checklist's "all good" affordance. */
export const isPasswordCompliant = (value = '') => PASSWORD_RULES.every((rule) => rule.test(value));
