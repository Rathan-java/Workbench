/**
 * Dashboards and analytics.
 *
 * ── WHERE THE NUMBERS COME FROM ──────────────────────────────────────────────
 * TODAY's figures are read live from task_entries — they must be, because the
 * whole point is watching work as it happens.
 *
 * HISTORICAL trends (productivity over weeks and months) are read from
 * daily_productivity_rollups, a nightly materialised table. Aggregating six
 * months of raw entries on every dashboard load would be a full scan of the
 * largest table in the system, executed by every manager, several times a day.
 * The rollup turns that into an index-served read of a few hundred rows.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────
 * Every query here composes scopeWhere(). A Tech Lead opening the dashboard sees
 * their department's numbers and no one else's — not because the UI hides the
 * rest, but because the SQL never selected it.
 */
import { prisma } from '../../config/prisma.js';
import { scopedWhereWithFilters } from '../../core/accessScope.js';
import { and } from '../../core/pagination.js';
import { buildDateFilter } from '../tasks/task.repository.js';
import {
  toWorkDate,
  todayWorkDate,
  formatWorkDate,
  eachWorkDate,
  minutesSinceMidnight,
  isoWeekdayOf,
  dayjs,
} from '../../utils/date.js';
import {
  DAY_STATUS,
  SETTING_KEY,
  DEFAULT_GRACE_MINUTES,
  ASSIGNMENT_STATUS,
  ASSIGNMENT_OPEN_STATUSES,
} from '../../config/constants.js';
import * as settings from '../settings/setting.service.js';
import { fullName } from '../../utils/name.js';

const pct = (numerator, denominator) =>
  denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0;

/**
 * The executive summary cards.
 * All eight numbers in ONE round trip via $transaction — eight sequential
 * awaits would make the dashboard feel sluggish for no reason.
 */
export const getSummary = async (scope, { date, departmentId, teamId } = {}) => {
  const workDate = toWorkDate(date ?? todayWorkDate());
  const entryScope = and(scopedWhereWithFilters(scope, { departmentId, teamId }), { workDate });
  const dayScope = and(scopedWhereWithFilters(scope, { departmentId, teamId }), { workDate });

  // Headcount uses `id` as the ownership column (see accessScope.js).
  const staffScope = and(
    scopedWhereWithFilters(scope, { departmentId, teamId }, { userField: 'id', selfSeesDepartment: true }),
    { status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TECH_LEAD'] } },
  );

  const [
    totalEntries,
    activeEmployees,
    headcount,
    lateEntries,
    dayStatusCounts,
    projectsWorkedOn,
    projectCount,
    teamCount,
  ] = await prisma.$transaction([
    prisma.taskEntry.count({ where: entryScope }),
    // DISTINCT employees who logged anything today.
    prisma.taskDay.count({ where: and(dayScope, { filledSlots: { gt: 0 } }) }),
    prisma.user.count({ where: staffScope }),
    prisma.taskEntry.count({ where: and(entryScope, { isLate: true }) }),
    prisma.taskDay.groupBy({ by: ['status'], where: dayScope, _count: { _all: true } }),
    // How many projects actually moved today, as opposed to how many exist.
    prisma.taskEntry.groupBy({ by: ['projectId'], where: entryScope, _count: { _all: true } }),
    prisma.project.count({
      where: and(scopedWhereWithFilters(scope, { departmentId }, { selfSeesDepartment: true }), {
        status: 'ACTIVE',
      }),
    }),
    prisma.team.count({
      where: and(scopedWhereWithFilters(scope, { departmentId }, { selfSeesDepartment: true }), {
        isActive: true,
      }),
    }),
  ]);

  const byDayStatus = Object.fromEntries(dayStatusCounts.map((s) => [s.status, s._count._all]));

  return {
    date: formatWorkDate(workDate),
    cards: {
      // "Hours logged" — not "tasks". Every row IS an hour of completed work, and
      // calling it what it is stops anyone reading it as a to-do count.
      hoursLogged: totalEntries,
      activeEmployees,
      headcount,
      /** The number a manager actually opens this page to see. */
      notLoggedToday: Math.max(headcount - activeEmployees, 0),
      lateUpdates: lateEntries,
      pendingApproval: byDayStatus[DAY_STATUS.SUBMITTED] ?? 0,
      approved: byDayStatus[DAY_STATUS.APPROVED] ?? 0,
      rejected: byDayStatus[DAY_STATUS.REJECTED] ?? 0,
      /** Projects that MOVED today vs projects that merely exist. */
      projectsActiveToday: projectsWorkedOn.length,
      projects: projectCount,
      teams: teamCount,
    },
    rates: {
      participation: pct(activeEmployees, headcount),
      punctuality: pct(totalEntries - lateEntries, totalEntries),
    },
  };
};

/**
 * Hourly activity: how many entries were logged against each time slot.
 * The shape of a working day, and the fastest way to spot the 4pm cliff where
 * everyone stops updating.
 */
export const getHourlyActivity = async (scope, filters) => {
  const where = and(
    scopedWhereWithFilters(scope, filters),
    buildDateFilter(filters) ?? { workDate: toWorkDate(todayWorkDate()) },
  );

  const rows = await prisma.taskEntry.groupBy({
    by: ['timeSlotId'],
    where,
    _count: { _all: true },
  });

  if (!rows.length) return [];

  const slots = await prisma.timeSlot.findMany({
    where: { id: { in: rows.map((r) => r.timeSlotId) } },
    select: { id: true, label: true, sortOrder: true, startMinute: true },
  });
  const slotById = new Map(slots.map((s) => [s.id, s]));

  const lateRows = await prisma.taskEntry.groupBy({
    by: ['timeSlotId'],
    where: and(where, { isLate: true }),
    _count: { _all: true },
  });
  const lateById = new Map(lateRows.map((r) => [r.timeSlotId, r._count._all]));

  return rows
    .map((r) => {
      const slot = slotById.get(r.timeSlotId);
      return {
        timeSlotId: r.timeSlotId,
        label: slot?.label ?? '—',
        sortOrder: slot?.sortOrder ?? 0,
        entries: r._count._all,
        lateEntries: lateById.get(r.timeSlotId) ?? 0,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
};

/**
 * Employee productivity — from the rollup table, not the fact table.
 *
 * RANKED ON COMPLIANCE, NOT ON VOLUME, and that is a deliberate refusal.
 * The obvious leaderboard sorts by "hours logged" or "tasks completed". Both are
 * trivially gamed: one person writes "Fixed the reconciliation race condition"
 * for an hour, another writes four lines for the same hour. Rank on volume and
 * within a fortnight everyone has learned to shred their work into the largest
 * possible number of rows, and the number you are managing by is now measuring
 * typing, not delivery.
 *
 * Compliance — did you record your day, honestly, on time — is the only thing
 * this system can actually observe. So it ranks on that, and shows the rest.
 */
export const getEmployeeProductivity = async (scope, filters) => {
  const { dateFrom, dateTo } = resolveRange(filters);

  const where = and(scopedWhereWithFilters(scope, filters), {
    workDate: { gte: dateFrom, lte: dateTo },
  });

  const rows = await prisma.dailyProductivityRollup.groupBy({
    by: ['userId'],
    where,
    _sum: {
      expectedSlots: true,
      filledSlots: true,
      lateSlots: true,
      projectsTouched: true,
    },
    _count: { _all: true },
  });

  if (!rows.length) return [];

  const users = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.userId) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      avatarPath: true,
      designation: true,
      department: { select: { id: true, name: true, colorHex: true } },
      team: { select: { id: true, name: true } },
    },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  return rows
    .map((r) => {
      const u = userById.get(r.userId);
      const expected = r._sum.expectedSlots ?? 0;
      const filled = r._sum.filledSlots ?? 0;

      return {
        userId: r.userId,
        fullName: u ? fullName(u) : 'Unknown',
        employeeCode: u?.employeeCode ?? '—',
        avatarPath: u?.avatarPath ?? null,
        designation: u?.designation ?? null,
        department: u?.department ?? null,
        team: u?.team ?? null,
        daysTracked: r._count._all,
        expectedSlots: expected,
        /** Every filled slot is an hour of completed work. That is the count. */
        hoursLogged: filled,
        expectedHours: expected,
        lateSlots: r._sum.lateSlots ?? 0,
        /** Summed across days: the "is this person spread thin?" signal. */
        projectsTouched: r._sum.projectsTouched ?? 0,
        complianceRate: pct(filled, expected),
        punctualityRate: pct(filled - (r._sum.lateSlots ?? 0), filled),
      };
    })
    .sort((a, b) => b.complianceRate - a.complianceRate || b.hoursLogged - a.hoursLogged);
};

export const getTeamProductivity = async (scope, filters) => {
  const { dateFrom, dateTo } = resolveRange(filters);

  const rows = await prisma.dailyProductivityRollup.groupBy({
    by: ['teamId'],
    where: and(scopedWhereWithFilters(scope, filters), {
      workDate: { gte: dateFrom, lte: dateTo },
      teamId: { not: null },
    }),
    _sum: { expectedSlots: true, filledSlots: true, lateSlots: true },
    _count: { _all: true },
  });

  if (!rows.length) return [];

  const teams = await prisma.team.findMany({
    where: { id: { in: rows.map((r) => r.teamId).filter(Boolean) } },
    select: {
      id: true,
      name: true,
      department: { select: { id: true, name: true, colorHex: true } },
      lead: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { members: true } },
    },
  });
  const teamById = new Map(teams.map((t) => [t.id, t]));

  return rows
    .map((r) => {
      const t = teamById.get(r.teamId);
      const expected = r._sum.expectedSlots ?? 0;
      const filled = r._sum.filledSlots ?? 0;

      return {
        teamId: r.teamId,
        name: t?.name ?? 'Unassigned',
        department: t?.department ?? null,
        lead: t?.lead ? { id: t.lead.id, fullName: fullName(t.lead) } : null,
        memberCount: t?._count.members ?? 0,
        expectedSlots: expected,
        filledSlots: filled,
        hoursLogged: filled,
        lateSlots: r._sum.lateSlots ?? 0,
        complianceRate: pct(filled, expected),
      };
    })
    .sort((a, b) => b.complianceRate - a.complianceRate);
};

/**
 * Department productivity — the view Management opens first, and the one that
 * answers "which of my four departments is actually logging its work?".
 */
export const getDepartmentProductivity = async (scope, filters) => {
  const { dateFrom, dateTo } = resolveRange(filters);

  const rows = await prisma.dailyProductivityRollup.groupBy({
    by: ['departmentId'],
    where: and(scopedWhereWithFilters(scope, filters), {
      workDate: { gte: dateFrom, lte: dateTo },
    }),
    _sum: { expectedSlots: true, filledSlots: true, lateSlots: true },
  });

  const departments = await prisma.department.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      colorHex: true,
      _count: { select: { users: { where: { status: 'ACTIVE' } } } },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const byId = new Map(rows.map((r) => [r.departmentId, r]));

  // Departments with zero activity must still appear — a department that logged
  // nothing is the single most important thing on this chart, and dropping it
  // because the GROUP BY returned no row would hide exactly the problem the
  // dashboard exists to surface.
  return departments
    .filter((d) => scope.isGlobal || d.id === scope.departmentId)
    .map((d) => {
      const r = byId.get(d.id);
      const expected = r?._sum.expectedSlots ?? 0;
      const filled = r?._sum.filledSlots ?? 0;

      return {
        departmentId: d.id,
        code: d.code,
        name: d.name,
        colorHex: d.colorHex,
        headcount: d._count.users,
        expectedSlots: expected,
        filledSlots: filled,
        hoursLogged: filled,
        lateSlots: r?._sum.lateSlots ?? 0,
        complianceRate: pct(filled, expected),
      };
    });
};

/**
 * PROJECT PROGRESS — the axis this redesign was built around.
 *
 * There is no "% complete" here, and its absence is the whole point. This system
 * knows exactly one thing about a project: how many hours of completed work have
 * been logged against it, by whom, and when. It does NOT know the size of the
 * project, so any percentage it printed would be a number divided by a guess.
 * A progress bar that says "68%" when nobody ever told it what 100% was is not a
 * measurement — it is a decoration that people make decisions on.
 *
 * So what it reports is what it can defend:
 *   hoursLogged   — effort actually spent, from the timesheet
 *   contributors  — how many people, and who
 *   activeDays    — how many distinct days it moved
 *   lastActivity  — when it last moved. THE number that matters: a project with
 *                   200 hours and nothing since March is in more trouble than a
 *                   project with 20 hours logged yesterday.
 */
export const getProjectProductivity = async (scope, filters) => {
  const { dateFrom, dateTo } = resolveRange(filters);

  const where = and(scopedWhereWithFilters(scope, filters), {
    workDate: { gte: dateFrom, lte: dateTo },
    ...(filters?.projectId ? { projectId: filters.projectId } : {}),
  });

  const rows = await prisma.taskEntry.groupBy({
    by: ['projectId'],
    where,
    _count: { _all: true },
    _max: { workDate: true },
    _min: { workDate: true },
  });

  if (!rows.length) return [];

  const projectIds = rows.map((r) => r.projectId);

  // One row per (project, person) pair and one per (project, day), so the row
  // COUNT gives distinct contributors and distinct active days. Two group-bys
  // beat N+1 queries per project, and MySQL has no COUNT(DISTINCT) through the
  // Prisma groupBy API.
  const [projects, contributorRows, dayRows] = await Promise.all([
    prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        isInternal: true,
        clientName: true,
        department: { select: { id: true, name: true, colorHex: true } },
      },
    }),
    prisma.taskEntry.groupBy({ by: ['projectId', 'userId'], where, _count: { _all: true } }),
    prisma.taskEntry.groupBy({ by: ['projectId', 'workDate'], where }),
  ]);

  const projectById = new Map(projects.map((p) => [p.id, p]));

  /** projectId -> [{ userId, hours }] , biggest contributor first */
  const contributorsByProject = new Map();
  for (const row of contributorRows) {
    const list = contributorsByProject.get(row.projectId) ?? [];
    list.push({ userId: row.userId, hours: row._count._all });
    contributorsByProject.set(row.projectId, list);
  }

  const activeDaysByProject = new Map();
  for (const row of dayRows) {
    activeDaysByProject.set(row.projectId, (activeDaysByProject.get(row.projectId) ?? 0) + 1);
  }

  // Resolve the contributor names in ONE query for every project on the page.
  const allUserIds = [...new Set(contributorRows.map((r) => r.userId).filter(Boolean))];
  const users = await prisma.user.findMany({
    where: { id: { in: allUserIds } },
    select: { id: true, firstName: true, lastName: true, avatarPath: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const today = toWorkDate(todayWorkDate());

  return rows
    .map((r) => {
      const p = projectById.get(r.projectId);
      const contributors = (contributorsByProject.get(r.projectId) ?? []).sort(
        (a, b) => b.hours - a.hours,
      );
      const lastActivity = r._max.workDate;

      return {
        projectId: r.projectId,
        code: p?.code ?? '—',
        name: p?.name ?? 'Unknown',
        status: p?.status ?? null,
        isInternal: p?.isInternal ?? false,
        clientName: p?.clientName ?? null,
        department: p?.department ?? null,

        /** Hours of completed work. The only volume figure that is defensible. */
        hoursLogged: r._count._all,
        activeDays: activeDaysByProject.get(r.projectId) ?? 0,
        contributorCount: contributors.length,
        contributors: contributors.slice(0, 6).map((c) => {
          const u = userById.get(c.userId);
          return {
            userId: c.userId,
            fullName: u ? fullName(u) : 'Former employee',
            avatarPath: u?.avatarPath ?? null,
            hours: c.hours,
          };
        }),

        firstActivity: r._min.workDate ? formatWorkDate(r._min.workDate) : null,
        lastActivity: lastActivity ? formatWorkDate(lastActivity) : null,
        /** Days since it last moved. The staleness signal, precomputed. */
        daysSinceActivity: lastActivity
          ? Math.max(0, dayjs.utc(today).diff(dayjs.utc(lastActivity), 'day'))
          : null,
      };
    })
    .sort((a, b) => b.hoursLogged - a.hoursLogged);
};

/**
 * The trend line. Gap-filled: a day with no data must render as a zero, not
 * vanish — a chart that silently drops the days nobody logged anything is
 * lying by omission about exactly the thing you want to see.
 */
export const getTrend = async (scope, filters) => {
  const { dateFrom, dateTo } = resolveRange(filters, 30);

  const rows = await prisma.dailyProductivityRollup.groupBy({
    by: ['workDate'],
    where: and(scopedWhereWithFilters(scope, filters), {
      workDate: { gte: dateFrom, lte: dateTo },
    }),
    _sum: {
      expectedSlots: true,
      filledSlots: true,
      lateSlots: true,
    },
    _count: { _all: true },
  });

  const byDate = new Map(rows.map((r) => [formatWorkDate(r.workDate), r]));

  return eachWorkDate(dateFrom, dateTo).map((date) => {
    const key = formatWorkDate(date);
    const r = byDate.get(key);
    const expected = r?._sum.expectedSlots ?? 0;
    const filled = r?._sum.filledSlots ?? 0;

    return {
      date: key,
      employees: r?._count._all ?? 0,
      expectedSlots: expected,
      filledSlots: filled,
      hoursLogged: filled,
      lateSlots: r?._sum.lateSlots ?? 0,
      complianceRate: pct(filled, expected),
    };
  });
};

/**
 * Live compliance: who has NOT logged their hours right now.
 * This is the Tech Lead's morning screen, and it deliberately reads live data
 * rather than the rollup — a nightly aggregate is useless for chasing today.
 */
export const getComplianceToday = async (scope, { date, departmentId, teamId } = {}) => {
  const workDate = toWorkDate(date ?? todayWorkDate());

  const staffWhere = and(
    scopedWhereWithFilters(scope, { departmentId, teamId }, { userField: 'id', selfSeesDepartment: true }),
    { status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TECH_LEAD'] }, departmentId: { not: null } },
  );

  const employees = await prisma.user.findMany({
    where: staffWhere,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      employeeCode: true,
      avatarPath: true,
      designation: true,
      department: { select: { id: true, name: true, colorHex: true, requiredSlotsPerDay: true } },
      team: { select: { id: true, name: true } },
    },
    orderBy: [{ firstName: 'asc' }],
  });

  if (!employees.length) return { date: formatWorkDate(workDate), employees: [], summary: emptyCompliance() };

  const days = await prisma.taskDay.findMany({
    where: { userId: { in: employees.map((e) => e.id) }, workDate },
    select: { userId: true, filledSlots: true, expectedSlots: true, status: true },
  });
  const dayByUser = new Map(days.map((d) => [d.userId, d]));

  const rows = employees.map((e) => {
    const day = dayByUser.get(e.id);
    const expected = day?.expectedSlots || e.department?.requiredSlotsPerDay || 0;
    const filled = day?.filledSlots ?? 0;

    return {
      userId: e.id,
      fullName: fullName(e),
      employeeCode: e.employeeCode,
      avatarPath: e.avatarPath,
      designation: e.designation,
      department: e.department,
      team: e.team,
      filledSlots: filled,
      expectedSlots: expected,
      missingSlots: Math.max(expected - filled, 0),
      dayStatus: day?.status ?? DAY_STATUS.DRAFT,
      complianceRate: pct(filled, expected),
      hasLogged: filled > 0,
    };
  });

  const compliant = rows.filter((r) => r.missingSlots === 0).length;
  const partial = rows.filter((r) => r.hasLogged && r.missingSlots > 0).length;
  const missing = rows.filter((r) => !r.hasLogged).length;

  return {
    date: formatWorkDate(workDate),
    employees: rows.sort((a, b) => a.complianceRate - b.complianceRate), // worst first — that is who needs chasing
    summary: {
      total: rows.length,
      compliant,
      partial,
      missing,
      complianceRate: pct(compliant, rows.length),
    },
  };
};

const emptyCompliance = () => ({ total: 0, compliant: 0, partial: 0, missing: 0, complianceRate: 0 });

/**
 * THE CEO OVERVIEW — the first screen anyone opens, and the only one most people
 * will read.
 *
 * It answers exactly two questions and nothing else:
 *
 *   1. "Is each department keeping up?"        →  27 / 30
 *   2. "Who do I need to chase?"               →  a list of names
 *
 * ── HOW 27/30 IS ARRIVED AT, AND WHY IT IS NOT OBVIOUS ──────────────────────
 * The denominator is `employees × HOURS THAT HAVE ACTUALLY FINISHED`.
 *
 * At 13:15, with a working day starting at 10:00, exactly three hour-windows have
 * CLOSED (10–11, 11–12, 12–13). The 13:00–14:00 hour is still being worked. So for
 * 10 employees the honest expectation is 3 × 10 = 30 updates — not 7 × 10 = 70,
 * which is what you get if you naively use the department's full-day requirement.
 *
 * That distinction is the whole difference between a number a CEO can trust and a
 * number that reads "12/70 — the company is failing" at 11am every single morning.
 * A metric that is red every morning by construction is a metric everyone learns
 * to ignore by lunchtime, and then the day it means something, nobody looks.
 *
 * The in-progress hour is deliberately excluded. Nobody is behind on an hour they
 * are still living through.
 */
export const getOverview = async (scope, { date } = {}) => {
  const workDate = toWorkDate(date ?? todayWorkDate());
  const isToday = formatWorkDate(workDate) === formatWorkDate(todayWorkDate());

  const updateRequiredHours = await settings.get(SETTING_KEY.UPDATE_REQUIRED_HOURS, 3);
  const updateRequiredMinutes = updateRequiredHours * 60;

  // For a PAST date every hour has obviously closed, so "now" is the end of the
  // day. Using the live clock would make yesterday look 0/0 before 10am.
  const nowMinutes = isToday ? minutesSinceMidnight() : 24 * 60;

  const departments = await prisma.department.findMany({
    where: and(
      scope.isGlobal ? {} : { id: scope.departmentId ?? '__none__' },
      { isActive: true },
    ),
    select: {
      id: true,
      code: true,
      name: true,
      colorHex: true,
      workingWeekdays: true,
      timeSlots: {
        // Breaks are not work. Overtime is not required. Neither belongs in the
        // denominator of "are they keeping up".
        where: { isActive: true, isBreak: false, isOvertime: false },
        select: { id: true, label: true, endMinute: true },
        orderBy: { sortOrder: 'asc' },
      },
      users: {
        where: { status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TECH_LEAD'] } },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, avatarPath: true },
        orderBy: { firstName: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });

  const weekday = isoWeekdayOf(workDate);

  const holidays = await prisma.holiday.findMany({
    where: { date: workDate },
    select: { departmentId: true, name: true },
  });
  const holidayFor = (departmentId) =>
    holidays.find((h) => h.departmentId === departmentId || h.departmentId === null);

  const allUserIds = departments.flatMap((d) => d.users.map((u) => u.id));

  const entries = allUserIds.length
    ? await prisma.taskEntry.findMany({
        where: { userId: { in: allUserIds }, workDate },
        select: { userId: true, timeSlotId: true },
      })
    : [];

  /** userId → Set(slotId) */
  const filled = new Map();
  for (const e of entries) {
    if (!filled.has(e.userId)) filled.set(e.userId, new Set());
    filled.get(e.userId).add(e.timeSlotId);
  }

  const cards = [];
  const updateRequired = [];

  for (const dept of departments) {
    const holiday = holidayFor(dept.id);
    const workingWeekdays = dept.workingWeekdays ?? [1, 2, 3, 4, 5];
    const isWorkingDay = workingWeekdays.includes(weekday) && !holiday;

    // Hours whose window has CLOSED. Not "hours in the day" — hours that are over.
    const closedSlots = isWorkingDay
      ? dept.timeSlots.filter((s) => nowMinutes >= s.endMinute)
      : [];

    // Hours closed long enough ago that silence is now a problem.
    const overdueSlots = isWorkingDay
      ? dept.timeSlots.filter((s) => nowMinutes > s.endMinute + updateRequiredMinutes)
      : [];

    const employees = dept.users;
    const expected = closedSlots.length * employees.length;

    let updated = 0;
    const behind = [];

    for (const user of employees) {
      const theirs = filled.get(user.id) ?? new Set();

      updated += closedSlots.filter((s) => theirs.has(s.id)).length;

      const pending = overdueSlots.filter((s) => !theirs.has(s.id));
      if (pending.length > 0) {
        behind.push({
          userId: user.id,
          fullName: fullName(user),
          employeeCode: user.employeeCode,
          avatarPath: user.avatarPath,
          /** How many hourly updates this person owes. */
          pendingUpdates: pending.length,
          hours: pending.map((s) => s.label),
        });
      }
    }

    cards.push({
      departmentId: dept.id,
      code: dept.code,
      name: dept.name,
      colorHex: dept.colorHex,
      employees: employees.length,
      /** Hour-windows that have finished so far today. The "3" in 3 × 10. */
      hoursElapsed: closedSlots.length,
      /** Total hour-windows in this department's full day. */
      hoursInDay: dept.timeSlots.length,
      /** The numerator: updates actually made for closed hours. */
      updated,
      /** The denominator: employees × closed hours. */
      expected,
      rate: pct(updated, expected),
      missing: Math.max(expected - updated, 0),
      employeesBehind: behind.length,
      isWorkingDay,
      holiday: holiday?.name ?? null,
      /**
       * NOT_STARTED is distinct from AT_RISK. Before the first hour closes there
       * is genuinely nothing to report, and painting the card red at 10:15 —
       * when nobody could possibly have logged anything yet — is how a dashboard
       * teaches people to stop trusting it.
       */
      status: !isWorkingDay
        ? 'NON_WORKING'
        : expected === 0
          ? 'NOT_STARTED'
          : pct(updated, expected) >= 90
            ? 'ON_TRACK'
            : pct(updated, expected) >= 70
              ? 'SLIPPING'
              : 'AT_RISK',
    });

    if (behind.length) {
      updateRequired.push({
        departmentId: dept.id,
        name: dept.name,
        colorHex: dept.colorHex,
        employees: behind.sort((a, b) => b.pendingUpdates - a.pendingUpdates),
        totalPending: behind.reduce((s, e) => s + e.pendingUpdates, 0),
      });
    }
  }

  const totalExpected = cards.reduce((s, c) => s + c.expected, 0);
  const totalUpdated = cards.reduce((s, c) => s + c.updated, 0);

  return {
    date: formatWorkDate(workDate),
    isToday,
    updateRequiredHours,
    departments: cards,
    /** Worst first — the department that needs attention is not at the bottom. */
    updateRequired: updateRequired.sort((a, b) => b.totalPending - a.totalPending),
    totals: {
      departments: cards.length,
      employees: cards.reduce((s, c) => s + c.employees, 0),
      updated: totalUpdated,
      expected: totalExpected,
      rate: pct(totalUpdated, totalExpected),
      employeesBehind: updateRequired.reduce((s, d) => s + d.employees.length, 0),
      updatesOwed: updateRequired.reduce((s, d) => s + d.totalPending, 0),
    },
  };
};

/**
 * TEAM FOLLOW-UP — "which teams are actually filling their tasks, on time?"
 *
 * This is the question Management opens the dashboard to answer, and it is
 * genuinely different from the productivity leaderboard:
 *
 *   - Productivity asks "how much work got done" (from the nightly rollup).
 *   - Follow-up asks "is the PROCESS being followed, right now" (live).
 *
 * A team can be highly productive and still be a follow-up problem, because they
 * write the whole day up at 6pm. That team's data is a day late, their lead is
 * flying blind, and no rollup will ever tell you.
 *
 * THE THREE NUMBERS PER TEAM, and why each one is separate:
 *   filled     — did they log the hour at all?
 *   onTime     — did they log it WITHIN the grace period?
 *   overdue    — hours now past the grace period with nothing in them
 *
 * `onTimeRate` is the headline. A team at 100% filled and 30% on-time is not
 * complying with the process — they are back-filling, and reporting them as green
 * would be a lie that hides exactly the behaviour this system exists to surface.
 */
export const getTeamFollowUp = async (scope, { date, departmentId } = {}) => {
  const workDate = toWorkDate(date ?? todayWorkDate());
  const graceMinutes = await settings.get(SETTING_KEY.REMINDER_GRACE_MINUTES, DEFAULT_GRACE_MINUTES);
  const nowMinutes = minutesSinceMidnight();

  const teams = await prisma.team.findMany({
    where: and(
      scopedWhereWithFilters(scope, { departmentId }, { selfSeesDepartment: true }),
      { isActive: true },
    ),
    select: {
      id: true,
      name: true,
      department: {
        select: {
          id: true,
          name: true,
          colorHex: true,
          timeSlots: {
            where: { isActive: true, isBreak: false, isOvertime: false },
            select: { id: true, label: true, endMinute: true },
          },
        },
      },
      lead: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
      members: {
        where: { status: 'ACTIVE' },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, avatarPath: true },
      },
    },
    orderBy: { name: 'asc' },
  });

  if (!teams.length) return { date: formatWorkDate(workDate), graceMinutes, teams: [], summary: null };

  const allMemberIds = teams.flatMap((t) => t.members.map((m) => m.id));
  if (!allMemberIds.length) {
    return { date: formatWorkDate(workDate), graceMinutes, teams: [], summary: null };
  }

  const entries = await prisma.taskEntry.findMany({
    where: { userId: { in: allMemberIds }, workDate },
    select: { userId: true, timeSlotId: true, isLate: true },
  });

  /** userId → { filled: Set<slotId>, late: Set<slotId> } */
  const byUser = new Map();
  for (const e of entries) {
    if (!byUser.has(e.userId)) byUser.set(e.userId, { filled: new Set(), late: new Set() });
    byUser.get(e.userId).filled.add(e.timeSlotId);
    if (e.isLate) byUser.get(e.userId).late.add(e.timeSlotId);
  }

  const rows = teams.map((team) => {
    const slots = team.department?.timeSlots ?? [];
    // Only hours that are actually DUE. Judging a team at 10:30 on hours they are
    // not expected to have filled until 18:00 would report everyone as failing.
    const dueSlots = slots.filter((s) => nowMinutes > s.endMinute + graceMinutes);

    const expected = dueSlots.length * team.members.length;

    let filled = 0;
    let onTime = 0;
    const behind = [];

    for (const member of team.members) {
      const state = byUser.get(member.id) ?? { filled: new Set(), late: new Set() };
      const memberFilled = dueSlots.filter((s) => state.filled.has(s.id));
      const memberOnTime = memberFilled.filter((s) => !state.late.has(s.id));

      filled += memberFilled.length;
      onTime += memberOnTime.length;

      const missing = dueSlots.length - memberFilled.length;
      if (missing > 0) {
        behind.push({
          userId: member.id,
          fullName: fullName(member),
          employeeCode: member.employeeCode,
          avatarPath: member.avatarPath,
          overdueHours: missing,
        });
      }
    }

    return {
      teamId: team.id,
      name: team.name,
      department: team.department
        ? { id: team.department.id, name: team.department.name, colorHex: team.department.colorHex }
        : null,
      lead: team.lead
        ? {
            id: team.lead.id,
            fullName: fullName(team.lead),
            avatarPath: team.lead.avatarPath,
          }
        : null,
      memberCount: team.members.length,
      dueHours: dueSlots.length,
      expectedEntries: expected,
      filledEntries: filled,
      onTimeEntries: onTime,
      overdueEntries: Math.max(expected - filled, 0),
      fillRate: pct(filled, expected),
      /** The headline. Back-filling at 6pm is NOT compliance. */
      onTimeRate: pct(onTime, expected),
      /** Who in this team the lead needs to chase, worst first. */
      membersBehind: behind.sort((a, b) => b.overdueHours - a.overdueHours),
      status: expected === 0 ? 'NOT_DUE' : pct(onTime, expected) >= 85 ? 'ON_TRACK' : pct(filled, expected) >= 85 ? 'BACKFILLING' : 'AT_RISK',
    };
  });

  const scored = rows.filter((r) => r.expectedEntries > 0);
  const totalExpected = scored.reduce((s, r) => s + r.expectedEntries, 0);
  const totalOnTime = scored.reduce((s, r) => s + r.onTimeEntries, 0);
  const totalFilled = scored.reduce((s, r) => s + r.filledEntries, 0);

  return {
    date: formatWorkDate(workDate),
    graceMinutes,
    // Worst first. The team that needs attention should not be at the bottom of
    // a list nobody scrolls.
    teams: rows.sort((a, b) => a.onTimeRate - b.onTimeRate),
    summary: {
      totalTeams: rows.length,
      onTrack: rows.filter((r) => r.status === 'ON_TRACK').length,
      /** Filling in, but late — the failure mode a fill-rate metric alone hides. */
      backfilling: rows.filter((r) => r.status === 'BACKFILLING').length,
      atRisk: rows.filter((r) => r.status === 'AT_RISK').length,
      companyOnTimeRate: pct(totalOnTime, totalExpected),
      companyFillRate: pct(totalFilled, totalExpected),
      employeesBehind: rows.reduce((s, r) => s + r.membersBehind.length, 0),
    },
  };
};

/**
 * DELIVERY — the assignment axis, the counterpart to the compliance/effort views.
 *
 * The other dashboards answer "did people LOG their hours" and "how MANY hours".
 * This one answers "is the ASSIGNED work getting done", and it holds itself to
 * three questions on purpose, so it stays a glance and not a spreadsheet:
 *
 *   1. Is assigned work on track?  → five counts (open · due soon · overdue ·
 *      awaiting review · done this week).
 *   2. What is at risk?            → overdue open assignments, most overdue first.
 *   3. What needs review?          → submitted assignments waiting on a lead,
 *      which the frontend folds into the existing Approvals surface.
 *
 * Scope is free: assignments carry departmentId and an employee owns theirs via
 * assigneeId, so the same engine that guards every other view guards this one. An
 * employee sees their own plate; a lead their department's; management all of it.
 * Read live — assignments are few next to hourly entries, and the whole value
 * here is "right now".
 */
export const getDeliveryOverview = async (scope, { departmentId, teamId } = {}) => {
  const base = scopedWhereWithFilters(scope, { departmentId, teamId }, { userField: 'assigneeId' });
  const today = toWorkDate(todayWorkDate());
  const dueSoonBy = dayjs.utc(today).add(2, 'day').toDate(); // due within ~48h
  const doneSince = dayjs.utc(today).subtract(6, 'day').toDate(); // "this week" = trailing 7 days

  const openStatuses = { status: { in: ASSIGNMENT_OPEN_STATUSES } };

  const [open, dueSoon, overdue, awaitingReview, doneThisWeek] = await prisma.$transaction([
    prisma.assignment.count({ where: and(base, openStatuses) }),
    prisma.assignment.count({ where: and(base, openStatuses, { dueDate: { gte: today, lte: dueSoonBy } }) }),
    prisma.assignment.count({ where: and(base, openStatuses, { dueDate: { lt: today } }) }),
    prisma.assignment.count({ where: and(base, { status: ASSIGNMENT_STATUS.SUBMITTED }) }),
    prisma.assignment.count({ where: and(base, { status: ASSIGNMENT_STATUS.DONE, completedAt: { gte: doneSince } }) }),
  ]);

  const listSelect = {
    id: true,
    title: true,
    status: true,
    priority: true,
    dueDate: true,
    assigneeName: true,
    assignee: { select: { id: true, firstName: true, lastName: true, avatarPath: true } },
    department: { select: { id: true, name: true, colorHex: true } },
  };

  const shape = (a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    priority: a.priority,
    dueDate: a.dueDate ? formatWorkDate(a.dueDate) : null,
    daysOverdue: a.dueDate ? Math.max(0, dayjs.utc(today).diff(dayjs.utc(a.dueDate), 'day')) : 0,
    assignee: a.assignee
      ? { id: a.assignee.id, fullName: fullName(a.assignee), avatarPath: a.assignee.avatarPath }
      : { id: null, fullName: a.assigneeName ?? 'Former employee', avatarPath: null },
    department: a.department ?? null,
  });

  const [atRisk, needsReview] = await Promise.all([
    prisma.assignment.findMany({
      where: and(base, openStatuses, { dueDate: { lt: today } }),
      select: listSelect,
      orderBy: [{ dueDate: 'asc' }, { priority: 'desc' }],
      take: 12,
    }),
    prisma.assignment.findMany({
      where: and(base, { status: ASSIGNMENT_STATUS.SUBMITTED }),
      select: { ...listSelect, submittedAt: true },
      orderBy: { submittedAt: 'asc' }, // longest-waiting first — that is who to review next
      take: 12,
    }),
  ]);

  return {
    date: formatWorkDate(today),
    counts: { open, dueSoon, overdue, awaitingReview, doneThisWeek },
    atRisk: atRisk.map(shape),
    needsReview: needsReview.map((a) => ({ ...shape(a), submittedAt: a.submittedAt?.toISOString() ?? null })),
  };
};

/** Default window: the trailing 30 days. Managers think in "this month". */
const resolveRange = (filters = {}, defaultDays = 30) => {
  if (filters.dateFrom && filters.dateTo) {
    return { dateFrom: toWorkDate(filters.dateFrom), dateTo: toWorkDate(filters.dateTo) };
  }
  if (filters.year && filters.month) {
    const anchor = dayjs.utc(`${filters.year}-${String(filters.month).padStart(2, '0')}-01`);
    return {
      dateFrom: anchor.startOf('month').toDate(),
      dateTo: anchor.endOf('month').startOf('day').toDate(),
    };
  }
  const to = toWorkDate(todayWorkDate());
  return { dateFrom: dayjs.utc(to).subtract(defaultDays - 1, 'day').toDate(), dateTo: to };
};
