import { z } from 'zod';
import { queryBoolean } from '../../core/zod.js';
import { paginationSchema } from '../../core/pagination.js';
import { ROLE_LIST, USER_STATUS_LIST } from '../../config/constants.js';
import { emailField, passwordField } from '../auth/auth.dto.js';
import { fullName } from '../../utils/name.js';

export const listUsersQuerySchema = paginationSchema.extend({
  departmentId: z.string().cuid().optional(),
  teamId: z.string().cuid().optional(),
  role: z.enum(ROLE_LIST).optional(),
  status: z.enum(USER_STATUS_LIST).optional(),
  /** Employees with no team assigned — the "who has fallen through the cracks" filter. */
  unassigned: queryBoolean(),
});

const baseUserFields = {
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  // OPTIONAL — a person may have a single legal name. Empty string coerces to
  // null so "" and "no last name" are the same state in the database, not two.
  lastName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .nullable()
    .transform((v) => v || null),
  email: emailField,
  employeeCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, numbers and hyphens only'),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  designation: z.string().trim().max(120).optional().or(z.literal('')),
  role: z.enum(ROLE_LIST),
  departmentId: z.string().cuid().nullish(),
  teamId: z.string().cuid().nullish(),
  timezone: z.string().trim().max(64).optional(),
};

/**
 * A MANAGEMENT user is cross-departmental and therefore must NOT have a
 * department; a TECH_LEAD or EMPLOYEE without one has no scope at all and would
 * silently see nothing (or, if a future bug widened the scope, everything).
 * This invariant is enforced here so it cannot be violated by any caller.
 */
const departmentInvariant = (data, ctx) => {
  if (data.role === 'MANAGEMENT') {
    if (data.departmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['departmentId'],
        message: 'Management accounts are company-wide and cannot belong to a department',
      });
    }
    if (data.teamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['teamId'],
        message: 'Management accounts cannot belong to a team',
      });
    }
    return;
  }

  if (!data.departmentId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['departmentId'],
      message: 'A department is required for Tech Leads and Employees',
    });
  }
};

export const createUserSchema = z
  .object({
    ...baseUserFields,
    /** Optional: when omitted the server generates a strong temporary password. */
    password: passwordField.optional(),
    sendWelcomeEmail: z.boolean().default(true),
  })
  .superRefine(departmentInvariant);

export const updateUserSchema = z
  .object({
    ...baseUserFields,
    status: z.enum(USER_STATUS_LIST).optional(),
  })
  .partial()
  .superRefine((data, ctx) => {
    // Only enforce the invariant when role is actually being changed, otherwise
    // a PATCH of just `{ phone }` would demand a departmentId.
    if (data.role) departmentInvariant({ ...data }, ctx);
  });

export const resetUserPasswordSchema = z.object({
  /** Omit to auto-generate; the temporary password is returned to the admin once. */
  newPassword: passwordField.optional(),
  requireChange: z.boolean().default(true),
  notifyUser: z.boolean().default(true),
});

export const deactivateUserSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required').max(500),
});

// ---------------------------------------------------------------------------
// Output DTOs — the ONLY shapes a user record may leave the API in.
// A `select` in a repository can drift; a DTO function cannot silently start
// returning passwordHash.
// ---------------------------------------------------------------------------

export const toUserDto = (u) => ({
  id: u.id,
  employeeCode: u.employeeCode,
  email: u.email,
  firstName: u.firstName,
  lastName: u.lastName,
  fullName: fullName(u),
  phone: u.phone ?? null,
  designation: u.designation ?? null,
  avatarPath: u.avatarPath ?? null,
  role: u.role,
  status: u.status,
  timezone: u.timezone,
  departmentId: u.departmentId ?? null,
  department: u.department
    ? { id: u.department.id, code: u.department.code, name: u.department.name, colorHex: u.department.colorHex }
    : null,
  teamId: u.teamId ?? null,
  team: u.team ? { id: u.team.id, name: u.team.name } : null,
  lastLoginAt: u.lastLoginAt ?? null,
  mustChangePassword: u.mustChangePassword ?? false,
  createdAt: u.createdAt,
  deactivatedAt: u.deactivatedAt ?? null,
});

/** Minimal shape for dropdowns — never ship 40 fields to populate a <Select>. */
export const toUserOptionDto = (u) => ({
  id: u.id,
  employeeCode: u.employeeCode,
  fullName: fullName(u),
  role: u.role,
  departmentId: u.departmentId ?? null,
  teamId: u.teamId ?? null,
  avatarPath: u.avatarPath ?? null,
});

export const USER_SELECT = {
  id: true,
  employeeCode: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  designation: true,
  avatarPath: true,
  role: true,
  status: true,
  timezone: true,
  departmentId: true,
  teamId: true,
  lastLoginAt: true,
  mustChangePassword: true,
  createdAt: true,
  deactivatedAt: true,
  department: { select: { id: true, code: true, name: true, colorHex: true } },
  team: { select: { id: true, name: true } },
};
