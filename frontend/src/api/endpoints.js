import client, { API_BASE_URL } from './client.js';

/**
 * Every call resolves to the FULL response envelope:
 *   { success, data, meta?, message?, correlationId, timestamp }
 * Paginated lists carry `meta.pagination`, so read `res.data` for rows and
 * `res.meta.pagination` for counts.
 */

/** Drops undefined/null/'' so we never send `?status=` and confuse the validator. */
const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );

const get = (url, params) => client.get(url, { params: clean(params) });

export const auth = {
  login: (credentials) => client.post('/auth/login', credentials),
  logout: () => client.post('/auth/logout'),
  refresh: () => client.post('/auth/refresh'),
  me: () => client.get('/auth/me'),
  changePassword: (body) => client.post('/auth/change-password', body),
  forgotPassword: (body) => client.post('/auth/forgot-password', body),
  verifyOtp: (body) => client.post('/auth/verify-otp', body),
  resetPassword: (body) => client.post('/auth/reset-password', body),
  updateProfile: (body) => client.patch('/auth/profile', body),
  uploadAvatar: (file, onUploadProgress) => {
    const form = new FormData();
    form.append('avatar', file);
    return client.post('/auth/profile/avatar', form, {
      // Let the browser set the multipart boundary; a hand-set header omits it.
      headers: { 'Content-Type': undefined },
      onUploadProgress,
    });
  },
  sessions: () => client.get('/auth/sessions'),
};

export const departments = {
  list: (params) => get('/departments', params),
  get: (id) => client.get(`/departments/${id}`),
  /** { ...department, timeSlots[], fieldDefinitions[] } — the task screen renders itself from this. */
  config: (id) => client.get(`/departments/${id}/config`),
  /** One payload: the department, its working hours and its custom fields. */
  create: (body) => client.post('/departments', body),
  /**
   * NOT a partial: the API's updateSchema requires name, description, colorHex,
   * icon, isActive, sortOrder, requiredSlotsPerDay and workingWeekdays together.
   * Send the whole object or earn a 422. `code` is immutable and is never sent.
   */
  update: (id, body) => client.patch(`/departments/${id}`, body),
  /** 204 on success; 409 DEPARTMENT_NOT_EMPTY if it still holds people or work. */
  remove: (id) => client.delete(`/departments/${id}`),

  addTimeSlot: (id, body) => client.post(`/departments/${id}/time-slots`, body),
  /**
   * The "+" at the end of the task grid. Appends the next hour after the
   * department's current last column, flagged as OVERTIME.
   *
   * EMPLOYEES may call this — the person who worked late is the person who knows
   * they worked late. The appended column is excluded from the required-hours
   * count, so it can never make overtime mandatory.
   */
  addOvertimeSlot: (id) => client.post(`/departments/${id}/time-slots/overtime`),
  /** Undo an extra hour. Only works while the column is empty. */
  removeOvertimeSlot: (id, slotId) =>
    client.delete(`/departments/${id}/time-slots/overtime/${slotId}`),
  updateTimeSlot: (id, slotId, body) => client.patch(`/departments/${id}/time-slots/${slotId}`, body),
  /** May resolve to { retired: true, message } — a soft delete, when work was logged against it. */
  removeTimeSlot: (id, slotId) => client.delete(`/departments/${id}/time-slots/${slotId}`),

  addField: (id, body) => client.post(`/departments/${id}/fields`, body),
  updateField: (id, fieldId, body) => client.patch(`/departments/${id}/fields/${fieldId}`, body),
  /** Soft delete: the field leaves the form, its stored values stay queryable. */
  removeField: (id, fieldId) => client.delete(`/departments/${id}/fields/${fieldId}`),
};

export const users = {
  list: (params) => get('/users', params),
  options: (params) => get('/users/options', params),
  get: (id) => client.get(`/users/${id}`),
  create: (body) => client.post('/users', body),
  update: (id, body) => client.patch(`/users/${id}`, body),
  deactivate: (id, body = {}) => client.post(`/users/${id}/deactivate`, body),
  reactivate: (id) => client.post(`/users/${id}/reactivate`),
  resetPassword: (id, body = {}) => client.post(`/users/${id}/reset-password`, body),
  /**
   * What a permanent delete would destroy, BEFORE the admin commits to it:
   * { fullName, email, willDestroy: { taskEntries, taskDays }, blockers[], recommendation }.
   */
  deletePreview: (id) => client.get(`/users/${id}/delete-preview`),
  /** Irreversible. Destroys their task history. `deactivate` is almost always the right call. */
  destroy: (id) => client.delete(`/users/${id}`),
};

export const teams = {
  list: (params) => get('/teams', params),
  options: (params) => get('/teams/options', params),
  get: (id) => client.get(`/teams/${id}`),
  create: (body) => client.post('/teams', body),
  update: (id, body) => client.patch(`/teams/${id}`, body),
  assignMembers: (id, body) => client.post(`/teams/${id}/members`, body),
  removeMember: (id, userId) => client.delete(`/teams/${id}/members/${userId}`),
  /** What a delete would cost: members in the way, entries that lose their team. */
  deletePreview: (id) => client.get(`/teams/${id}/delete-preview`),
  /** 409 TEAM_NOT_EMPTY while the team still has members. */
  remove: (id) => client.delete(`/teams/${id}`),
};

export const projects = {
  list: (params) => get('/projects', params),
  /** Active projects for the task-entry picker, each flagged with `isInternal`. */
  options: (params) => get('/projects/options', params),
  get: (id) => client.get(`/projects/${id}`),
  create: (body) => client.post('/projects', body),
  update: (id, body) => client.patch(`/projects/${id}`, body),
  /**
   * Delete a project — but ONLY a mistaken one with no logged hours. A project
   * with work behind it is refused (409 PROJECT_HAS_WORK) and must be ARCHIVED
   * instead, which keeps every hour. The Internal / Non-project catch-all can
   * never be deleted (409 INTERNAL_PROJECT_UNDELETABLE).
   */
  remove: (id) => client.delete(`/projects/${id}`),

  /**
   * The deliverables a project breaks down into. Returns retired modules too
   * (`isActive: false`) — assignments still hang off them, so hiding them would
   * orphan work that is visibly in flight.
   */
  listModules: (id) => client.get(`/projects/${id}/modules`),
  addModule: (id, body) => client.post(`/projects/${id}/modules`, body),
  updateModule: (id, moduleId, body) => client.patch(`/projects/${id}/modules/${moduleId}`, body),
  /** Resolves to `{ retired: true }` when assignments reference it, `{ deleted: true }` otherwise. */
  removeModule: (id, moduleId) => client.delete(`/projects/${id}/modules/${moduleId}`),
};

export const tasks = {
  /** The day's grid for one user: { date?, userId?, departmentId? } */
  getGrid: (params) => get('/tasks/grid', params),
  /** One row. Pass `isAutoSave: true` to relax required-field checks mid-typing. */
  saveEntry: (body) => client.post('/tasks/entries', body),
  /** The whole grid in one transaction ("Save all"). */
  saveGrid: (body) => client.post('/tasks/grid', body),
  deleteEntry: (id, params) => client.delete(`/tasks/entries/${id}`, { params: clean(params) }),
  getHistory: (id, params) => get(`/tasks/entries/${id}/history`, params),
  listEntries: (params) => get('/tasks/entries', params),
  listDays: (params) => get('/tasks/days', params),
  listPending: (params) => get('/tasks/days/pending', params),
  submitDay: (body) => client.post('/tasks/days/submit', body),
  /**
   * body: { decision: 'APPROVE' | 'REJECT' | 'REOPEN', note? }
   * The API takes the ACTION, not the target state — the server owns the state
   * machine, and a client that posts a target status is a client that can ask
   * for an illegal transition.
   * A REJECT without a note is rejected (422): "returned, no reason given" is
   * how an approval workflow loses the trust of the people using it.
   */
  reviewDay: (id, body) => client.post(`/tasks/days/${id}/review`, body),
};

export const assignments = {
  /** Scoped list. Params: { status, priority, projectId, assigneeId, open, overdue, mine, ... } */
  list: (params) => get('/assignments', params),
  /** The caller's (or a given user's) ASSIGNED/IN_PROGRESS work — for the grid picker. */
  active: (params) => get('/assignments/active', params),
  /** One assignment with its progress thread (the linked hourly updates) and history. */
  get: (id) => client.get(`/assignments/${id}`),
  /** Assign work. body: { assigneeId, projectId, title, description?, priority?, dueDate?, estimatedHours? } */
  create: (body) => client.post('/assignments', body),
  /** Edit the brief. Echo `version` for optimistic-concurrency protection. */
  update: (id, body) => client.patch(`/assignments/${id}`, body),
  /** (Assignee) mark done and hand back for review. */
  submit: (id, body = {}) => client.post(`/assignments/${id}/submit`, body),
  /** (Lead) body: { decision: 'DONE' | 'REOPEN', note? }. The server owns the state machine. */
  review: (id, body) => client.post(`/assignments/${id}/review`, body),
  /** (Lead) cancel — never deletes; the logged hours and the trail survive. */
  cancel: (id, body = {}) => client.post(`/assignments/${id}/cancel`, body),
};

export const dashboard = {
  /** The CEO overview: one card per department + who to chase. Takes { date }. */
  overview: (params) => get('/dashboard/overview', params),
  /** Assigned-work delivery: counts + at-risk + needs-review. Scoped. */
  delivery: (params) => get('/dashboard/delivery', params),
  summary: (params) => get('/dashboard/summary', params),
  // No statusBreakdown / priorityBreakdown: those endpoints are gone. An entry is
  // an hour already worked, so there is no work-status to break down and no
  // priority to rank. `projectProductivity` is the slice that replaced them.
  hourlyActivity: (params) => get('/dashboard/hourly-activity', params),
  trend: (params) => get('/dashboard/trend', params),
  employeeProductivity: (params) => get('/dashboard/productivity/employee', params),
  teamProductivity: (params) => get('/dashboard/productivity/team', params),
  departmentProductivity: (params) => get('/dashboard/productivity/department', params),
  projectProductivity: (params) => get('/dashboard/productivity/project', params),
  compliance: (params) => get('/dashboard/compliance', params),
  /**
   * Live per-team follow-up: fill rate vs ON-TIME rate, and who to chase.
   * Params: { date, departmentId } — deliberately not teamId; the panel compares
   * teams against each other, so narrowing it to one is not a view it supports.
   */
  teamFollowUp: (params) => get('/dashboard/team-follow-up', params),
};

export const ai = {
  /** { configured, enabled, hasKey, model, windowHours } — never the key itself. */
  status: () => client.get('/ai/status'),
  /** Params: { page, pageSize, departmentId, userId, kind, severity, unacknowledged, includeOnTrack } */
  insights: (params) => get('/ai/insights', params),
  acknowledge: (id) => client.post(`/ai/insights/${id}/acknowledge`),
  /** Runs the two-hourly analysis immediately. Resolves to `{ summary }`. */
  analyse: () => client.post('/ai/analyse'),
  /** Round-trips the model to prove the key, the model name and the quota. */
  ping: () => client.post('/ai/ping'),
};

const CONTENT_TYPES = {
  EXCEL: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  CSV: 'text/csv;charset=utf-8',
  PDF: 'application/pdf',
};

const EXTENSIONS = { EXCEL: 'xlsx', CSV: 'csv', PDF: 'pdf' };

/**
 * Pulls the server's filename out of Content-Disposition.
 * Prefers RFC 5987 `filename*=UTF-8''…` (percent-encoded, so it survives
 * non-ASCII department names) and falls back to the plain `filename=` token.
 *
 * The header is readable here because the API sets
 * `exposedHeaders: ['Content-Disposition']` — without that, CORS hides it and
 * this quietly returns null on every cross-origin deployment.
 */
const filenameFromDisposition = (headers) => {
  const disposition =
    (typeof headers?.get === 'function' ? headers.get('content-disposition') : null) ??
    headers?.['content-disposition'];

  if (!disposition) return null;

  const encoded = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim().replace(/^"|"$/g, ''));
    } catch {
      // A malformed percent-escape must not sink an otherwise good download.
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  return plain ? plain.trim() : null;
};

export const reports = {
  /**
   * A plain URL for the export endpoint.
   * NOTE: the access token is in memory, not a cookie — so an <a href> to this
   * URL arrives UNAUTHENTICATED. Use `reports.download()` for a real download;
   * this builder exists for display/copy and for callers that add their own auth.
   */
  exportUrl: (params = {}) => {
    const query = new URLSearchParams(clean({ format: 'EXCEL', ...params })).toString();
    return `${API_BASE_URL}/reports/tasks/export${query ? `?${query}` : ''}`;
  },

  /** Fetches the file as a blob (bearer token attached) and saves it. */
  download: async (params = {}, { filename } = {}) => {
    const format = String(params.format ?? 'EXCEL').toUpperCase();

    const response = await client.get('/reports/tasks/export', {
      params: clean({ ...params, format }),
      responseType: 'blob',
      // This endpoint returns a raw file, not an envelope — opt out of the
      // response transform so we get the Blob itself...
      transformResponse: (data) => data,
      // ...and out of the unwrapping interceptor, so we keep the headers. The
      // server names the file (department, date range, extension); re-deriving
      // that name here would be a second, worse implementation of it.
      rawResponse: true,
    });

    const suggested = filenameFromDisposition(response.headers) ?? `task-report.${EXTENSIONS[format] ?? 'xlsx'}`;

    const blob =
      response.data instanceof Blob ? response.data : new Blob([response.data], { type: CONTENT_TYPES[format] });

    const url = URL.createObjectURL(blob);

    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename ?? suggested;
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      // Revoking synchronously after click() is safe: the browser has already
      // taken its reference to the object URL by the time click() returns.
      URL.revokeObjectURL(url);
    }

    return { filename: filename ?? suggested };
  },
};

export const audit = {
  list: (params) => get('/audit', params),
  actions: () => client.get('/audit/actions'),
};

export const notifications = {
  list: (params) => get('/notifications', params),
  unreadCount: () => client.get('/notifications/unread-count'),
  markRead: (id) => client.post(`/notifications/${id}/read`),
  markAllRead: () => client.post('/notifications/read-all'),
};

export const settings = {
  list: () => client.get('/settings'),
  /** The API takes `{ value }`; `value` may be a boolean, a number or a string. */
  update: (key, value) => client.put(`/settings/${key}`, { value }),
};

export const system = {
  /** Scheduled job status: schedule, last run, whether it is running right now. */
  jobs: () => client.get('/system/jobs'),
  /** Manual trigger. Still takes the distributed lock, so it cannot collide. */
  runJob: (name) => client.post(`/system/jobs/${name}/run`),
  permissions: () => client.get('/system/permissions'),
  /** SMTP config + whether the connection verified at boot. Never returns a password. */
  mail: () => client.get('/system/mail'),
  /**
   * Proves mail works without triggering a real password reset on someone.
   * A failure comes back as a 400 whose `message` names the likely cause — show
   * it verbatim; it is the only actionable thing in the response.
   */
  testMail: (to) => client.post('/system/mail/test', { to }),
};

const api = {
  auth,
  departments,
  users,
  teams,
  projects,
  tasks,
  assignments,
  ai,
  dashboard,
  reports,
  audit,
  notifications,
  settings,
  system,
};

export default api;
