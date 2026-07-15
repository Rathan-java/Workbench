/**
 * Auth controllers.
 *
 * Controllers do exactly three things: read the validated request, call one
 * service method, and shape the response. No business logic, no Prisma, no
 * conditionals beyond response shaping. If a controller grows an `if` that is
 * about *policy*, it belongs in the service.
 */
import * as authService from './auth.service.js';
import { ok, created } from '../../core/ApiResponse.js';
import { asyncHandler } from '../../core/asyncHandler.js';
import { env } from '../../config/env.js';
import { refreshCookieOptions, clearRefreshCookieOptions } from '../../utils/jwt.js';
import { persistAvatar, removeAvatar } from '../../middleware/upload.middleware.js';
import { prisma } from '../../config/prisma.js';

const requestMeta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

/**
 * The refresh token goes into an httpOnly cookie and is NEVER returned in the
 * JSON body. The access token IS returned in the body, and the SPA keeps it in
 * memory only. Net effect: an XSS payload can steal at most a token that dies
 * in 15 minutes and cannot be renewed, because the renewal credential is
 * unreachable from JavaScript.
 */
const setRefreshCookie = (res, token) =>
  res.cookie(env.REFRESH_COOKIE_NAME, token, refreshCookieOptions());

export const login = asyncHandler(async (req, res) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body, requestMeta(req));
  setRefreshCookie(res, refreshToken);
  return ok(res, { user, accessToken }, { message: 'Signed in successfully' });
});

export const refresh = asyncHandler(async (req, res) => {
  const token = req.cookies?.[env.REFRESH_COOKIE_NAME];
  const { user, accessToken, refreshToken } = await authService.refresh(token, requestMeta(req));
  setRefreshCookie(res, refreshToken);
  return ok(res, { user, accessToken }, { message: 'Session refreshed' });
});

export const logout = asyncHandler(async (req, res) => {
  const token = req.cookies?.[env.REFRESH_COOKIE_NAME];
  await authService.logout(token, req.user, { allDevices: req.body?.allDevices === true });
  res.clearCookie(env.REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
  return ok(res, null, { message: 'Signed out successfully' });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.requestPasswordReset(req.body, requestMeta(req));
  return ok(res, { expiresInMinutes: result.expiresInMinutes }, { message: result.message });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyPasswordResetOtp(req.body);
  return ok(res, result, { message: 'Code verified. You can now set a new password.' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body, requestMeta(req));
  return ok(res, null, { message: result.message });
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword(req.user.id, req.body, requestMeta(req));
  // Every session was just revoked — including this one. Clear the cookie so the
  // SPA does not sit there firing doomed refresh calls.
  res.clearCookie(env.REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
  return ok(res, { reauthenticationRequired: true }, { message: result.message });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.id);
  return ok(res, { user, permissions: req.user.permissions, scope: req.scope.kind });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body);
  return ok(res, { user }, { message: 'Profile updated' });
});

export const uploadAvatar = asyncHandler(async (req, res) => {
  const existing = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { avatarPath: true },
  });

  const avatarPath = await persistAvatar(req.file, req.user.id);
  const user = await authService.updateAvatar(req.user.id, avatarPath);

  // Only after the new one is safely persisted.
  await removeAvatar(existing?.avatarPath);

  return created(res, { user }, { message: 'Profile picture updated' });
});

export const listSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.listSessions(
    req.user.id,
    req.cookies?.[env.REFRESH_COOKIE_NAME],
  );
  return ok(res, sessions);
});
