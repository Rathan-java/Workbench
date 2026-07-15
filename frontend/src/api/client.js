import axios from 'axios';

export const API_BASE_URL = '/api/v1';

/**
 * The access token lives here and nowhere else.
 *
 * Not localStorage, not sessionStorage: anything readable from JS is readable by
 * any XSS payload that lands on the page, and a stolen bearer token is valid for
 * its full 15-minute life on any machine. Module scope dies with the tab. The
 * long-lived refresh token is an httpOnly cookie the JS never sees, so a page
 * reload restores the session (see AuthContext) without ever persisting a
 * credential we could leak.
 */
let accessToken = null;

export const setAccessToken = (token) => {
  accessToken = token ?? null;
};
export const getAccessToken = () => accessToken;
export const clearAccessToken = () => {
  accessToken = null;
};

/** Called when refresh fails — AuthContext registers a handler to wipe state. */
let onAuthFailure = null;
export const setAuthFailureHandler = (fn) => {
  onAuthFailure = typeof fn === 'function' ? fn : null;
};

export const client = axios.create({
  baseURL: API_BASE_URL,
  // Required: the refresh token is an httpOnly cookie and must ride along.
  withCredentials: true,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Endpoints that must never trigger a refresh — they ARE the auth handshake. */
const NO_REFRESH_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/forgot-password',
  '/auth/verify-otp',
  '/auth/reset-password',
];

const isAuthHandshake = (url = '') => NO_REFRESH_PATHS.some((p) => url.includes(p));

/** Normalised error every caller can rely on. */
export class ApiError extends Error {
  constructor({ status, code, message, details, correlationId }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.message = message;
    this.details = details;
    this.correlationId = correlationId;
  }
}

const normaliseError = (error) => {
  if (axios.isCancel?.(error) || error.code === 'ERR_CANCELED') {
    return new ApiError({
      status: 0,
      code: 'CANCELLED',
      message: 'Request cancelled',
    });
  }

  const response = error.response;

  if (!response) {
    return new ApiError({
      status: 0,
      code: error.code === 'ECONNABORTED' ? 'TIMEOUT' : 'NETWORK_ERROR',
      message:
        error.code === 'ECONNABORTED'
          ? 'The request timed out. Please try again.'
          : 'Unable to reach the server. Check your connection.',
    });
  }

  const envelope = response.data ?? {};
  const apiError = envelope.error ?? {};

  return new ApiError({
    status: response.status,
    code: apiError.code ?? 'ERROR',
    message: apiError.message ?? error.message ?? 'Something went wrong.',
    details: apiError.details,
    correlationId: envelope.correlationId,
  });
};

/* ------------------------------------------------------------------ *
 * Request: attach the in-memory bearer token.
 * ------------------------------------------------------------------ */
client.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

/* ------------------------------------------------------------------ *
 * Response: unwrap the envelope, and transparently refresh on expiry.
 * ------------------------------------------------------------------ */

/**
 * The single in-flight refresh.
 *
 * A dashboard fires a dozen queries at once. When the token expires they all
 * 401 within the same tick. Without this, each would POST /auth/refresh — and
 * because the backend rotates refresh tokens and treats a replayed one as theft
 * (TOKEN_REUSE_DETECTED), the 2nd..Nth calls would revoke the whole session and
 * log the user out. So: the first 401 owns the refresh, everyone else awaits
 * the same promise.
 */
let refreshPromise = null;

const refreshSession = () => {
  if (!refreshPromise) {
    refreshPromise = client
      .post('/auth/refresh')
      .then((envelope) => {
        const token = envelope?.data?.accessToken;
        if (!token) throw new Error('No access token in refresh response');
        setAccessToken(token);
        return envelope.data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

/**
 * A `responseType: 'blob'` request gets its ERROR envelope as a Blob too — so
 * `response.data.error.code` is undefined and every failed download looks like
 * an anonymous "Request failed with status code 429".
 *
 * Worse, the TOKEN_EXPIRED branch below would never match, so a download with a
 * stale token could never refresh and retry. Re-hydrate the JSON before anyone
 * reads it.
 */
const hydrateBlobError = async (response) => {
  if (!(response?.data instanceof Blob)) return;

  try {
    const text = await response.data.text();
    response.data = JSON.parse(text);
  } catch {
    // A genuinely binary/opaque error body — leave it; normaliseError copes.
  }
};

client.interceptors.response.use(
  // Return the FULL envelope, not envelope.data — callers need `meta.pagination`.
  // `rawResponse: true` opts out entirely, for callers that need the headers
  // (a file download reads its filename from Content-Disposition).
  (response) => (response.config?.rawResponse ? response : response.data),
  async (error) => {
    const original = error.config;
    const response = error.response;

    await hydrateBlobError(response);

    const code = response?.data?.error?.code;

    const shouldRefresh =
      response?.status === 401 &&
      code === 'TOKEN_EXPIRED' &&
      original &&
      !original._retried &&
      !isAuthHandshake(original.url);

    if (!shouldRefresh) {
      return Promise.reject(normaliseError(error));
    }

    original._retried = true;

    try {
      await refreshSession();
      return await client(original);
    } catch (refreshError) {
      clearAccessToken();
      onAuthFailure?.();
      // Surface the ORIGINAL 401, not the refresh failure: the caller asked for
      // a task list, and "your session expired" is the truthful answer.
      return Promise.reject(
        refreshError instanceof ApiError ? refreshError : normaliseError(error),
      );
    }
  },
);

/** Refresh outside the interceptor (session restore on boot). */
export const requestRefresh = () => refreshSession();

export default client;
