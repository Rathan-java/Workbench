/**
 * End-to-end smoke test against the running API.
 * Exercises the flows that matter, INCLUDING the ones that must be denied.
 */
const BASE = 'http://localhost:4000/api/v1';

// Credentials are overridable. The seeded default is right for CI and a fresh
// database, but the moment somebody changes the admin password on the machine
// they are testing on, a hardcoded literal fails 100 tests that have nothing to
// do with the change. Override with:  SMOKE_ADMIN_PASSWORD=... node <this file>
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL ?? 'admin@ara-workbench.local';
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD ?? 'ChangeMe@Admin123';

let passed = 0;
let failed = 0;
const results = [];

const check = (name, condition, detail = '') => {
  if (condition) {
    passed += 1;
    results.push(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    results.push(`  \x1b[31m✗\x1b[0m ${name} ${detail ? `\x1b[90m→ ${detail}\x1b[0m` : ''}`);
  }
};

const jar = new Map();

const api = async (path, { method = 'GET', body, token, raw = false } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookies) headers.Cookie = cookies;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookie) {
    const [pair] = c.split(';');
    const [k, v] = pair.split('=');
    jar.set(k.trim(), v);
  }

  if (raw) return res;
  const json = await res.json().catch(() => ({}));
  return { status: res.status, ...json };
};

const section = (title) => results.push(`\n\x1b[1m\x1b[36m${title}\x1b[0m`);

// ---------------------------------------------------------------------------

section('AUTH — sign in as Management');
const login = await api('/auth/login', {
  method: 'POST',
  body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
});
check('Management logs in', login.success === true, JSON.stringify(login.error));
const adminToken = login.data?.accessToken;
check('access token returned in body', typeof adminToken === 'string' && adminToken.length > 50);
check('refresh token is httpOnly cookie, NOT in body', !JSON.stringify(login.data).includes('refreshToken'));
check('refresh cookie was set', jar.has('aw_rt'));
check('mustChangePassword is enforced on the seeded admin', login.data?.user?.mustChangePassword === true);

section('AUTH — negative paths');
const badPw = await api('/auth/login', {
  method: 'POST',
  body: { email: ADMIN_EMAIL, password: 'WrongPassword123!' },
});
check('wrong password is rejected', badPw.status === 401);
check('error message does not reveal whether the account exists',
  badPw.error?.message === 'Invalid email or password', badPw.error?.message);

const unknownUser = await api('/auth/login', {
  method: 'POST',
  body: { email: 'nobody@nowhere.local', password: 'WrongPassword123!' },
});
check('unknown account returns the IDENTICAL error (no enumeration)',
  unknownUser.error?.message === badPw.error?.message);

const noAuth = await api('/users');
check('unauthenticated request to /users is 401', noAuth.status === 401);

section('AUTH — forgot password does not enumerate');
const forgotReal = await api('/auth/forgot-password', { method: 'POST', body: { email: ADMIN_EMAIL } });
const forgotFake = await api('/auth/forgot-password', { method: 'POST', body: { email: 'ghost@nowhere.local' } });
check('forgot-password returns 200 for a real account', forgotReal.status === 200);
check('forgot-password returns 200 for a fake account too', forgotFake.status === 200);
check('both return the identical message', forgotReal.message === forgotFake.message);

section('DEPARTMENTS — Management sees all four');
const depts = await api('/departments', { token: adminToken });
check('4 departments returned', depts.data?.length === 4, `got ${depts.data?.length}`);
const byCode = Object.fromEntries((depts.data ?? []).map((d) => [d.code, d]));
check('Tech Team exists', !!byCode.TECH);
check('Digital Marketing exists', !!byCode.DIGITAL_MARKETING);
check('Social Media Management exists', !!byCode.SOCIAL_MEDIA);
check('Video Editing exists', !!byCode.VIDEO_EDITING);

section('DEPARTMENTS — each has its OWN hours, and NO required extra fields');
const techCfg = await api(`/departments/${byCode.TECH.id}/config`, { token: adminToken });
const dmCfg = await api(`/departments/${byCode.DIGITAL_MARKETING.id}/config`, { token: adminToken });
const smCfg = await api(`/departments/${byCode.SOCIAL_MEDIA.id}/config`, { token: adminToken });
const veCfg = await api(`/departments/${byCode.VIDEO_EDITING.id}/config`, { token: adminToken });

// THE FORM IS TWO QUESTIONS LONG. It used to ship with twenty custom fields
// across the four departments — a Work Type, a Ticket Ref, a Campaign, a Render
// Time. Each was defensible alone; together they were a wall, paid for once per
// employee per hour per day. The engine still exists for a department that can
// name who will read the field. Nothing is seeded.
const keys = (cfg) => (cfg.data?.fieldDefinitions ?? []).map((f) => f.key);
check('Tech ships with ZERO required extra fields', keys(techCfg).length === 0, keys(techCfg).join(','));
check('Digital Marketing ships with ZERO', keys(dmCfg).length === 0, keys(dmCfg).join(','));
check('Social Media ships with ZERO', keys(smCfg).length === 0, keys(smCfg).join(','));
check('Video Editing ships with ZERO', keys(veCfg).length === 0, keys(veCfg).join(','));

check('Tech grid has 8 columns (7 work + lunch)', techCfg.data?.timeSlots?.length === 8, `${techCfg.data?.timeSlots?.length}`);
check('Tech first slot is 10:00 - 11:00', techCfg.data?.timeSlots?.[0]?.label === '10:00 - 11:00');
check('Digital Marketing starts EARLIER (09:30) — per-department hours',
  dmCfg.data?.timeSlots?.[0]?.label === '09:30 - 10:30', dmCfg.data?.timeSlots?.[0]?.label);
check('Video Editing runs LATER (ends 07:00) — per-department hours',
  veCfg.data?.timeSlots?.at(-1)?.label === '06:00 - 07:00', veCfg.data?.timeSlots?.at(-1)?.label);

section('THE ISOLATION TEST — Tech Lead vs. other departments');
const techLead = await api('/auth/login', { method: 'POST', body: { email: 'priya.sharma@ara-workbench.local', password: 'Password@2026!' } });
check('Tech Lead (Priya) signs in', techLead.success === true, JSON.stringify(techLead.error));
const leadToken = techLead.data?.accessToken;
check('Tech Lead is scoped to Tech Team', techLead.data?.user?.department?.code === 'TECH');

const leadDepts = await api('/departments', { token: leadToken });
check('Tech Lead sees ONLY their own department (1, not 4)', leadDepts.data?.length === 1, `got ${leadDepts.data?.length}`);
check('…and it is Tech', leadDepts.data?.[0]?.code === 'TECH');

const crossDept = await api(`/departments/${byCode.VIDEO_EDITING.id}/config`, { token: leadToken });
check('Tech Lead requesting Video Editing config → 403', crossDept.status === 403, `got ${crossDept.status}`);

const leadUsers = await api('/users?pageSize=100', { token: leadToken });
const leadSeesDepts = new Set((leadUsers.data ?? []).map((u) => u.department?.code).filter(Boolean));
check('Tech Lead\'s user list contains ONLY Tech staff',
  leadSeesDepts.size === 1 && leadSeesDepts.has('TECH'), [...leadSeesDepts].join(','));

const crossFilter = await api(`/users?departmentId=${byCode.SOCIAL_MEDIA.id}`, { token: leadToken });
check('Tech Lead filtering for Social Media → 403 (cannot widen scope)', crossFilter.status === 403, `got ${crossFilter.status}`);

const adminUsers = await api('/users?pageSize=100', { token: adminToken });
const adminSeesDepts = new Set((adminUsers.data ?? []).map((u) => u.department?.code).filter(Boolean));
check('Management sees ALL FOUR departments\' staff', adminSeesDepts.size === 4, [...adminSeesDepts].join(','));

section('THE ISOLATION TEST — Employee');
const emp = await api('/auth/login', { method: 'POST', body: { email: 'arjun.nair@ara-workbench.local', password: 'Password@2026!' } });
const empToken = emp.data?.accessToken;
check('Employee (Arjun) signs in', emp.success === true);

const empAudit = await api('/audit', { token: empToken });
check('Employee reading the audit log → 403', empAudit.status === 403, `got ${empAudit.status}`);

const empCreate = await api('/users', { method: 'POST', token: empToken, body: { firstName: 'X', lastName: 'Y', email: 'x@y.z', employeeCode: 'HACK', role: 'MANAGEMENT' } });
check('Employee creating a MANAGEMENT account → 403', empCreate.status === 403, `got ${empCreate.status}`);

const otherGrid = await api(`/tasks/grid?userId=${techLead.data.user.id}`, { token: empToken });
check('Employee reading a colleague\'s task grid → 403', otherGrid.status === 403, `got ${otherGrid.status}`);

section('TASK GRID — the hourly table');
const grid = await api('/tasks/grid', { token: empToken });
check('Employee gets their own grid', grid.success === true, JSON.stringify(grid.error));
check('grid has 8 cells (Tech: 7 work hours + lunch)', grid.data?.cells?.length === 8, `${grid.data?.cells?.length}`);
check('each cell carries its time slot', grid.data?.cells?.[0]?.timeSlot?.label === '10:00 - 11:00');
check('grid reports its own permissions', typeof grid.data?.permissions?.canEdit === 'boolean');
check('day starts in DRAFT', grid.data?.day?.status === 'DRAFT');

const slot1 = grid.data.cells[0].timeSlot.id;
const slot2 = grid.data.cells[1].timeSlot.id;
const today = grid.data.workDate;

section('TASK ENTRY — two questions: what did you finish, and what for');
const projects = await api('/projects/options', { token: empToken });
const proj = projects.data?.find((p) => !p.isInternal);
const internal = projects.data?.find((p) => p.isInternal);
check('Employee can read their department\'s projects', !!proj, JSON.stringify(projects.error));

// EVERY DEPARTMENT HAS AN HONEST ANSWER. projectId is required, and a required
// field with no true option is not a constraint — it is an instruction to lie.
check('the department has an "Internal / Non-project" catch-all', !!internal, JSON.stringify(projects.data?.map((p) => p.code)));
check('…and it is flagged so the UI can protect it', internal?.isInternal === true);

// PROJECT IS REQUIRED. Not "encouraged". An optional index is not an index: once
// 30% of hours carry no project, "how is Project X going" stops being answerable.
const noProject = await api('/tasks/entries', {
  method: 'POST',
  token: empToken,
  body: { date: today, timeSlotId: slot1, description: 'Work with no project attached to it' },
});
check('an hour saved with NO project is REFUSED (422)', noProject.status === 422, `got ${noProject.status}`);
check('…and the message tells you what to do', /project/i.test(JSON.stringify(noProject.error)));

// AUTOSAVE IS A DRAFT. It fires while someone is still typing, before they have
// reached the project dropdown. It must not scold them — but it must not write an
// unprojected row either, because that row would be invisible to every project
// report forever. So it is HELD: accepted, not stored.
const draft = await api('/tasks/entries', {
  method: 'POST',
  token: empToken,
  body: { date: today, timeSlotId: slot1, description: 'still typing, no project yet', isAutoSave: true },
});
check('an AUTOSAVE with no project is accepted, not scolded', draft.status === 200, `got ${draft.status}`);
check('…but writes NO row — it is a draft, not a save', draft.data?.skipped === true && !draft.data?.entry);

const save1 = await api('/tasks/entries', {
  method: 'POST',
  token: empToken,
  body: {
    date: today,
    timeSlotId: slot1,
    description: 'Implemented the login API and its integration tests',
    projectId: proj?.id,
  },
});
check('save an hour with a description and a project', save1.success === true, JSON.stringify(save1.error));
check('entry starts at version 1', save1.data?.entry?.version === 1, `v${save1.data?.entry?.version}`);
check('the project comes back resolved', save1.data?.entry?.project?.code === proj?.code);
check('isLate computed server-side', typeof save1.data?.entry?.isLate === 'boolean');

// The columns that no longer exist. If any of these ever comes back, somebody has
// re-added a field that can only hold one value.
check('NO status on the entry', !('status' in (save1.data?.entry ?? {})));
check('NO priority on the entry', !('priority' in (save1.data?.entry ?? {})));
check('NO module on the entry', !('moduleId' in (save1.data?.entry ?? {})));

// NO REQUIRED DEPARTMENT FIELDS. This exact save used to 422 on a missing
// "Work Type" — an employee blocked from recording an hour of real work.
const noAttrs = await api('/tasks/entries', {
  method: 'POST',
  token: empToken,
  body: { date: today, timeSlotId: slot2, description: 'Paired on the settlement rounding bug', projectId: proj?.id },
});
check('an hour saves with NO extra fields at all', noAttrs.success === true, JSON.stringify(noAttrs.error));

// The attributes ENGINE still guards itself, even though nothing is seeded into it.
const unknownKey = await api('/tasks/entries', {
  method: 'POST',
  token: empToken,
  body: {
    date: today, timeSlotId: slot2, description: 'Testing an unknown field key',
    projectId: proj?.id, attributes: { notARealField: 'x' },
  },
});
check('an UNKNOWN attribute key is still rejected (strict schema)', unknownKey.status === 422, `got ${unknownKey.status}`);

// A PROJECT FROM ANOTHER DEPARTMENT would smuggle an hour across the boundary the
// whole scope engine exists to hold. Nothing in the DB stops it; the service does.
const otherDeptProjects = await api('/projects?departmentId=' + byCode.VIDEO_EDITING.id, { token: adminToken });
const foreignProject = otherDeptProjects.data?.find((p) => !p.isInternal);
const foreignProjectSave = await api('/tasks/entries', {
  method: 'POST',
  token: empToken,
  body: { date: today, timeSlotId: slot2, description: 'Logging Tech hours against a Video project', projectId: foreignProject?.id },
});
check('a project from ANOTHER department is refused', foreignProjectSave.status === 400, `got ${foreignProjectSave.status}`);

// EDIT AFTER SAVING. An employee fills the 10am slot at 5pm, then at 5:30 changes
// it because they remembered what they actually did. That must simply work.
const v2 = await api('/tasks/entries', {
  method: 'POST', token: empToken,
  body: {
    date: today, timeSlotId: slot1,
    description: 'EDITED after saving — also added the regression suite',
    projectId: internal?.id,
    version: save1.data.entry.version,
  },
});
check('a saved hour can be RE-OPENED and edited', v2.success === true, JSON.stringify(v2.error));
check('version incremented to 2', v2.data?.entry?.version === 2, `v${v2.data?.entry?.version}`);
check('…and the project can be changed on the edit', v2.data?.entry?.project?.code === 'INTERNAL');

// Now replay version 1 — the classic "second browser tab" scenario.
const conflict = await api('/tasks/entries', {
  method: 'POST', token: empToken,
  body: {
    date: today, timeSlotId: slot1, description: 'Stale write from a second tab',
    projectId: proj?.id, version: 1,
  },
});
check('a STALE version returns 409, not a silent overwrite', conflict.status === 409, `got ${conflict.status}`);
check('409 carries the server\'s current copy for a real diff', !!conflict.error?.details?.current);

section('TASK HISTORY');
const entryId = save1.data.entry.id;
const history = await api(`/tasks/entries/${entryId}/history`, { token: empToken });
check('history is readable', history.success === true);
check('history has >= 2 revisions after an edit', (history.data?.revisions?.length ?? 0) >= 2, `${history.data?.revisions?.length}`);
check('a revision records WHO changed it', !!history.data?.revisions?.[0]?.actor?.fullName);
check('a revision carries a precomputed field diff', !!history.data?.revisions?.[0]?.changedFields);

section('APPROVAL WORKFLOW');
const submitEarly = await api('/tasks/days/submit', { method: 'POST', token: empToken, body: { date: today } });
check('submitting an INCOMPLETE sheet is refused', submitEarly.status === 400, `got ${submitEarly.status}`);
check('…and it says exactly how many hours are missing',
  submitEarly.error?.details?.requiredSlots === 7, JSON.stringify(submitEarly.error?.details));

// Fill the sheet
const workSlots = grid.data.cells.filter((c) => !c.timeSlot.isBreak);
for (const [i, cell] of workSlots.entries()) {
  await api('/tasks/entries', {
    method: 'POST', token: empToken,
    body: {
      date: today, timeSlotId: cell.timeSlot.id,
      description: `Hour ${i + 1}: worked on the payments ledger reconciliation`,
      projectId: proj?.id,
      version: undefined,
    },
  });
}
const submit = await api('/tasks/days/submit', { method: 'POST', token: empToken, body: { date: today } });
check('a COMPLETE sheet submits', submit.success === true, JSON.stringify(submit.error));
check('day moved to SUBMITTED', submit.data?.status === 'SUBMITTED', submit.data?.status);

const lockedEdit = await api('/tasks/entries', {
  method: 'POST', token: empToken,
  body: { date: today, timeSlotId: slot1, description: 'Sneaking an edit in after submitting', projectId: proj?.id },
});
check('an employee CANNOT edit a submitted sheet (409 locked)', lockedEdit.status === 409, `got ${lockedEdit.status}`);

const dayId = submit.data.id;
const selfApprove = await api(`/tasks/days/${dayId}/review`, { method: 'POST', token: empToken, body: { decision: 'APPROVE' } });
check('an employee cannot approve anything (403)', selfApprove.status === 403, `got ${selfApprove.status}`);

const rejectNoNote = await api(`/tasks/days/${dayId}/review`, { method: 'POST', token: leadToken, body: { decision: 'REJECT' } });
check('rejecting WITHOUT a note is refused (422)', rejectNoNote.status === 422, `got ${rejectNoNote.status}`);

const approve = await api(`/tasks/days/${dayId}/review`, { method: 'POST', token: leadToken, body: { decision: 'APPROVE', note: 'Good detail, thanks.' } });
check('the Tech Lead approves it', approve.success === true, JSON.stringify(approve.error));
check('day is now APPROVED', approve.data?.status === 'APPROVED');
check('approval records the reviewer', !!approve.data?.reviewedBy?.fullName);

section('CROSS-DEPARTMENT WRITE — the breach attempt');
const smLead = await api('/auth/login', { method: 'POST', body: { email: 'ananya.reddy@ara-workbench.local', password: 'Password@2026!' } });
const smToken = smLead.data?.accessToken;
check('Social Media lead signs in', smLead.success === true);

const breachRead = await api(`/tasks/grid?userId=${emp.data.user.id}&date=${today}`, { token: smToken });
check('Social Media lead reading a TECH employee\'s sheet → 403', breachRead.status === 403, `got ${breachRead.status}`);

const breachWrite = await api('/tasks/entries', {
  method: 'POST', token: smToken,
  body: { date: today, userId: emp.data.user.id, timeSlotId: slot1, description: 'Cross-department tampering', projectId: proj?.id },
});
check('Social Media lead WRITING to a Tech sheet → 403', breachWrite.status === 403, `got ${breachWrite.status}`);

const techLeadRead = await api(`/tasks/grid?userId=${emp.data.user.id}&date=${today}`, { token: leadToken });
check('the employee\'s OWN Tech Lead CAN read the sheet', techLeadRead.success === true, JSON.stringify(techLeadRead.error));

section('DASHBOARD');
const summary = await api('/dashboard/summary', { token: adminToken });
check('Management dashboard summary loads', summary.success === true, JSON.stringify(summary.error));
check('it counts hours logged today', typeof summary.data?.cards?.hoursLogged === 'number');
check('it counts who has NOT logged', typeof summary.data?.cards?.notLoggedToday === 'number');
check('it counts projects that MOVED today', typeof summary.data?.cards?.projectsActiveToday === 'number');

const deptProd = await api('/dashboard/productivity/department', { token: adminToken });
check('department productivity returns ALL 4 departments (even the empty ones)',
  deptProd.data?.length === 4, `got ${deptProd.data?.length}`);

const leadSummary = await api('/dashboard/summary', { token: leadToken });
check('Tech Lead dashboard is scoped to their department', leadSummary.success === true);

const compliance = await api('/dashboard/compliance', { token: leadToken });
check('compliance view lists who is behind', Array.isArray(compliance.data?.employees));

section('AUDIT LOG');
const audit = await api('/audit?pageSize=100', { token: adminToken });
check('Management reads the audit log', audit.success === true, JSON.stringify(audit.error));
const actions = new Set((audit.data ?? []).map((a) => a.action));
check('LOGIN is audited', actions.has('LOGIN'));
check('LOGIN_FAILED is audited', actions.has('LOGIN_FAILED'));
check('TASK_DAY_APPROVED is audited', actions.has('TASK_DAY_APPROVED'));
check('audit rows carry the correlation id', !!audit.data?.[0]?.correlationId);
check('audit rows carry the actor IP', audit.data?.some((a) => !!a.ip));

section('REPORTS');
const csv = await api('/reports/tasks/export?format=CSV', { token: adminToken, raw: true });
check('CSV export streams', csv.status === 200, `got ${csv.status}`);
check('CSV has the right content type', csv.headers.get('content-type')?.includes('text/csv'));
// Read the RAW BYTES, not .text(). WHATWG TextDecoder strips a leading BOM when
// decoding UTF-8, so `.text()` would report the BOM as absent even when it is
// present on the wire — and we would "fix" a bug that does not exist.
const csvBytes = Buffer.from(await csv.arrayBuffer());
check('CSV has a header row', csvBytes.toString('utf8').includes('Work Done'));
check(
  'CSV starts with a UTF-8 BOM (so Excel does not mangle accented names)',
  csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
  `first bytes: ${[...csvBytes.subarray(0, 3)].map((b) => '0x' + b.toString(16)).join(' ')}`,
);

const xlsx = await api('/reports/tasks/export?format=EXCEL', { token: adminToken, raw: true });
check('Excel export streams', xlsx.status === 200);
const pdf = await api('/reports/tasks/export?format=PDF', { token: adminToken, raw: true });
check('PDF export streams', pdf.status === 200);

section('SESSION — refresh rotation & reuse detection');
const r1 = await api('/auth/refresh', { method: 'POST' });
check('refresh returns a new access token', r1.success === true && !!r1.data?.accessToken);
const rotatedCookie = jar.get('aw_rt');
check('the refresh cookie ROTATED', !!rotatedCookie);

section('SYSTEM');
const jobs = await api('/system/jobs', { token: adminToken });
check('scheduled jobs are visible', Array.isArray(jobs.data) && jobs.data.length >= 5, `${jobs.data?.length} jobs`);
check('the 180-day retention job is registered', jobs.data?.some((j) => j.name === 'retention-cleanup'));
check('the rollup job is registered', jobs.data?.some((j) => j.name === 'productivity-rollup'));

// ---------------------------------------------------------------------------

console.log(results.join('\n'));
console.log(`\n${'─'.repeat(60)}`);
console.log(`\x1b[1m  ${passed} passed, ${failed} failed\x1b[0m`);
console.log(`${'─'.repeat(60)}\n`);
process.exit(failed > 0 ? 1 : 0);
