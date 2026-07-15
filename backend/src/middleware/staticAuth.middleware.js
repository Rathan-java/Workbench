/**
 * Authentication for served files (avatars).
 *
 * THE PROBLEM
 * The rest of the API authenticates with `Authorization: Bearer <token>`. A
 * browser rendering `<img src="/uploads/avatars/….png">` cannot attach that
 * header — the img tag has no way to set one. So the ordinary `authenticate`
 * middleware would 401 every avatar in the application.
 *
 * THE THREE WAYS OUT, AND WHY THIS ONE
 *
 *  a) Serve /uploads with no auth at all.
 *     The filenames contain a UUID, so they are unguessable — and this is what
 *     most applications quietly do. But it is security by obscurity: the URL
 *     leaks in a Referer header, a shared screenshot, a proxy log, a browser
 *     history sync. An employee's photograph is personal data under GDPR, and
 *     "nobody will guess the filename" is not a defensible control.
 *
 *  b) Return avatars as base64 through the authenticated JSON API.
 *     Correct, but it defeats HTTP caching entirely — every dashboard render
 *     re-downloads thirty photographs inside a JSON payload.
 *
 *  c) THIS. Authenticate the file request with the refresh cookie, which the
 *     browser DOES send automatically on a same-origin img request.
 *     The cookie is httpOnly + SameSite=Strict, so it is unreadable by script
 *     and unusable cross-site. We verify it against the database exactly as the
 *     refresh endpoint would, but WITHOUT rotating it — a page with twelve
 *     avatars on it would otherwise fire twelve concurrent rotations and trip
 *     the reuse-detection tripwire, logging the user out for the crime of
 *     looking at a team page.
 *
 * The cost is one indexed lookup per uncached image. Since the files are served
 * `immutable` with a 7-day max-age and their names contain a UUID, that is once
 * per image per browser per week.
 */
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { hashToken } from '../utils/crypto.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { UnauthenticatedError } from '../core/errors.js';
import { asyncHandler } from '../core/asyncHandler.js';
import { USER_STATUS } from '../config/constants.js';

export const authenticateStatic = asyncHandler(async (req, _res, next) => {
  // A Bearer token still works — for API clients, tests, and anything fetching
  // the file with JavaScript rather than rendering it in an <img>.
  const header = req.get('authorization');
  if (header?.startsWith('Bearer ')) {
    verifyAccessToken(header.slice(7).trim());
    return next();
  }

  const raw = req.cookies?.[env.REFRESH_COOKIE_NAME];
  if (!raw) {
    throw new UnauthenticatedError('Authentication required to view this file', {
      code: 'FILE_AUTH_REQUIRED',
    });
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(raw) },
    select: {
      revokedAt: true,
      expiresAt: true,
      user: { select: { status: true } },
    },
  });

  // NOTE: deliberately NOT rotated, and a `replacedByHash` is NOT treated as
  // theft here. A rotated-but-not-yet-expired ancestor is a perfectly normal
  // thing for a page with several images to present mid-refresh. The reuse
  // tripwire belongs on /auth/refresh, where a replay actually grants a session;
  // here it would only ever produce false positives that sign people out.
  const valid =
    stored &&
    !stored.revokedAt &&
    stored.expiresAt > new Date() &&
    stored.user.status === USER_STATUS.ACTIVE;

  if (!valid) {
    throw new UnauthenticatedError('Your session is not valid', { code: 'FILE_AUTH_INVALID' });
  }

  next();
});

export default authenticateStatic;
