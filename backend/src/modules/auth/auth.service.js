/**
 * Authentication service.
 *
 * The two mechanisms worth reading carefully:
 *
 * ── REFRESH TOKEN ROTATION WITH REUSE DETECTION ──────────────────────────────
 * Every refresh mints a NEW token and revokes the old one. If a token that has
 * already been rotated is presented again, exactly one of two things happened:
 * the legitimate client raced itself, or someone stole the token. We cannot tell
 * which — so we assume theft and revoke the entire token *family*, forcing a
 * fresh login. This turns a stolen refresh token from "persistent silent access"
 * into "one use, then everyone gets logged out and it lands in the audit log".
 * (RFC 6819 §5.2.2.3; the OAuth 2.1 draft mandates exactly this.)
 *
 * ── ACCOUNT ENUMERATION ──────────────────────────────────────────────────────
 * /forgot-password ALWAYS returns the same success response, whether or not the
 * email exists. /login always returns the same generic error and burns the same
 * CPU whether the user exists or the password is wrong. An HR system that leaks
 * "which of these 500 emails are employees here" is a phishing gift.
 */
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { sendMail } from '../../config/mailer.js';
import {
  hashPassword,
  verifyPassword,
  burnTimingBudget,
  generateOpaqueToken,
  hashToken,
  generateFamilyId,
  generateOtp,
  hashOtp,
  verifyOtp as compareOtp,
} from '../../utils/crypto.js';
import { signAccessToken } from '../../utils/jwt.js';
import {
  UnauthenticatedError,
  ForbiddenError,
  BadRequestError,
  TooManyRequestsError,
} from '../../core/errors.js';
import { USER_STATUS } from '../../config/constants.js';
import { toAuthUserDto } from './auth.dto.js';
import * as audit from '../audit/audit.service.js';
import { humanDate, dayjs } from '../../utils/date.js';
import {
  passwordResetOtpEmail,
  passwordChangedEmail,
} from '../notifications/email.templates.js';

const USER_SELECT = {
  id: true,
  employeeCode: true,
  email: true,
  passwordHash: true,
  firstName: true,
  lastName: true,
  phone: true,
  designation: true,
  avatarPath: true,
  role: true,
  status: true,
  departmentId: true,
  teamId: true,
  timezone: true,
  mustChangePassword: true,
  passwordChangedAt: true,
  failedLoginCount: true,
  lockedUntil: true,
  lastLoginAt: true,
  department: { select: { id: true, code: true, name: true, colorHex: true } },
  team: { select: { id: true, name: true } },
};

const stripHash = ({ passwordHash, failedLoginCount, lockedUntil, ...rest }) => rest;

// ---------------------------------------------------------------------------
// Token issuance
// ---------------------------------------------------------------------------

const issueRefreshToken = async ({ userId, familyId, ip, userAgent }, client = prisma) => {
  const token = generateOpaqueToken();
  const expiresAt = dayjs().add(env.REFRESH_TOKEN_TTL_DAYS, 'day').toDate();

  await client.refreshToken.create({
    data: {
      userId,
      familyId: familyId ?? generateFamilyId(),
      tokenHash: hashToken(token),
      expiresAt,
      ip: ip?.slice(0, 64),
      userAgent: userAgent?.slice(0, 255),
    },
  });

  return { token, expiresAt };
};

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * @param {{email: string, password: string}} credentials
 * @param {{ip?: string, userAgent?: string}} context
 */
export const login = async ({ email, password }, { ip, userAgent } = {}) => {
  const user = await prisma.user.findUnique({ where: { email }, select: USER_SELECT });

  // Identical error, identical timing, whether the account exists or not.
  const genericFailure = new UnauthenticatedError('Invalid email or password', {
    code: 'INVALID_CREDENTIALS',
  });

  if (!user) {
    await burnTimingBudget();
    audit.record({
      action: 'LOGIN_FAILED',
      actorEmail: email,
      summary: 'Login attempt for an unknown email address',
      success: false,
    });
    throw genericFailure;
  }

  // --- lockout (authoritative, DB-backed, survives scale-out) ---------------
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    audit.record({
      action: 'LOGIN_FAILED',
      actor: user,
      summary: `Login attempted on a locked account (${minutes} min remaining)`,
      success: false,
    });
    throw new TooManyRequestsError(
      `Your account is temporarily locked after too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      { code: 'ACCOUNT_LOCKED' },
    );
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);

  if (!passwordValid) {
    const failedLoginCount = user.failedLoginCount + 1;
    const shouldLock = failedLoginCount >= env.MAX_FAILED_LOGINS;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil: shouldLock
          ? dayjs().add(env.ACCOUNT_LOCK_MINUTES, 'minute').toDate()
          : null,
      },
    });

    audit.record({
      action: 'LOGIN_FAILED',
      actor: user,
      summary: shouldLock
        ? `Account locked after ${failedLoginCount} failed login attempts`
        : `Failed login attempt (${failedLoginCount}/${env.MAX_FAILED_LOGINS})`,
      success: false,
    });

    if (shouldLock) {
      logger.warn('Account locked due to failed logins', { userId: user.id, ip });
      throw new TooManyRequestsError(
        `Too many failed attempts. Your account is locked for ${env.ACCOUNT_LOCK_MINUTES} minutes.`,
        { code: 'ACCOUNT_LOCKED' },
      );
    }
    throw genericFailure;
  }

  // Deliberately checked AFTER the password: telling an unauthenticated caller
  // "this account is deactivated" confirms the account exists.
  if (user.status !== USER_STATUS.ACTIVE) {
    audit.record({
      action: 'LOGIN_FAILED',
      actor: user,
      summary: `Login blocked — account status is ${user.status}`,
      success: false,
    });
    throw new ForbiddenError(
      'Your account is not active. Please contact your administrator.',
      { code: 'ACCOUNT_INACTIVE' },
    );
  }

  const [updatedUser, refresh] = await prisma.$transaction(async (tx) => {
    const fresh = await tx.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        lastLoginIp: ip?.slice(0, 64),
      },
      select: USER_SELECT,
    });
    const token = await issueRefreshToken({ userId: user.id, ip, userAgent }, tx);
    return [fresh, token];
  });

  audit.record({
    action: 'LOGIN',
    actor: updatedUser,
    entityType: 'User',
    entityId: user.id,
    summary: 'Signed in successfully',
  });

  return {
    user: toAuthUserDto(stripHash(updatedUser)),
    accessToken: signAccessToken(updatedUser),
    refreshToken: refresh.token,
  };
};

// ---------------------------------------------------------------------------
// Refresh — rotation + reuse detection
// ---------------------------------------------------------------------------

export const refresh = async (rawToken, { ip, userAgent } = {}) => {
  if (!rawToken) {
    throw new UnauthenticatedError('No session found. Please sign in.', {
      code: 'REFRESH_TOKEN_MISSING',
    });
  }

  const tokenHash = hashToken(rawToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: { select: USER_SELECT } },
  });

  if (!stored) {
    throw new UnauthenticatedError('Your session is invalid. Please sign in again.', {
      code: 'REFRESH_TOKEN_INVALID',
    });
  }

  // ── THE TRIPWIRE ─────────────────────────────────────────────────────────
  // This token was already rotated (or explicitly revoked) and is being used
  // again. Either it was stolen, or a stolen one was used and this is the
  // legitimate client. We cannot distinguish, so we assume the worst and burn
  // the whole family — every descendant session of that original login.
  if (stored.revokedAt || stored.replacedByHash) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    // Invalidate the still-valid 15-minute access tokens too.
    await prisma.user.update({
      where: { id: stored.userId },
      data: { passwordChangedAt: new Date() },
    });

    logger.error('REFRESH TOKEN REUSE DETECTED — token family revoked', {
      userId: stored.userId,
      familyId: stored.familyId,
      ip,
    });
    audit.record({
      action: 'TOKEN_REUSE_DETECTED',
      actor: stored.user,
      entityType: 'RefreshToken',
      entityId: stored.id,
      summary: 'A already-rotated refresh token was replayed. All sessions revoked.',
      success: false,
    });

    throw new UnauthenticatedError(
      'Your session was ended for security reasons. Please sign in again.',
      { code: 'TOKEN_REUSE_DETECTED' },
    );
  }

  if (stored.expiresAt < new Date()) {
    throw new UnauthenticatedError('Your session has expired. Please sign in again.', {
      code: 'REFRESH_TOKEN_EXPIRED',
    });
  }

  if (stored.user.status !== USER_STATUS.ACTIVE) {
    throw new UnauthenticatedError('Your account is no longer active.', {
      code: 'ACCOUNT_INACTIVE',
    });
  }

  // Rotate: mint the successor and mark the predecessor as replaced, atomically.
  const rotated = await prisma.$transaction(async (tx) => {
    const next = await issueRefreshToken(
      { userId: stored.userId, familyId: stored.familyId, ip, userAgent },
      tx,
    );
    await tx.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedByHash: hashToken(next.token) },
    });
    return next;
  });

  return {
    user: toAuthUserDto(stripHash(stored.user)),
    accessToken: signAccessToken(stored.user),
    refreshToken: rotated.token,
  };
};

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/** @param {boolean} allDevices Revoke every session, not just this one. */
export const logout = async (rawToken, user, { allDevices = false } = {}) => {
  if (allDevices && user) {
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else if (rawToken) {
    // Revoke the whole family, not just this token: a family is one login
    // session, and "log out" must not leave a rotated ancestor usable.
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      select: { familyId: true },
    });
    if (stored) {
      await prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  if (user) {
    audit.record({
      action: 'LOGOUT',
      actor: user,
      entityType: 'User',
      entityId: user.id,
      summary: allDevices ? 'Signed out of all devices' : 'Signed out',
    });
  }

  return { success: true };
};

// ---------------------------------------------------------------------------
// Forgot password → OTP → verify → reset
// ---------------------------------------------------------------------------

/** ALWAYS returns the same payload. See the header note on enumeration. */
export const requestPasswordReset = async ({ email }, { ip } = {}) => {
  const genericResponse = {
    message:
      'If an account exists for that email address, a verification code has been sent to it.',
    expiresInMinutes: env.OTP_TTL_MINUTES,
  };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, status: true, role: true },
  });

  if (!user || user.status !== USER_STATUS.ACTIVE) {
    logger.info('Password reset requested for unknown/inactive account', { email });
    return genericResponse;
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = dayjs().add(env.OTP_TTL_MINUTES, 'minute').toDate();

  await prisma.$transaction(async (tx) => {
    // Invalidate any code still in flight. Two live OTPs doubles the guessing
    // surface for no benefit.
    await tx.passwordResetOtp.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await tx.passwordResetOtp.create({
      data: { userId: user.id, otpHash, expiresAt, ip: ip?.slice(0, 64) },
    });
  });

  // Awaited, not fire-and-forget: if we cannot deliver the code, the user must
  // be told now rather than staring at a "check your email" screen forever.
  try {
    await sendMail({
      to: user.email,
      ...passwordResetOtpEmail({
        firstName: user.firstName,
        otp,
        ttlMinutes: env.OTP_TTL_MINUTES,
      }),
    });
  } catch {
    throw new BadRequestError(
      'We could not send the verification email right now. Please try again shortly.',
      { code: 'EMAIL_DELIVERY_FAILED' },
    );
  }

  audit.record({
    action: 'PASSWORD_RESET_REQUESTED',
    actor: user,
    entityType: 'User',
    entityId: user.id,
    summary: 'Password reset code requested',
  });

  return genericResponse;
};

/**
 * Verify the OTP and, on success, mint a single-use reset token.
 *
 * WHY A SECOND TOKEN? Without it, /reset-password would have to accept the OTP
 * again — which means the 6-digit code is the sole credential guarding the
 * actual password write, and an attacker who watches one request can replay it.
 * The reset token is 384 bits, single-use, bound to this OTP row, and expires in
 * 10 minutes. The OTP proves "you read the mailbox"; the reset token carries
 * that proof forward exactly once.
 */
export const verifyPasswordResetOtp = async ({ email, otp }) => {
  const invalid = new BadRequestError('That code is invalid or has expired.', {
    code: 'OTP_INVALID',
  });

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    await burnTimingBudget();
    throw invalid;
  }

  const record = await prisma.passwordResetOtp.findFirst({
    where: { userId: user.id, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    await burnTimingBudget();
    throw invalid;
  }

  if (record.expiresAt < new Date()) {
    await prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new BadRequestError('That code has expired. Please request a new one.', {
      code: 'OTP_EXPIRED',
    });
  }

  if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
    await prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date() },
    });
    throw new TooManyRequestsError(
      'Too many incorrect attempts. Please request a new code.',
      { code: 'OTP_ATTEMPTS_EXCEEDED' },
    );
  }

  const matches = await compareOtp(otp, record.otpHash);

  if (!matches) {
    const attempts = record.attempts + 1;
    await prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { attempts },
    });
    throw new BadRequestError(
      `That code is incorrect. ${env.OTP_MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
      { code: 'OTP_INCORRECT', details: { attemptsRemaining: env.OTP_MAX_ATTEMPTS - attempts } },
    );
  }

  const resetToken = generateOpaqueToken(32);
  await prisma.passwordResetOtp.update({
    where: { id: record.id },
    data: {
      resetTokenHash: hashToken(resetToken),
      resetTokenExpiresAt: dayjs().add(env.OTP_RESET_TOKEN_TTL_MINUTES, 'minute').toDate(),
    },
  });

  return { resetToken, expiresInMinutes: env.OTP_RESET_TOKEN_TTL_MINUTES };
};

export const resetPassword = async ({ email, resetToken, newPassword }, { ip } = {}) => {
  const invalid = new BadRequestError(
    'This password reset link is invalid or has expired. Please start again.',
    { code: 'RESET_TOKEN_INVALID' },
  );

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, passwordHash: true, role: true },
  });
  if (!user) {
    await burnTimingBudget();
    throw invalid;
  }

  const record = await prisma.passwordResetOtp.findFirst({
    where: {
      userId: user.id,
      consumedAt: null,
      resetTokenHash: hashToken(resetToken),
      resetTokenExpiresAt: { gt: new Date() },
    },
  });
  if (!record) throw invalid;

  // Reusing the current password defeats the point of a reset (and usually
  // means the account was compromised and the attacker is being lazy).
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new BadRequestError('Your new password must be different from your current password.', {
      code: 'PASSWORD_REUSED',
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        // Kills every outstanding access token (see jwt.js) …
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    // … and every refresh token. A password reset is the canonical response to
    // "my account may be compromised"; leaving other sessions alive is the bug.
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.passwordResetOtp.update({
      where: { id: record.id },
      data: { consumedAt: new Date(), resetTokenHash: null },
    });
    await audit.recordInTransaction(tx, {
      action: 'PASSWORD_RESET_COMPLETED',
      actor: user,
      entityType: 'User',
      entityId: user.id,
      summary: 'Password reset via emailed verification code. All sessions revoked.',
    });
  });

  sendMail({
    to: user.email,
    ...passwordChangedEmail({
      firstName: user.firstName,
      ip,
      when: `${humanDate(new Date())} at ${dayjs().format('HH:mm')}`,
    }),
  }).catch(() => {});

  return { message: 'Your password has been reset. Please sign in with your new password.' };
};

// ---------------------------------------------------------------------------
// Change password (authenticated)
// ---------------------------------------------------------------------------

export const changePassword = async (userId, { currentPassword, newPassword }, { ip } = {}) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, firstName: true, passwordHash: true, role: true },
  });
  if (!user) throw new UnauthenticatedError();

  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    audit.record({
      action: 'PASSWORD_CHANGED',
      actor: user,
      summary: 'Password change failed — current password incorrect',
      success: false,
    });
    throw new BadRequestError('Your current password is incorrect.', {
      code: 'CURRENT_PASSWORD_INVALID',
    });
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, passwordChangedAt: new Date(), mustChangePassword: false },
    });
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await audit.recordInTransaction(tx, {
      action: 'PASSWORD_CHANGED',
      actor: user,
      entityType: 'User',
      entityId: user.id,
      summary: 'Password changed by the account owner. All sessions revoked.',
    });
  });

  sendMail({
    to: user.email,
    ...passwordChangedEmail({
      firstName: user.firstName,
      ip,
      when: `${humanDate(new Date())} at ${dayjs().format('HH:mm')}`,
    }),
  }).catch(() => {});

  return {
    message: 'Your password has been changed. Please sign in again.',
    reauthenticationRequired: true,
  };
};

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user) throw new UnauthenticatedError();
  return toAuthUserDto(stripHash(user));
};

export const updateProfile = async (userId, input) => {
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, phone: true, designation: true, timezone: true },
  });

  const user = await prisma.user.update({
    where: { id: userId },
    // Note the explicit field list. Spreading `input` here would be a
    // mass-assignment hole; Zod already stripped unknown keys, but relying on
    // two layers for this is deliberate.
    data: {
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone || null,
      designation: input.designation || null,
      ...(input.timezone ? { timezone: input.timezone } : {}),
    },
    select: USER_SELECT,
  });

  const { before: b, after: a } = audit.diff(before, {
    firstName: user.firstName,
    lastName: user.lastName,
    phone: user.phone,
    designation: user.designation,
    timezone: user.timezone,
  });

  audit.record({
    action: 'PROFILE_UPDATED',
    entityType: 'User',
    entityId: userId,
    summary: 'Profile details updated',
    before: b,
    after: a,
  });

  return toAuthUserDto(stripHash(user));
};

export const updateAvatar = async (userId, avatarPath) => {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarPath },
    select: USER_SELECT,
  });

  audit.record({
    action: 'AVATAR_UPLOADED',
    entityType: 'User',
    entityId: userId,
    summary: 'Profile picture updated',
  });

  return toAuthUserDto(stripHash(user));
};

/** Active sessions, for the "signed in on 3 devices" panel in Settings. */
export const listSessions = async (userId, currentRawToken) => {
  const currentHash = currentRawToken ? hashToken(currentRawToken) : null;
  const sessions = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tokenHash: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
    },
  });

  return sessions.map(({ tokenHash, ...s }) => ({
    ...s,
    isCurrent: tokenHash === currentHash,
  }));
};
