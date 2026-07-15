import { Router } from 'express';
import * as controller from './auth.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { authenticate, authorize } from '../../middleware/auth.middleware.js';
import { authLimiter, otpLimiter } from '../../middleware/rateLimit.middleware.js';
import { uploadAvatar } from '../../middleware/upload.middleware.js';
import { PERMISSIONS } from '../../core/permissions.js';
import {
  loginSchema,
  forgotPasswordSchema,
  verifyOtpSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
} from './auth.dto.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   name: Authentication
 *   description: Sign-in, session lifecycle, password recovery and profile.
 */

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Sign in
 *     description: |
 *       Returns a short-lived access token in the body and sets a rotating,
 *       httpOnly refresh cookie. After 5 failed attempts the account is locked
 *       for 15 minutes.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email, example: admin@ara-workbench.local }
 *               password: { type: string, format: password, example: ChangeMe@Admin123 }
 *     responses:
 *       200:
 *         description: Signed in. Access token in body, refresh token in httpOnly cookie.
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/login', authLimiter, validate({ body: loginSchema }), controller.login);

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     summary: Rotate the session
 *     description: |
 *       Exchanges the refresh cookie for a new access token AND a new refresh
 *       cookie. Replaying an already-rotated token revokes the entire token
 *       family — see the reuse-detection note in auth.service.js.
 *     security: []
 *     responses:
 *       200: { description: New access token issued }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/refresh', controller.refresh);

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Sign out
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               allDevices: { type: boolean, default: false }
 *     responses:
 *       200: { description: Signed out }
 */
router.post('/logout', controller.logout);

/**
 * @openapi
 * /auth/forgot-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Request a password reset code
 *     description: |
 *       Always responds 200 with the same message whether or not the account
 *       exists — this endpoint must not be usable to enumerate employees.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: A code has been sent if the account exists }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post(
  '/forgot-password',
  authLimiter,
  validate({ body: forgotPasswordSchema }),
  controller.forgotPassword,
);

/**
 * @openapi
 * /auth/verify-otp:
 *   post:
 *     tags: [Authentication]
 *     summary: Verify the reset code
 *     description: Returns a single-use reset token to be passed to /auth/reset-password.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, format: email }
 *               otp: { type: string, example: "482913" }
 *     responses:
 *       200: { description: Code verified; reset token issued }
 *       400: { description: Code invalid, incorrect or expired }
 *       429: { $ref: '#/components/responses/RateLimited' }
 */
router.post('/verify-otp', otpLimiter, validate({ body: verifyOtpSchema }), controller.verifyOtp);

/**
 * @openapi
 * /auth/reset-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Set a new password
 *     description: Revokes every active session for the account on success.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, resetToken, newPassword, confirmPassword]
 *             properties:
 *               email: { type: string, format: email }
 *               resetToken: { type: string }
 *               newPassword: { type: string, format: password }
 *               confirmPassword: { type: string, format: password }
 *     responses:
 *       200: { description: Password reset }
 *       400: { description: Reset token invalid or expired }
 */
router.post(
  '/reset-password',
  authLimiter,
  validate({ body: resetPasswordSchema }),
  controller.resetPassword,
);

// --- authenticated -------------------------------------------------------

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Authentication]
 *     summary: The signed-in user, their permissions and their access scope
 *     responses:
 *       200: { description: Current user }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', authenticate, controller.me);

/**
 * @openapi
 * /auth/change-password:
 *   post:
 *     tags: [Authentication]
 *     summary: Change your own password
 *     responses:
 *       200: { description: Password changed; re-authentication required }
 */
router.post(
  '/change-password',
  authenticate,
  authorize(PERMISSIONS.PASSWORD_CHANGE),
  validate({ body: changePasswordSchema }),
  controller.changePassword,
);

/**
 * @openapi
 * /auth/profile:
 *   patch:
 *     tags: [Authentication]
 *     summary: Update your own profile
 *     responses:
 *       200: { description: Profile updated }
 */
router.patch(
  '/profile',
  authenticate,
  authorize(PERMISSIONS.PROFILE_UPDATE),
  validate({ body: updateProfileSchema }),
  controller.updateProfile,
);

/**
 * @openapi
 * /auth/profile/avatar:
 *   post:
 *     tags: [Authentication]
 *     summary: Upload a profile picture
 *     description: PNG, JPEG or WebP. Verified by magic bytes, not by Content-Type.
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar: { type: string, format: binary }
 *     responses:
 *       201: { description: Avatar updated }
 *       413: { description: File too large }
 */
router.post(
  '/profile/avatar',
  authenticate,
  authorize(PERMISSIONS.PROFILE_UPDATE),
  uploadAvatar,
  controller.uploadAvatar,
);

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     tags: [Authentication]
 *     summary: List your active sessions
 *     responses:
 *       200: { description: Active sessions }
 */
router.get('/sessions', authenticate, controller.listSessions);

export default router;
