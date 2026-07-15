/**
 * The API's 4xx messages are written to be read by a person ("This user
 * currently leads an active team. Assign a new team lead before deactivating
 * them."). Surface them verbatim rather than replacing them with a generic
 * failure notice — the server's message is the only thing that tells the admin
 * what to do next.
 */
export const errorMessage = (error, fallback = 'Something went wrong. Please try again.') =>
  error?.message || fallback;

/** 409s are the domain guards (LAST_MANAGEMENT_ACCOUNT, STILL_LEADS_TEAM, …). */
export const isConflict = (error) => error?.status === 409;

/** 400/409/422 all carry an actionable message; 500s do not. */
export const isActionable = (error) =>
  typeof error?.status === 'number' && error.status >= 400 && error.status < 500;
