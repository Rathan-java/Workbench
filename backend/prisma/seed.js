/**
 * DATABASE SEED.
 *
 * This file is where "four departments, each with its own working hours" stops
 * being an idea and becomes data.
 *
 * WHY EVERY DEPARTMENT SEEDS ZERO CUSTOM TASK FIELDS
 * There used to be four sets of them here — Tech asked for a Work Type, a Ticket
 * Reference, an Environment and a Blocker Detail; Marketing for a Channel, a
 * Campaign, a Spend and a Lead count; and so on. Every one of them was defensible
 * on its own, and together they made the form a wall.
 *
 * The arithmetic is what decides it. Roughly 40 people × 7 hours × 5 days is
 * 1,400 entries a week, so a field that takes four seconds to answer costs about
 * an hour and a half of company time per week, forever. That is a fair price for
 * a field somebody reads. It is a terrible price for a field nobody reads — and
 * the honest failure mode is worse than the cost: when a form is long, people
 * stop filling it in, or they fill it in with whatever passes validation. Then
 * the compliance number goes down and the data quality goes down together, which
 * is the exact opposite of what the fields were added to achieve.
 *
 * So the shipped form asks two questions: what did you finish, and what for. The
 * TaskFieldDefinition engine is still here, and an admin can add a field to their
 * own department in the UI whenever they can name who will read it.
 *
 * Every seed operation is an UPSERT keyed on a stable business code, so this
 * script is IDEMPOTENT: it runs on every deploy, creates what is missing, and
 * never clobbers what an administrator has since changed. A seed you are afraid
 * to re-run is a seed that will be out of date within a month.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { env } from '../src/config/env.js';
import { DEPARTMENT_CODE } from '../src/config/constants.js';
import { ensureDefaults } from '../src/modules/settings/setting.service.js';

const prisma = new PrismaClient();

const log = (message, meta) =>
  console.log(`  ${message}${meta ? ` ${JSON.stringify(meta)}` : ''}`);

// ---------------------------------------------------------------------------
// The four departments
// ---------------------------------------------------------------------------

/**
 * Note that each department carries its OWN working hours and its OWN required
 * slot count. The brief specified one seven-hour Tech schedule; in a real IT
 * company Video Editing runs a later shift and Social Media covers weekends.
 * Because these are rows and not constants, that is a seed change, not a release.
 */
const DEPARTMENTS = [
  {
    code: DEPARTMENT_CODE.TECH,
    name: 'Tech Team',
    description: 'Software engineering, QA, DevOps and technical delivery.',
    colorHex: '#2563EB',
    icon: 'Code',
    sortOrder: 1,
    requiredSlotsPerDay: 7,
    workingWeekdays: [1, 2, 3, 4, 5],
    /** The exact columns from the brief: 10–1, lunch, 2–6. */
    timeSlots: [
      { label: '10:00 - 11:00', startMinute: 600, endMinute: 660 },
      { label: '11:00 - 12:00', startMinute: 660, endMinute: 720 },
      { label: '12:00 - 01:00', startMinute: 720, endMinute: 780 },
      { label: 'Lunch', startMinute: 780, endMinute: 840, isBreak: true },
      { label: '02:00 - 03:00', startMinute: 840, endMinute: 900 },
      { label: '03:00 - 04:00', startMinute: 900, endMinute: 960 },
      { label: '04:00 - 05:00', startMinute: 960, endMinute: 1020 },
      { label: '05:00 - 06:00', startMinute: 1020, endMinute: 1080 },
    ],
    fields: [],
  },

  {
    code: DEPARTMENT_CODE.DIGITAL_MARKETING,
    name: 'Digital Marketing',
    description: 'Paid media, SEO, email marketing, analytics and lead generation.',
    colorHex: '#7C3AED',
    icon: 'TrendingUp',
    sortOrder: 2,
    requiredSlotsPerDay: 7,
    workingWeekdays: [1, 2, 3, 4, 5],
    timeSlots: [
      { label: '09:30 - 10:30', startMinute: 570, endMinute: 630 },
      { label: '10:30 - 11:30', startMinute: 630, endMinute: 690 },
      { label: '11:30 - 12:30', startMinute: 690, endMinute: 750 },
      { label: 'Lunch', startMinute: 750, endMinute: 810, isBreak: true },
      { label: '01:30 - 02:30', startMinute: 810, endMinute: 870 },
      { label: '02:30 - 03:30', startMinute: 870, endMinute: 930 },
      { label: '03:30 - 04:30', startMinute: 930, endMinute: 990 },
      { label: '04:30 - 05:30', startMinute: 990, endMinute: 1050 },
    ],
    fields: [],
  },

  {
    code: DEPARTMENT_CODE.SOCIAL_MEDIA,
    name: 'Social Media Management',
    description: 'Content calendars, community management, publishing and engagement.',
    colorHex: '#DB2777',
    icon: 'Share',
    sortOrder: 3,
    // Social does not stop on Saturday — the brand does not go quiet at the
    // weekend. Six-day week, and the compliance metrics follow automatically.
    requiredSlotsPerDay: 7,
    workingWeekdays: [1, 2, 3, 4, 5, 6],
    timeSlots: [
      { label: '10:00 - 11:00', startMinute: 600, endMinute: 660 },
      { label: '11:00 - 12:00', startMinute: 660, endMinute: 720 },
      { label: '12:00 - 01:00', startMinute: 720, endMinute: 780 },
      { label: 'Lunch', startMinute: 780, endMinute: 840, isBreak: true },
      { label: '02:00 - 03:00', startMinute: 840, endMinute: 900 },
      { label: '03:00 - 04:00', startMinute: 900, endMinute: 960 },
      { label: '04:00 - 05:00', startMinute: 960, endMinute: 1020 },
      { label: '05:00 - 06:00', startMinute: 1020, endMinute: 1080 },
    ],
    fields: [],
  },

  {
    code: DEPARTMENT_CODE.VIDEO_EDITING,
    name: 'Video Editing',
    description: 'Editing, motion graphics, colour grading, sound design and delivery.',
    colorHex: '#EA580C',
    icon: 'Movie',
    sortOrder: 4,
    // A later shift: editors work with clients across time zones and render
    // overnight. Their grid genuinely differs — which is exactly why time slots
    // are per-department rows and not a hardcoded array.
    requiredSlotsPerDay: 7,
    workingWeekdays: [1, 2, 3, 4, 5],
    timeSlots: [
      { label: '11:00 - 12:00', startMinute: 660, endMinute: 720 },
      { label: '12:00 - 01:00', startMinute: 720, endMinute: 780 },
      { label: '01:00 - 02:00', startMinute: 780, endMinute: 840 },
      { label: 'Lunch', startMinute: 840, endMinute: 900, isBreak: true },
      { label: '03:00 - 04:00', startMinute: 900, endMinute: 960 },
      { label: '04:00 - 05:00', startMinute: 960, endMinute: 1020 },
      { label: '05:00 - 06:00', startMinute: 1020, endMinute: 1080 },
      { label: '06:00 - 07:00', startMinute: 1080, endMinute: 1140 },
    ],
    fields: [],
  },
];

const seedDepartments = async () => {
  console.log('\n▸ Departments, working hours and task fields');

  for (const dept of DEPARTMENTS) {
    const { timeSlots, fields, ...data } = dept;

    const department = await prisma.department.upsert({
      where: { code: dept.code },
      create: data,
      // Only the presentational/config bits are refreshed. `isActive` is left
      // alone — if an admin has retired a department, a redeploy must not
      // silently resurrect it.
      update: {
        name: data.name,
        description: data.description,
        colorHex: data.colorHex,
        icon: data.icon,
        sortOrder: data.sortOrder,
        requiredSlotsPerDay: data.requiredSlotsPerDay,
        workingWeekdays: data.workingWeekdays,
      },
    });

    // THE INTERNAL PROJECT — core seed data, not demo data.
    //
    // TaskEntry.projectId is NOT NULL, so a department with no project is a
    // department nobody can log an hour in. And even with a full portfolio of
    // real projects, the all-hands, the induction and the interview panel belong
    // to none of them. Without somewhere honest to put those hours, people put
    // them somewhere dishonest — and the lie lands in the project reports.
    //
    // This is upserted with the department itself so it exists in every
    // environment, on the very first boot, before anybody has created anything.
    await prisma.project.upsert({
      where: { departmentId_code: { departmentId: department.id, code: 'INTERNAL' } },
      create: {
        departmentId: department.id,
        code: 'INTERNAL',
        name: 'Internal / Non-project',
        description:
          'Meetings, admin, training, interviews, support — work that genuinely belongs to no project.',
        status: 'ACTIVE',
        isInternal: true,
      },
      // Never resurrect it to ACTIVE on redeploy if an admin somehow archived it,
      // and never rename it out from under them — but DO keep the flag true, since
      // that flag is what protects it from deletion.
      update: { isInternal: true },
    });

    for (const [index, slot] of timeSlots.entries()) {
      await prisma.timeSlot.upsert({
        where: {
          departmentId_startMinute: {
            departmentId: department.id,
            startMinute: slot.startMinute,
          },
        },
        create: {
          departmentId: department.id,
          label: slot.label,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          isBreak: slot.isBreak ?? false,
          sortOrder: index,
        },
        update: { label: slot.label, endMinute: slot.endMinute, sortOrder: index },
      });
    }

    for (const [index, field] of fields.entries()) {
      await prisma.taskFieldDefinition.upsert({
        where: { departmentId_key: { departmentId: department.id, key: field.key } },
        create: {
          departmentId: department.id,
          key: field.key,
          label: field.label,
          type: field.type,
          isRequired: field.isRequired ?? false,
          options: field.options ?? undefined,
          placeholder: field.placeholder,
          helpText: field.helpText,
          maxLength: field.maxLength,
          minValue: field.minValue,
          maxValue: field.maxValue,
          showInTable: field.showInTable ?? false,
          sortOrder: index,
        },
        update: {
          label: field.label,
          type: field.type,
          isRequired: field.isRequired ?? false,
          options: field.options ?? undefined,
          placeholder: field.placeholder,
          helpText: field.helpText,
          maxLength: field.maxLength,
          minValue: field.minValue,
          maxValue: field.maxValue,
          showInTable: field.showInTable ?? false,
          sortOrder: index,
        },
      });
    }

    log(`✓ ${department.name}`, {
      slots: timeSlots.filter((s) => !s.isBreak).length,
      fields: fields.length,
    });
  }
};

// ---------------------------------------------------------------------------
// The default Management account
// ---------------------------------------------------------------------------

const seedAdmin = async () => {
  console.log('\n▸ Default Management account');

  const existing = await prisma.user.findUnique({
    where: { email: env.SEED_ADMIN_EMAIL },
    select: { id: true, email: true },
  });

  if (existing) {
    // Never reset a live admin's password on redeploy. Doing so would let anyone
    // with the repo read the seed password and walk in — and would lock out the
    // real administrator every single deployment.
    log(`✓ Already exists: ${existing.email} (password left unchanged)`);
    return existing;
  }

  const admin = await prisma.user.create({
    data: {
      employeeCode: 'ADMIN-001',
      email: env.SEED_ADMIN_EMAIL,
      passwordHash: await bcrypt.hash(env.SEED_ADMIN_PASSWORD, env.BCRYPT_SALT_ROUNDS),
      firstName: env.SEED_ADMIN_FIRST_NAME,
      lastName: env.SEED_ADMIN_LAST_NAME,
      role: 'MANAGEMENT',
      status: 'ACTIVE',
      designation: 'System Administrator',
      // Management is cross-departmental by definition — no department, no team.
      departmentId: null,
      teamId: null,
      mustChangePassword: true, // the seed password is in a config file. Change it.
    },
  });

  log(`✓ Created: ${admin.email}`);
  console.log(`\n  ┌────────────────────────────────────────────────────────┐`);
  console.log(`  │  Sign in with:                                         │`);
  console.log(`  │  Email:    ${env.SEED_ADMIN_EMAIL.padEnd(43)}│`);
  console.log(`  │  Password: ${env.SEED_ADMIN_PASSWORD.padEnd(43)}│`);
  console.log(`  │  You will be forced to change it on first sign-in.     │`);
  console.log(`  └────────────────────────────────────────────────────────┘`);

  return admin;
};

// ---------------------------------------------------------------------------
// Demo data (opt-in)
// ---------------------------------------------------------------------------

const DEMO_TEAMS = [
  { code: 'TECH-PLATFORM', name: 'Platform Engineering', dept: DEPARTMENT_CODE.TECH },
  { code: 'TECH-PRODUCT', name: 'Product Engineering', dept: DEPARTMENT_CODE.TECH },
  { code: 'DM-PERFORMANCE', name: 'Performance Marketing', dept: DEPARTMENT_CODE.DIGITAL_MARKETING },
  { code: 'SM-CONTENT', name: 'Content & Community', dept: DEPARTMENT_CODE.SOCIAL_MEDIA },
  { code: 'VE-POST', name: 'Post Production', dept: DEPARTMENT_CODE.VIDEO_EDITING },
];

/**
 * Demo projects. Flat — there is no module level under them, deliberately.
 *
 * One level answers every question management actually asks (how is this project
 * going, who is on it, what did they do). A second level would be one more
 * dropdown an employee has to get right at 6pm before they can go home, and the
 * failure mode of a dropdown people resent is not a wrong answer — it is the
 * first option in the list, chosen 400 times.
 */
const DEMO_PROJECTS = [
  { code: 'PAY', name: 'Payments Platform', dept: DEPARTMENT_CODE.TECH, clientName: 'Internal' },
  { code: 'PORTAL', name: 'Customer Portal', dept: DEPARTMENT_CODE.TECH, clientName: 'Northwind' },
  { code: 'Q3LEAD', name: 'Q3 Enterprise Lead Gen', dept: DEPARTMENT_CODE.DIGITAL_MARKETING, clientName: 'Northwind' },
  { code: 'BRAND26', name: 'Brand Refresh 2026', dept: DEPARTMENT_CODE.SOCIAL_MEDIA, clientName: 'Internal' },
  { code: 'LAUNCH', name: 'Product Launch Film', dept: DEPARTMENT_CODE.VIDEO_EDITING, clientName: 'Acme Corp' },
];

const DEMO_PEOPLE = [
  { code: 'TL-001', first: 'Priya', last: 'Sharma', role: 'TECH_LEAD', team: 'TECH-PLATFORM', designation: 'Engineering Lead' },
  { code: 'EMP-001', first: 'Arjun', last: 'Nair', role: 'EMPLOYEE', team: 'TECH-PLATFORM', designation: 'Senior Software Engineer' },
  { code: 'EMP-002', first: 'Divya', last: 'Menon', role: 'EMPLOYEE', team: 'TECH-PLATFORM', designation: 'Software Engineer' },
  { code: 'EMP-003', first: 'Rohan', last: 'Gupta', role: 'EMPLOYEE', team: 'TECH-PRODUCT', designation: 'QA Engineer' },
  { code: 'TL-002', first: 'Neha', last: 'Kulkarni', role: 'TECH_LEAD', team: 'DM-PERFORMANCE', designation: 'Marketing Lead' },
  { code: 'EMP-004', first: 'Karthik', last: 'Iyer', role: 'EMPLOYEE', team: 'DM-PERFORMANCE', designation: 'Performance Marketer' },
  { code: 'TL-003', first: 'Ananya', last: 'Reddy', role: 'TECH_LEAD', team: 'SM-CONTENT', designation: 'Social Media Lead' },
  { code: 'EMP-005', first: 'Vikram', last: 'Singh', role: 'EMPLOYEE', team: 'SM-CONTENT', designation: 'Content Strategist' },
  { code: 'TL-004', first: 'Meera', last: 'Joshi', role: 'TECH_LEAD', team: 'VE-POST', designation: 'Post Production Lead' },
  { code: 'EMP-006', first: 'Aditya', last: 'Rao', role: 'EMPLOYEE', team: 'VE-POST', designation: 'Senior Video Editor' },
];

const seedDemoData = async (adminId) => {
  console.log('\n▸ Demo data (SEED_DEMO_DATA=true)');

  const departments = await prisma.department.findMany({ select: { id: true, code: true } });
  const deptByCode = new Map(departments.map((d) => [d.code, d.id]));

  for (const t of DEMO_TEAMS) {
    await prisma.team.upsert({
      where: { code: t.code },
      create: { code: t.code, name: t.name, departmentId: deptByCode.get(t.dept) },
      update: {},
    });
  }

  const teams = await prisma.team.findMany({ select: { id: true, code: true, departmentId: true } });
  const teamByCode = new Map(teams.map((t) => [t.code, t]));

  for (const p of DEMO_PEOPLE) {
    const team = teamByCode.get(p.team);
    await prisma.user.upsert({
      where: { email: `${p.first}.${p.last}`.toLowerCase().replace(/\s/g, '') + '@ara-workbench.local' },
      create: {
        employeeCode: p.code,
        email: `${p.first}.${p.last}`.toLowerCase().replace(/\s/g, '') + '@ara-workbench.local',
        passwordHash: await bcrypt.hash('Password@2026!', env.BCRYPT_SALT_ROUNDS),
        firstName: p.first,
        lastName: p.last,
        role: p.role,
        designation: p.designation,
        departmentId: team.departmentId,
        teamId: team.id,
        status: 'ACTIVE',
        mustChangePassword: false, // demo accounts are meant to be signed into
        createdById: adminId,
      },
      update: {},
    });
  }

  // Wire each Tech Lead to the team they lead.
  for (const p of DEMO_PEOPLE.filter((x) => x.role === 'TECH_LEAD')) {
    const email = `${p.first}.${p.last}`.toLowerCase().replace(/\s/g, '') + '@ara-workbench.local';
    const lead = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    await prisma.team.update({
      where: { code: p.team },
      data: { leadId: lead.id },
    });
  }

  for (const proj of DEMO_PROJECTS) {
    const existing = await prisma.project.findUnique({
      where: { departmentId_code: { departmentId: deptByCode.get(proj.dept), code: proj.code } },
    });
    if (existing) continue;

    await prisma.project.create({
      data: {
        code: proj.code,
        name: proj.name,
        clientName: proj.clientName,
        departmentId: deptByCode.get(proj.dept),
        status: 'ACTIVE',
      },
    });
  }

  log(`✓ ${DEMO_TEAMS.length} teams, ${DEMO_PEOPLE.length} users, ${DEMO_PROJECTS.length} projects`);
  log('  Demo password for every seeded user: Password@2026!');
};

// ---------------------------------------------------------------------------

const main = async () => {
  console.log(`\n╭─────────────────────────────────────────────╮`);
  console.log(`│  ${env.APP_NAME} — database seed`.padEnd(46) + '│');
  console.log(`╰─────────────────────────────────────────────╯`);

  await seedDepartments();

  const admin = await seedAdmin();

  console.log('\n▸ System settings');
  await ensureDefaults();
  log('✓ Defaults persisted');

  if (env.SEED_DEMO_DATA) await seedDemoData(admin.id);

  console.log('\n✓ Seed complete\n');
};

main()
  .catch((error) => {
    console.error('\n✖ Seed failed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
