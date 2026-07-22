/**
 * THE DATA-PRESERVATION CONTRACT.
 *
 * This suite exists because of one bug that would have been catastrophic and
 * completely silent: deleting an employee used to CASCADE-DELETE their entire
 * task history. Months of delivery records vanished with the account, every
 * report covering that period quietly stopped adding up, and nobody would have
 * noticed for a quarter.
 *
 * THE CONTRACT, in one line:
 *
 *     Removing a PERSON, a TEAM, a DEPARTMENT or an HOUR must never remove the
 *     RECORD OF WORK THAT WAS DONE.
 *
 * The work is the company's, not the person's. A project shipped, a client was
 * billed, an incident cost somebody an evening — none of that stops being true
 * because an account was deleted.
 *
 * Every test below asserts that the task-entry count is UNCHANGED after the
 * destructive act. If any of them ever fails, someone has reintroduced a cascade.
 *
 *   node backend/tests/integration/data-preservation.mjs
 */
const BASE = 'http://localhost:4000/api/v1';

let passed = 0;
let failed = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passed += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ` \x1b[90m→ ${detail}\x1b[0m` : ''}`);
  }
};
const section = (t) => console.log(`\n\x1b[1m\x1b[36m${t}\x1b[0m`);

const login = async (email, password) =>
  (
    await (
      await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    ).json()
  ).data?.accessToken;

const api = async (path, { method = 'GET', body, token } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, ...(res.status === 204 ? {} : await res.json().catch(() => ({}))) };
};

// Overridable for the same reason as the smoke suite: a changed admin password
// on a dev machine must not look like a data-preservation failure.
const admin = await login(
  process.env.SMOKE_ADMIN_EMAIL ?? 'admin@ara-workbench.local',
  process.env.SMOKE_ADMIN_PASSWORD ?? 'ChangeMe@Admin123',
);
if (!admin) {
  console.error('Could not sign in. Reset the DB and reseed first.');
  process.exit(1);
}

// --- arrange: put real work in the database --------------------------------
const arjun = await login('arjun.nair@ara-workbench.local', 'Password@2026!');
const grid = await api('/tasks/grid', { token: arjun });
const slots = grid.data.cells
  .filter((c) => !c.timeSlot.isBreak && !c.timeSlot.isOvertime)
  .map((c) => c.timeSlot);

const arjunProjects = await api('/projects/options', { token: arjun });
const arjunProject = arjunProjects.data.find((p) => !p.isInternal);

for (let i = 0; i < 3; i += 1) {
  await api('/tasks/entries', {
    method: 'POST',
    token: arjun,
    body: {
      date: grid.data.workDate,
      timeSlotId: slots[i].id,
      description: 'Built the payment reconciliation service and its regression suite',
      projectId: arjunProject.id,
    },
  });
}

const countEntries = async () =>
  (await api('/tasks/entries?pageSize=200', { token: admin })).data.length;

const baseline = await countEntries();
console.log(`\nBaseline: ${baseline} task entries in the database.`);
console.log('Every assertion below re-counts them. The number must never fall.');

// ---------------------------------------------------------------------------
section('DELETE A TEAM');
{
  const teams = await api('/teams?pageSize=50', { token: admin });
  const populated = teams.data.find((t) => t.memberCount > 0);

  const refused = await api(`/teams/${populated.id}`, { method: 'DELETE', token: admin });
  check('a team with members is REFUSED (409) — its people cannot be orphaned', refused.status === 409);

  const departments = await api('/departments', { token: admin });
  const temp = await api('/teams', {
    method: 'POST',
    token: admin,
    body: { name: 'Preservation Test', code: 'PRES-1', departmentId: departments.data[0].id },
  });
  const deleted = await api(`/teams/${temp.data.id}`, { method: 'DELETE', token: admin });
  check('an empty team deletes', deleted.status === 200);

  check('▶ no task entry was lost', (await countEntries()) === baseline);
}

// ---------------------------------------------------------------------------
section('DELETE A DEPARTMENT');
{
  const departments = await api('/departments', { token: admin });
  const tech = departments.data.find((d) => d.code === 'TECH');

  const refused = await api(`/departments/${tech.id}`, { method: 'DELETE', token: admin });
  check('a department holding logged work is REFUSED (409)', refused.status === 409);
  check(
    '…and the error names exactly what is in the way',
    /employee|logged task|team|project/i.test(refused.error?.message ?? ''),
    refused.error?.message?.slice(0, 60),
  );
  check('▶ no task entry was lost', (await countEntries()) === baseline);
}

// ---------------------------------------------------------------------------
section('REMOVE A WORKING HOUR');
{
  const departments = await api('/departments', { token: admin });
  const tech = departments.data.find((d) => d.code === 'TECH');
  const config = await api(`/departments/${tech.id}/config`, { token: admin });
  const usedSlot = config.data.timeSlots.find((s) => !s.isBreak);

  const removed = await api(`/departments/${tech.id}/time-slots/${usedSlot.id}`, {
    method: 'DELETE',
    token: admin,
  });

  // A HARD delete would cascade the entries logged against that hour into
  // oblivion. So an hour with work behind it is retired, not destroyed: it leaves
  // the grid, and the work stays.
  check('an hour with work logged against it is RETIRED, not destroyed', removed.data?.retired === true);
  check('▶ no task entry was lost', (await countEntries()) === baseline);
}

// ---------------------------------------------------------------------------
section('RETIRE A PROJECT — the new one that could destroy everything');
{
  // projectId is NOT NULL now, and it is the index every project report reads.
  // Deleting a project with hours behind it would either destroy them or orphan
  // them — so a project is ARCHIVED, never deleted, and the hours keep their
  // index forever.
  const projects = await api('/projects?pageSize=50', { token: admin });
  const internal = projects.data.find((p) => p.isInternal);
  const real = projects.data.find((p) => !p.isInternal && p.departmentId === internal?.departmentId);

  check('every department has an "Internal / Non-project" catch-all', !!internal);

  const archiveInternal = await api(`/projects/${internal.id}`, {
    method: 'PATCH',
    token: admin,
    body: { status: 'ARCHIVED' },
  });
  check(
    'the internal project CANNOT be archived — it is the only honest home for a meeting',
    archiveInternal.status === 400,
    `got ${archiveInternal.status}`,
  );

  const archived = await api(`/projects/${real.id}`, {
    method: 'PATCH',
    token: admin,
    body: { status: 'ARCHIVED' },
  });
  check('a real project CAN be archived', archived.status === 200, JSON.stringify(archived.error));
  check('▶ no task entry was lost', (await countEntries()) === baseline);

  // Restore it — the rest of the suite still needs a project it can log against.
  await api(`/projects/${real.id}`, { method: 'PATCH', token: admin, body: { status: 'ACTIVE' } });
}

// ---------------------------------------------------------------------------
section('DELETE AN EMPLOYEE — the one that used to destroy everything');
{
  const users = await api('/users?pageSize=100', { token: admin });
  const target = users.data.find((u) => u.email.startsWith('arjun'));

  const preview = await api(`/users/${target.id}/delete-preview`, { token: admin });
  check(
    'the preview promises the work will be PRESERVED',
    preview.data?.willPreserve?.taskEntries === 3,
    JSON.stringify(preview.data?.willPreserve),
  );
  check(
    '…and lists only account data as removed (login, sessions, notifications)',
    (preview.data?.willRemove ?? []).some((x) => /login/i.test(x)),
  );

  const deleted = await api(`/users/${target.id}`, { method: 'DELETE', token: admin });
  check('the account is deleted', deleted.status === 200);

  const afterUsers = await api('/users?pageSize=100', { token: admin });
  check('…and gone from the employee list', !afterUsers.data.some((u) => u.id === target.id));

  // THE ASSERTION THIS ENTIRE FILE EXISTS FOR.
  check('▶▶ NO TASK ENTRY WAS LOST', (await countEntries()) === baseline, `${await countEntries()} vs ${baseline}`);

  const entries = (await api('/tasks/entries?pageSize=200', { token: admin })).data.filter(
    (e) => e.user?.fullName === 'Arjun Nair',
  );
  check('▶▶ his 3 entries survive', entries.length === 3, `${entries.length} found`);
  check('▶▶ still attributed to him BY NAME', entries[0]?.user?.fullName === 'Arjun Nair');
  check('▶▶ badged as a former employee', entries[0]?.user?.isFormerEmployee === true);
  check('▶▶ the work text is intact', /reconciliation/.test(entries[0]?.description ?? ''));
  check('▶▶ the employee code is kept', entries[0]?.user?.employeeCode === 'EMP-001');

  const csv = await fetch(`${BASE}/reports/tasks/export?format=CSV`, {
    headers: { Authorization: `Bearer ${admin}` },
  });
  const body = await csv.text();
  check('▶▶ the CSV export still names him', body.includes('Arjun Nair'));

  const audit = await api('/audit?action=USER_DELETED', { token: admin });
  check('the deletion is in the audit log', audit.data?.length === 1);
  check(
    '…and the audit record says the work was preserved',
    /PRESERVED/i.test(audit.data?.[0]?.summary ?? ''),
  );
}

console.log(`\n${'─'.repeat(64)}`);
console.log(`\x1b[1m  ${passed} passed, ${failed} failed\x1b[0m`);
console.log(`${'─'.repeat(64)}\n`);
process.exit(failed > 0 ? 1 : 0);
