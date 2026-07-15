/**
 * Cryptographic primitives. Everything security-sensitive is centralised here
 * so a reviewer has exactly one file to audit.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

// ---------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------

export const hashPassword = (plain) => bcrypt.hash(plain, env.BCRYPT_SALT_ROUNDS);

export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/**
 * Burns roughly the same CPU as a real bcrypt compare.
 *
 * WHY: `if (!user) return 401` returns in ~1ms while a real user returns in
 * ~250ms. That timing difference is a reliable account-enumeration oracle. On a
 * miss we hash against a dummy so both paths cost the same.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO1Cv3lWQx4b1Vv7v4l0rBcbNpQ0OcTQi';
export const burnTimingBudget = () => bcrypt.compare('timing-equalizer', DUMMY_HASH);

// ---------------------------------------------------------------------------
// Opaque tokens (refresh tokens, password-reset tokens)
// ---------------------------------------------------------------------------

/** 64 bytes of CSPRNG entropy, base64url. Never a JWT — these must be revocable. */
export const generateOpaqueToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');

/**
 * Refresh tokens are stored HASHED. A dump of `refresh_tokens` must not hand an
 * attacker a working session. SHA-256 (not bcrypt) is correct here: the input
 * already has 384 bits of entropy, so there is nothing to brute-force, and we
 * need this on the hot path of every token refresh.
 */
export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const generateFamilyId = () => crypto.randomUUID();

// ---------------------------------------------------------------------------
// OTP
// ---------------------------------------------------------------------------

/**
 * Numeric OTP from a CSPRNG. `Math.random()` is predictable and has no place
 * anywhere near an authentication flow.
 * Rejection sampling keeps the distribution uniform (naive `% 10` biases low digits).
 */
export const generateOtp = (length = env.OTP_LENGTH) => {
  let otp = '';
  while (otp.length < length) {
    const byte = crypto.randomBytes(1)[0];
    if (byte < 250) otp += String(byte % 10); // 250 = 25 * 10, so no modulo bias
  }
  return otp;
};

/** OTPs are low-entropy (10^6), so they get a real KDF, not SHA-256. */
export const hashOtp = (otp) => bcrypt.hash(otp, env.BCRYPT_SALT_ROUNDS);

export const verifyOtp = (otp, hash) => bcrypt.compare(otp, hash);

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const constantTimeEquals = (a, b) => {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

export const randomId = () => crypto.randomUUID();
