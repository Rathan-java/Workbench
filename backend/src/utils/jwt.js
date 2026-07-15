/**
 * Access-token issuance and verification.
 *
 * DESIGN: the access token is short-lived (15m), stateless, and carries the
 * caller's identity + role + department. It is NOT revocable — which is exactly
 * why it is short-lived, and why every token also carries `pwdAt`
 * (passwordChangedAt). On password change or forced logout we bump
 * `passwordChangedAt`, and every access token minted before that instant is
 * rejected on its next use. That gives us *bounded* revocation without a DB
 * lookup on every single request.
 */
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { UnauthenticatedError } from '../core/errors.js';

const ISSUER = 'ara-workbench';
const AUDIENCE = 'ara-workbench-api';

/**
 * @param {object} user
 * @returns {string}
 */
export const signAccessToken = (user) =>
  jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.departmentId ?? null,
      teamId: user.teamId ?? null,
      // Seconds, not ms — keeps the token small and the comparison integral.
      pwdAt: Math.floor(new Date(user.passwordChangedAt).getTime() / 1000),
    },
    env.JWT_ACCESS_SECRET,
    {
      expiresIn: env.JWT_ACCESS_TTL,
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithm: 'HS256',
    },
  );

/**
 * Verify + decode. Pinning `algorithms` is mandatory: without it, a token with
 * `"alg": "none"` (or an HMAC forged with the public key, in an RS256 setup) is
 * accepted. This is the single most common JWT vulnerability in the wild.
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
    });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      // The frontend interceptor keys off this code to trigger a silent refresh.
      throw new UnauthenticatedError('Your session has expired', { code: 'TOKEN_EXPIRED' });
    }
    throw new UnauthenticatedError('Invalid authentication token', { code: 'TOKEN_INVALID' });
  }
};

/** Cookie options for the refresh token. Every flag here is load-bearing. */
export const refreshCookieOptions = () => ({
  httpOnly: true, // JS cannot read it → XSS cannot steal the session
  secure: env.COOKIE_SECURE, // HTTPS only in production
  sameSite: 'strict', // CSRF cannot drive the refresh endpoint
  domain: env.COOKIE_DOMAIN || undefined,
  path: '/', // the refresh endpoint sits under the API prefix
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
});

export const clearRefreshCookieOptions = () => {
  const { maxAge, ...rest } = refreshCookieOptions();
  return rest;
};
