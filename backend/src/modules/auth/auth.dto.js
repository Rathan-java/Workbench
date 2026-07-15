/**
 * Auth request contracts (Zod).
 * These schemas ARE the API contract — Swagger is generated from them, and the
 * frontend's react-hook-form resolvers mirror them field for field.
 */
import { z } from 'zod';
import { env } from '../../config/env.js';
import { fullName } from '../../utils/name.js';

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(190)
  .email('Enter a valid email address');

/**
 * Password policy.
 *
 * Minimum length is 6, per requirement, and configurable via PASSWORD_MIN_LENGTH.
 *
 * ⚠ A NOTE FOR WHOEVER OWNS SECURITY HERE.
 * Six characters is short. Against a leaked bcrypt hash, a 6-character password
 * drawn from the ~95 printable ASCII characters is roughly 7×10¹¹ combinations —
 * recoverable offline. NIST SP 800-63B is explicit that LENGTH is the control
 * that does the work, and it recommends a minimum of 8.
 *
 * The composition rules below are therefore KEPT, and they are doing more of the
 * heavy lifting than they otherwise would: they are what stops "123456" and
 * "abcdef", which is what a 6-character minimum otherwise invites. If you also
 * remove these, the effective keyspace collapses to something a laptop chews
 * through in minutes.
 *
 * The lockout (5 attempts → 15 minutes) still bounds ONLINE guessing regardless.
 * This trade-off is a usability decision, made deliberately; raise
 * PASSWORD_MIN_LENGTH when you can.
 */
export const passwordField = z
  .string()
  .min(env.PASSWORD_MIN_LENGTH, `Password must be at least ${env.PASSWORD_MIN_LENGTH} characters`)
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

export const loginSchema = z.object({
  email: emailField,
  // Deliberately NOT `passwordField`: applying the policy to a *login* tells an
  // attacker which passwords could not possibly exist, and locks out any legacy
  // account whose password predates the current policy.
  password: z.string().min(1, 'Password is required').max(128),
  rememberMe: z.boolean().optional().default(false),
});

export const forgotPasswordSchema = z.object({
  email: emailField,
});

export const verifyOtpSchema = z.object({
  email: emailField,
  otp: z
    .string()
    .trim()
    .length(env.OTP_LENGTH, `Code must be ${env.OTP_LENGTH} digits`)
    .regex(/^\d+$/, 'Code must contain only digits'),
});

export const resetPasswordSchema = z
  .object({
    email: emailField,
    /** Issued by /verify-otp. Proves the OTP step was completed for THIS email. */
    resetToken: z.string().min(20).max(200),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((d) => d.currentPassword !== d.newPassword, {
    message: 'Your new password must be different from your current password',
    path: ['newPassword'],
  });

export const updateProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .max(32)
    .regex(/^[+\d\s()-]*$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
  designation: z.string().trim().max(120).optional().or(z.literal('')),
  timezone: z.string().trim().max(64).optional(),
});

/** Shape returned to the client on login/refresh. Never includes the hash. */
export const toAuthUserDto = (user) => ({
  id: user.id,
  employeeCode: user.employeeCode,
  email: user.email,
  firstName: user.firstName,
  lastName: user.lastName,
  fullName: fullName(user),
  phone: user.phone ?? null,
  designation: user.designation ?? null,
  avatarPath: user.avatarPath ?? null,
  role: user.role,
  status: user.status,
  timezone: user.timezone,
  mustChangePassword: user.mustChangePassword,
  departmentId: user.departmentId ?? null,
  department: user.department
    ? {
        id: user.department.id,
        code: user.department.code,
        name: user.department.name,
        colorHex: user.department.colorHex,
      }
    : null,
  teamId: user.teamId ?? null,
  team: user.team ? { id: user.team.id, name: user.team.name } : null,
  lastLoginAt: user.lastLoginAt ?? null,
});
