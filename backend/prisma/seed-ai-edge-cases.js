/**
 * AI EDGE-CASE FIXTURES
 * =====================
 *
 * Eleven people, each one a single question put to the analyser, and each one a
 * case where the OBVIOUS answer is wrong. Together they are the difference
 * between "the AI works" and knowing what it does at the boundaries — which is
 * the only place a judgement about somebody's work can actually hurt them.
 *
 * Half of these exist because the model got them WRONG at some point and the
 * rule that now prevents it lives in code rather than in the prompt. They are
 * regression tests with faces: if a future prompt edit re-breaks one, the run
 * says so out loud instead of quietly libelling an employee in production.
 *
 * ── WHY ITS OWN DEPARTMENT ──────────────────────────────────────────────────
 * Everything here lands in "AI Edge Cases" (code AI-LAB), never in Tech Team.
 * Department isolation is already the spine of this product, so the fixtures get
 * to use it: real data stays clean, a department-scoped review targets exactly
 * this set, and the teardown below can be brutal without endangering anything.
 *
 * Re-running WIPES AND REBUILDS this department only. Idempotent by demolition,
 * which is the only kind that stays honest when the fixtures change shape.
 *
 *   node --env-file=.env prisma/seed-ai-edge-cases.js
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const DEPT_CODE = 'AI-LAB';
const TODAY = new Date();

/** Weekday N working days back from today, as a DATE (no time component). */
const workdayBack = (n) => {
  const d = new Date(TODAY);
  let counted = 0;
  while (counted < n) {
    d.setDate(d.getDate() - 1);
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) counted += 1;
  }
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
};
const dateOnly = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
const daysFromNow = (n) => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return dateOnly(d);
};

const SLOTS = [
  { label: '10:00 - 11:00', startMinute: 600, endMinute: 660 },
  { label: '11:00 - 12:00', startMinute: 660, endMinute: 720 },
  { label: '12:00 - 01:00', startMinute: 720, endMinute: 780 },
  { label: 'Lunch', startMinute: 780, endMinute: 840, isBreak: true },
  { label: '02:00 - 03:00', startMinute: 840, endMinute: 900 },
  { label: '03:00 - 04:00', startMinute: 900, endMinute: 960 },
  { label: '04:00 - 05:00', startMinute: 960, endMinute: 1020 },
  { label: '05:00 - 06:00', startMinute: 1020, endMinute: 1080 },
];

/**
 * THE CASES.
 *
 * `expect` is what a correct analyser must say. `trap` is the wrong answer that
 * is easier to reach — it is the whole reason the case is in the file.
 */
const CASES = [
  {
    code: 'AIL-01',
    first: 'Meera',
    last: 'Krishnan',
    expect: 'NO_PROGRESS (CRITICAL)',
    trap: 'Reads as three unremarkable entries if you only ever see one hour at a time.',
    why: 'The Schoolmate pattern: one hour of work, described three ways over twelve days, against a module the project itself closed on day five. No two strings match, so no amount of SQL finds it.',
    project: 'AIL-SCHOOL',
    module: { name: 'Communication', status: 'COMPLETED', completedDaysAgo: 9 },
    assignment: { title: 'Build the Communication module', estimatedHours: 40, status: 'IN_PROGRESS' },
    entries: [
      { back: 12, text: 'tested communication module' },
      { back: 7, text: 'testing schoolmate communication module' },
      { back: 2, text: 'testing communication module of schoolmate app' },
    ],
  },
  {
    code: 'AIL-02',
    first: 'Sanjay',
    last: 'Rao',
    expect: 'ON_TRACK',
    trap: 'MISALIGNED or NO_PROGRESS — three weeks on one module LOOKS like stalling.',
    why: 'Long work on a big module is normal engineering. Every entry names a different, advancing piece and the module is still open. Repetition of the SUBJECT is not repetition of the WORK.',
    project: 'AIL-SCHOOL',
    module: { name: 'Attendance', status: 'IN_PROGRESS' },
    assignment: { title: 'Build the Attendance module', estimatedHours: 60, status: 'IN_PROGRESS' },
    entries: [
      { back: 12, text: 'Modelled the attendance tables and wrote the migration for term-wise roll-up' },
      { back: 10, text: 'Implemented the bulk mark-present endpoint with per-class validation' },
      { back: 8, text: 'Added the half-day and late-arrival cases the class teachers asked for' },
      { back: 5, text: 'Wrote the monthly attendance report query and indexed it by class and term' },
      { back: 3, text: 'Handled the leave-approval overlap so approved leave stops counting as absence' },
      { back: 1, text: 'Built the parent-facing attendance summary screen and wired it to the API' },
    ],
  },
  {
    code: 'AIL-03',
    first: 'Anita',
    last: 'Desai',
    expect: 'ON_TRACK',
    trap: 'NO_PROGRESS — "hours logged after the module was marked COMPLETED" is the single most incriminating-looking signal in the system.',
    why: 'Bug fixes, review comments and hardening legitimately arrive after sign-off. A completion date is corroboration for a finding, never a finding on its own. The entries are distinct and advancing, so this is normal delivery.',
    project: 'AIL-PORTAL',
    module: { name: 'Fee Payment', status: 'COMPLETED', completedDaysAgo: 8 },
    assignment: { title: 'Fee payment gateway integration', estimatedHours: 30, status: 'SUBMITTED' },
    entries: [
      { back: 7, text: 'Fixed the double-charge on retry that QA found after sign-off' },
      { back: 5, text: 'Addressed review comments: extracted the gateway client and added timeouts' },
      { back: 3, text: 'Added the reconciliation report finance asked for post-launch' },
      { back: 1, text: 'Patched the webhook signature check flagged by the security review' },
    ],
  },
  {
    code: 'AIL-04',
    first: 'Vikas',
    last: 'Menon',
    expect: 'IDLE at WARNING — never CRITICAL',
    trap: 'IDLE / CRITICAL. The model reached for it repeatedly during development; the cap is now enforced in code.',
    why: 'This system holds no record of leave, sick days, secondments or onboarding. An empty fortnight is explained just as well by any of them. Absence of data is not evidence.',
    project: 'AIL-PORTAL',
    module: { name: 'Notifications', status: 'PENDING' },
    assignment: { title: 'Push notification service', estimatedHours: 25, status: 'ASSIGNED' },
    entries: [],
  },
  {
    code: 'AIL-05',
    first: 'Latha',
    last: 'Iyer',
    role: 'TECH_LEAD',
    expect: 'ON_TRACK, or IDLE at INFO at worst',
    trap: 'IDLE — a lead\'s own sheet is thin by design, and a naive reading calls the most useful person on the team the laziest.',
    why: 'A lead\'s day is spread across reviewing, unblocking and interviewing. The sheet is a poor instrument for it, and the analyser is told so explicitly.',
    project: 'AIL-PORTAL',
    module: { name: 'Admin Console', status: 'IN_PROGRESS' },
    assignment: { title: 'Own the admin console delivery', estimatedHours: 20, status: 'IN_PROGRESS' },
    entries: [
      { back: 9, text: 'Reviewed the fee-payment PR and paired with Anita on the retry bug' },
      { back: 4, text: 'Sprint planning, interviewed two backend candidates, unblocked the attendance migration' },
    ],
  },
  {
    code: 'AIL-06',
    first: 'Rahul',
    last: 'Bose',
    expect: 'MISALIGNED',
    trap: 'ON_TRACK — every entry describes real, competent, effortful work.',
    why: 'The work is good and it is not the work he was asked to do. Alignment is a question about direction, not about effort, and this is the case that separates the two.',
    project: 'AIL-PORTAL',
    module: { name: 'Login API', status: 'IN_PROGRESS' },
    assignment: { title: 'Build the login API endpoint', estimatedHours: 16, status: 'IN_PROGRESS' },
    entries: [
      { back: 6, text: 'Redesigned the marketing homepage hero section and picked new display fonts' },
      { back: 5, text: 'Adjusted footer spacing and tweaked button colours on the public landing page' },
      { back: 4, text: 'Built a new pricing page layout and animated the feature cards' },
      { back: 2, text: 'Reworked the mobile navigation drawer and its open/close transition' },
    ],
  },
  {
    code: 'AIL-07',
    first: 'Deepa',
    last: 'Nair',
    expect: 'LOW_SUBSTANCE',
    trap: 'IDLE — she logged every single day, so coverage looks perfect.',
    why: 'Full compliance, zero evidence. Nothing here could be defended in a conversation with her, which is exactly what the finding should say. This is the case that proves the analyser reads the WRITING, not the row count.',
    project: 'AIL-SCHOOL',
    module: { name: 'Timetable', status: 'IN_PROGRESS' },
    assignment: { title: 'Timetable generator', estimatedHours: 35, status: 'IN_PROGRESS' },
    entries: [
      { back: 8, text: 'worked on task' },
      { back: 7, text: 'continued the work' },
      { back: 6, text: 'did some work' },
      { back: 5, text: 'task related work' },
      { back: 4, text: 'continued' },
      { back: 3, text: 'same as yesterday' },
      { back: 2, text: 'work' },
      { back: 1, text: 'continued task' },
    ],
  },
  {
    code: 'AIL-08',
    first: 'Kiran',
    last: 'Shah',
    expect: 'NO_PROGRESS (CRITICAL)',
    trap: 'ON_TRACK — the entries are wordy and sound technical.',
    why: 'Eight estimated hours, thirty logged, status untouched, and every entry restates the same activity. This is the overrun arm of NO_PROGRESS: the corroboration is the estimate rather than a completion date.',
    project: 'AIL-SCHOOL',
    module: { name: 'Report Cards', status: 'IN_PROGRESS' },
    assignment: { title: 'Fix the report card PDF alignment', estimatedHours: 8, status: 'IN_PROGRESS' },
    entries: [
      { back: 10, text: 'Working on the report card PDF alignment issue' },
      { back: 9, text: 'Still looking into the PDF alignment problem on report cards' },
      { back: 8, text: 'Continued investigating the report card PDF layout alignment' },
      { back: 7, text: 'Debugging the alignment of the report card PDF output' },
      { back: 6, text: 'Report card PDF alignment - still investigating the root cause' },
      { back: 3, text: 'Looking again at why the report card PDF is misaligned' },
      { back: 2, text: 'Report card PDF alignment issue investigation continues' },
      { back: 1, text: 'Still on the report card PDF alignment' },
    ],
  },
  {
    code: 'AIL-09',
    first: 'Arun',
    last: 'Pillai',
    expect: 'AT_RISK',
    trap: 'ON_TRACK — one good entry and nothing visibly wrong.',
    why: 'Forty estimated hours, due in two days, three logged. Nothing about the work is bad; the arithmetic is. This is the only finding here that is about the FUTURE, and the only one a manager can still act on in time.',
    project: 'AIL-PORTAL',
    module: { name: 'Bulk Import', status: 'IN_PROGRESS' },
    assignment: { title: 'Student bulk import with validation', estimatedHours: 40, status: 'IN_PROGRESS', dueInDays: 2, priority: 'HIGH' },
    entries: [
      { back: 6, text: 'Sketched the CSV column mapping and drafted the validation rules' },
      { back: 5, text: 'Spiked the row-level error reporting format' },
      { back: 4, text: 'Set up the import fixture files for testing' },
    ],
  },
  {
    code: 'AIL-10',
    first: 'Sneha',
    last: 'Varma',
    expect: 'Department-wide: ON_TRACK.  Scoped to AIL-SCHOOL: NOT idle — INFO at most',
    trap: 'IDLE / CRITICAL when a manager filters the review to Schoolmate. She logged NOTHING on it — and twenty hours on the other project, which the filter hides.',
    why: 'THE CASE THE PROJECT FILTER WAS BUILT AROUND. Withholding her other hours is correct; withholding the FACT of them turns a filter into an accusation. One integer, coverage.entriesElsewhere, is the entire difference between "did nothing" and "was doing something else".',
    project: 'AIL-PORTAL',
    module: { name: 'Search', status: 'IN_PROGRESS' },
    assignment: { title: 'Global search across students and staff', estimatedHours: 30, status: 'IN_PROGRESS' },
    // A real, open assignment on the OTHER project, which she has not touched.
    extraAssignment: { project: 'AIL-SCHOOL', title: 'Schoolmate: exam seating plan', estimatedHours: 20 },
    entries: [
      { back: 9, text: 'Built the search index schema and the incremental re-index job' },
      { back: 8, text: 'Implemented fuzzy name matching with a configurable threshold' },
      { back: 7, text: 'Added department and role filters to the search API' },
      { back: 6, text: 'Wrote the search results ranking and tuned it against real queries' },
      { back: 5, text: 'Handled diacritics and short-token edge cases in the tokenizer' },
      { back: 4, text: 'Added the type-ahead endpoint with debounce-friendly caching' },
      { back: 3, text: 'Load-tested search at 50k students and fixed the N+1 on team lookup' },
      { back: 2, text: 'Wired the search UI to the new endpoint and added keyboard navigation' },
    ],
  },
  {
    code: 'AIL-11',
    first: 'Rohit',
    last: 'Kulkarni',
    expect: 'ON_TRACK, and it must SAY alignment could not be assessed',
    trap: 'MISALIGNED — with no assignments to compare against, "not aligned with anything" is an easy and completely unfounded conclusion.',
    why: 'Nothing was assigned to him. The honest answer is that alignment is unanswerable here, not that he is off-track. A model that invents a concern from missing context is worse than no model.',
    project: 'AIL-PORTAL',
    module: null,
    assignment: null,
    entries: [
      { back: 5, text: 'Cleared the flaky test backlog in the CI pipeline and re-enabled four suites' },
      { back: 4, text: 'Upgraded the Node base image and fixed the two breaking changes it surfaced' },
      { back: 2, text: 'Documented the release runbook after the last deploy went sideways' },
    ],
  },
];

const PROJECTS = [
  { code: 'AIL-SCHOOL', name: 'Schoolmate App', clientName: 'Schoolmate Pvt Ltd' },
  { code: 'AIL-PORTAL', name: 'Student Portal', clientName: 'Schoolmate Pvt Ltd' },
];

const main = async () => {
  console.log('\n▸ AI edge-case fixtures\n');

  const admin = await prisma.user.findFirst({
    where: { role: 'MANAGEMENT', status: 'ACTIVE' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!admin) throw new Error('No active MANAGEMENT account — run the main seed first.');

  // ── TEARDOWN ────────────────────────────────────────────────────────────────
  // Scoped to this department by every clause. Nothing outside AI-LAB is
  // reachable from here, which is what makes a destructive re-run safe.
  const existing = await prisma.department.findUnique({ where: { code: DEPT_CODE }, select: { id: true } });
  if (existing) {
    const d = existing.id;
    await prisma.taskEntry.deleteMany({ where: { departmentId: d } });
    await prisma.taskDay.deleteMany({ where: { departmentId: d } });
    await prisma.assignment.deleteMany({ where: { departmentId: d } });
    await prisma.aiInsight.deleteMany({ where: { departmentId: d } });
    await prisma.projectMember.deleteMany({ where: { project: { departmentId: d } } });
    await prisma.projectModule.deleteMany({ where: { project: { departmentId: d } } });
    await prisma.project.deleteMany({ where: { departmentId: d } });
    await prisma.notification.deleteMany({ where: { user: { departmentId: d } } });
    await prisma.user.deleteMany({ where: { departmentId: d } });
    console.log('  cleared the previous AI-LAB fixtures');
  }

  const department = await prisma.department.upsert({
    where: { code: DEPT_CODE },
    create: {
      code: DEPT_CODE,
      name: 'AI Edge Cases',
      description: 'Fixtures for the AI analyser. Every person here is one boundary case.',
      colorHex: '#0891B2',
      icon: 'Science',
      sortOrder: 90,
      requiredSlotsPerDay: 7,
      workingWeekdays: [1, 2, 3, 4, 5],
      aiAnalysisEnabled: true,
    },
    update: { isActive: true, aiAnalysisEnabled: true },
  });

  for (const [i, s] of SLOTS.entries()) {
    await prisma.timeSlot.upsert({
      where: { departmentId_startMinute: { departmentId: department.id, startMinute: s.startMinute } },
      create: { ...s, departmentId: department.id, sortOrder: i },
      update: { ...s, sortOrder: i, isActive: true },
    });
  }
  const slots = await prisma.timeSlot.findMany({
    where: { departmentId: department.id, isBreak: false, isActive: true },
    orderBy: { startMinute: 'asc' },
  });

  // The internal catch-all, so hours that belong to no project still have an
  // honest home — same contract as every other department.
  await prisma.project.upsert({
    where: { departmentId_code: { departmentId: department.id, code: `${DEPT_CODE}-INTERNAL` } },
    create: {
      code: `${DEPT_CODE}-INTERNAL`,
      name: 'Internal / Non-project',
      departmentId: department.id,
      isInternal: true,
      status: 'ACTIVE',
    },
    update: {},
  });

  const projectByCode = new Map();
  for (const p of PROJECTS) {
    const row = await prisma.project.upsert({
      where: { departmentId_code: { departmentId: department.id, code: p.code } },
      create: { ...p, departmentId: department.id, status: 'ACTIVE' },
      update: { departmentId: department.id, status: 'ACTIVE' },
    });
    projectByCode.set(p.code, row);
  }

  const passwordHash = await bcrypt.hash('Password@2026!', 10);
  const summary = [];

  for (const c of CASES) {
    const project = projectByCode.get(c.project);

    const user = await prisma.user.create({
      data: {
        employeeCode: c.code,
        email: `${c.first}.${c.last}`.toLowerCase() + '@ara-workbench.local',
        passwordHash,
        firstName: c.first,
        lastName: c.last,
        role: c.role ?? 'EMPLOYEE',
        designation: c.role === 'TECH_LEAD' ? 'Tech Lead' : 'Software Engineer',
        departmentId: department.id,
        status: 'ACTIVE',
        mustChangePassword: false,
        createdById: admin.id,
      },
    });

    await prisma.projectMember.create({
      data: { projectId: project.id, userId: user.id, addedById: admin.id },
    });

    let module = null;
    if (c.module) {
      module = await prisma.projectModule.upsert({
        where: { projectId_name: { projectId: project.id, name: c.module.name } },
        create: {
          projectId: project.id,
          name: c.module.name,
          status: c.module.status,
          completedAt: c.module.completedDaysAgo ? workdayBack(c.module.completedDaysAgo) : null,
        },
        update: {
          status: c.module.status,
          completedAt: c.module.completedDaysAgo ? workdayBack(c.module.completedDaysAgo) : null,
        },
      });
    }

    let assignment = null;
    if (c.assignment) {
      assignment = await prisma.assignment.create({
        data: {
          departmentId: department.id,
          projectId: project.id,
          moduleId: module?.id ?? null,
          assigneeId: user.id,
          assigneeName: `${c.first} ${c.last}`,
          assigneeCode: c.code,
          assignedById: admin.id,
          assignedByName: `${admin.firstName} ${admin.lastName}`,
          title: c.assignment.title,
          description: c.assignment.description ?? null,
          status: c.assignment.status ?? 'IN_PROGRESS',
          priority: c.assignment.priority ?? 'NORMAL',
          estimatedHours: c.assignment.estimatedHours ?? null,
          dueDate: c.assignment.dueInDays ? daysFromNow(c.assignment.dueInDays) : null,
        },
      });
    }

    // The untouched assignment on the OTHER project — case 10's whole point.
    if (c.extraAssignment) {
      const other = projectByCode.get(c.extraAssignment.project);
      await prisma.projectMember.create({
        data: { projectId: other.id, userId: user.id, addedById: admin.id },
      });
      await prisma.assignment.create({
        data: {
          departmentId: department.id,
          projectId: other.id,
          assigneeId: user.id,
          assigneeName: `${c.first} ${c.last}`,
          assigneeCode: c.code,
          assignedById: admin.id,
          assignedByName: `${admin.firstName} ${admin.lastName}`,
          title: c.extraAssignment.title,
          status: 'ASSIGNED',
          estimatedHours: c.extraAssignment.estimatedHours ?? null,
        },
      });
    }

    // Entries, grouped into one TaskDay per date so the unique (day, slot) holds.
    const byDate = new Map();
    for (const e of c.entries) {
      const key = workdayBack(e.back).toISOString().slice(0, 10);
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(e);
    }

    for (const [key, dayEntries] of byDate) {
      const workDate = new Date(`${key}T00:00:00.000Z`);
      const taskDay = await prisma.taskDay.create({
        data: {
          userId: user.id,
          employeeName: `${c.first} ${c.last}`,
          employeeCode: c.code,
          departmentId: department.id,
          workDate,
          status: 'SUBMITTED',
          submittedAt: workDate,
        },
      });

      for (const [i, e] of dayEntries.entries()) {
        await prisma.taskEntry.create({
          data: {
            taskDayId: taskDay.id,
            timeSlotId: slots[i % slots.length].id,
            userId: user.id,
            employeeName: `${c.first} ${c.last}`,
            employeeCode: c.code,
            departmentId: department.id,
            workDate,
            description: e.text,
            projectId: project.id,
            assignmentId: assignment?.id ?? null,
            createdById: user.id,
          },
        });
      }
    }

    summary.push({ code: c.code, name: `${c.first} ${c.last}`, entries: c.entries.length, expect: c.expect });
  }

  console.log(`  department : ${department.name} (${DEPT_CODE})`);
  console.log(`  projects   : ${PROJECTS.map((p) => p.code).join(', ')}`);
  console.log(`  people     : ${CASES.length}\n`);
  console.log('  ' + 'CODE'.padEnd(8) + 'WHO'.padEnd(18) + 'HRS'.padEnd(5) + 'MUST CONCLUDE');
  console.log('  ' + '─'.repeat(96));
  for (const s of summary) {
    console.log('  ' + s.code.padEnd(8) + s.name.padEnd(18) + String(s.entries).padEnd(5) + s.expect);
  }
  console.log('\n  Sign in as any of them with Password@2026!');
  console.log('  Then: AI Insights → Period reviews → department "AI Edge Cases" → Run AI detection\n');
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
