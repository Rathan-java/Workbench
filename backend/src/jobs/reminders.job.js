/**
 * Reminder and digest jobs.
 *
 * THE HOLIDAY BUG THIS AVOIDS
 * A reminder job that just checks "did this employee log the 10am slot?" will,
 * on a public holiday, email three hundred people to tell them they are behind
 * on work they were never expected to do — and every compliance chart will show
 * a company-wide 0%. So: before doing anything, each job asks whether today is a
 * working day FOR THAT DEPARTMENT (its own `workingWeekdays`) and whether it is a
 * holiday. Video Editing may work Saturdays; Tech may not.
 *
 * THE N+1 BUG THIS AVOIDS
 * The obvious loop — for each employee, query their day — is 300 queries. These
 * jobs load all employees, all days and all slots for a department in three
 * queries and join in memory.
 */
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { withLock } from './lock.js';
import { notifyMany } from '../modules/notifications/notification.service.js';
import { fullName } from '../utils/name.js';
import * as settings from '../modules/settings/setting.service.js';
import { sendMailSafe } from '../config/mailer.js';
import {
  missedUpdateEmail,
  leadDigestEmail,
  managementSummaryEmail,
} from '../modules/notifications/email.templates.js';
import { SETTING_KEY, DAY_STATUS, DEFAULT_GRACE_MINUTES } from '../config/constants.js';
import {
  todayWorkDate,
  formatWorkDate,
  minutesSinceMidnight,
  isoWeekdayToday,
} from '../utils/date.js';

/** Is today a working day for this department, and not a holiday? */
const isWorkingDay = async (department, workDate) => {
  const weekdays = department.workingWeekdays ?? [1, 2, 3, 4, 5];
  if (!weekdays.includes(isoWeekdayToday())) return false;

  const holiday = await prisma.holiday.findFirst({
    where: {
      date: workDate,
      OR: [{ departmentId: department.id }, { departmentId: null }],
    },
    select: { id: true, name: true },
  });

  if (holiday) {
    logger.info('Skipping reminders — holiday', {
      department: department.code,
      holiday: holiday.name,
    });
    return false;
  }

  return true;
};

// ---------------------------------------------------------------------------
// Hourly reminder to employees
// ---------------------------------------------------------------------------

/**
 * THE OVERDUE CHECK. Runs every hour.
 *
 * An hour is OVERDUE once it has been over for longer than the grace period
 * (2 hours by default, configurable in Settings). At that point three people
 * hear about it, and that three-way escalation is the point of the job:
 *
 *   1. THE EMPLOYEE     — "you have 2 hours unlogged"
 *   2. THEIR TECH LEAD  — one rolled-up alert naming everyone in their department
 *                          who is behind. Not one alert per person.
 *   3. MANAGEMENT       — one rolled-up alert across the whole company.
 *
 * ── WHY THE DEDUPE KEY MATTERS MORE THAN ANYTHING ELSE HERE ─────────────────
 * This job runs hourly. Without de-duplication, an employee who misses the 10:00
 * slot is told about it at 13:00, 14:00, 15:00, 16:00, 17:00 — and their Tech
 * Lead is told five times about the same person on the same day. Within a week
 * everybody has muted the notifications, and the ONE alert that actually mattered
 * goes unread along with the noise.
 *
 * So every notification carries a `dedupeKey` with a UNIQUE constraint on it.
 * The second insert for the same fact is rejected by the DATABASE, which means it
 * holds even when two App Service instances run the check in the same second.
 * An application-level "have I sent this?" check would race itself.
 */
export const runHourlyReminders = () =>
  withLock('hourly-reminders', 10 * 60, async () => {
    const enabled = await settings.get(SETTING_KEY.REMINDERS_ENABLED, true);
    if (!enabled) return 'Reminders are disabled in settings';

    const [graceMinutes, escalateToLead, escalateToManagement] = await Promise.all([
      settings.get(SETTING_KEY.REMINDER_GRACE_MINUTES, DEFAULT_GRACE_MINUTES),
      settings.get(SETTING_KEY.ESCALATE_TO_LEAD, true),
      settings.get(SETTING_KEY.ESCALATE_TO_MANAGEMENT, true),
    ]);

    const workDate = todayWorkDate();
    const dateKey = formatWorkDate(workDate);
    const nowMinutes = minutesSinceMidnight();

    const departments = await prisma.department.findMany({
      where: { isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        workingWeekdays: true,
        timeSlots: {
          // Overtime columns are never chased. Nobody is "late" for not working late.
          where: { isActive: true, isBreak: false, isOvertime: false },
          select: { id: true, label: true, startMinute: true, endMinute: true },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    let employeesNotified = 0;
    let leadsAlerted = 0;
    /** Company-wide roll-up for Management. */
    const companyOffenders = [];

    for (const department of departments) {
      if (!(await isWorkingDay(department, workDate))) continue;

      // Only hours that are genuinely over, PLUS the grace period. Nagging
      // somebody about the hour they are currently working is how you teach them
      // to ignore you.
      const overdueSlots = department.timeSlots.filter(
        (s) => nowMinutes > s.endMinute + graceMinutes,
      );
      if (!overdueSlots.length) continue;

      const overdueSlotIds = overdueSlots.map((s) => s.id);

      const [employees, entries] = await Promise.all([
        prisma.user.findMany({
          where: {
            departmentId: department.id,
            status: 'ACTIVE',
            role: { in: ['EMPLOYEE', 'TECH_LEAD'] },
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            employeeCode: true,
            teamId: true,
          },
        }),
        prisma.taskEntry.findMany({
          where: { departmentId: department.id, workDate, timeSlotId: { in: overdueSlotIds } },
          select: { userId: true, timeSlotId: true },
        }),
      ]);

      const filledByUser = new Map();
      for (const e of entries) {
        if (!filledByUser.has(e.userId)) filledByUser.set(e.userId, new Set());
        filledByUser.get(e.userId).add(e.timeSlotId);
      }

      const offenders = [];
      const employeeAlerts = [];

      for (const employee of employees) {
        const filled = filledByUser.get(employee.id) ?? new Set();
        const missing = overdueSlots.filter((s) => !filled.has(s.id));
        if (!missing.length) continue;

        offenders.push({
          userId: employee.id,
          name: fullName(employee),
          employeeCode: employee.employeeCode,
          missing: missing.length,
          slots: missing.map((s) => s.label),
          department: department.name,
        });

        // ── 1. THE EMPLOYEE ────────────────────────────────────────────────
        // Keyed on the WORST overdue slot, so a new alert only fires when the
        // situation actually gets worse — not every hour it stays the same.
        const worstSlot = missing.at(-1).id;

        employeeAlerts.push({
          userId: employee.id,
          to: employee.email,
          dedupeKey: `overdue:emp:${dateKey}:${employee.id}:${worstSlot}`,
          type: 'MISSED_HOURLY_UPDATE',
          level: missing.length >= 3 ? 'CRITICAL' : 'WARNING',
          title: `${missing.length} hour${missing.length === 1 ? '' : 's'} overdue`,
          body: `You have not logged: ${missing.map((s) => s.label).join(', ')}. These are more than ${Math.round(graceMinutes / 60)} hour(s) past due.`,
          link: `/tasks?date=${dateKey}`,
          entityType: 'TaskDay',
          // One missing hour gets an in-app nudge. Three or more is a real
          // backlog and earns an email.
          email:
            missing.length >= 3
              ? missedUpdateEmail({
                  firstName: employee.firstName,
                  slotLabels: missing.map((s) => s.label),
                  workDate: dateKey,
                })
              : undefined,
        });
      }

      if (employeeAlerts.length) {
        employeesNotified += await notifyMany(employeeAlerts);
      }

      if (!offenders.length) continue;

      companyOffenders.push(...offenders);

      // ── 2. THE TECH LEAD ─────────────────────────────────────────────────
      // ONE alert naming everyone who is behind — not one per person. A lead with
      // eight people behind should get one message, not eight.
      if (escalateToLead) {
        const leads = await prisma.user.findMany({
          where: { departmentId: department.id, role: 'TECH_LEAD', status: 'ACTIVE' },
          select: { id: true, email: true, firstName: true },
        });

        const total = employees.length;
        const compliant = total - offenders.length;
        const rate = total ? Math.round((compliant / total) * 100) : 0;
        const worstSlot = overdueSlots.at(-1).id;

        const alerts = leads.map((lead) => ({
          userId: lead.id,
          to: lead.email,
          // Keyed on the department + the worst overdue slot, so the lead is
          // alerted once per escalation, not once per hour of the same problem.
          dedupeKey: `overdue:lead:${dateKey}:${lead.id}:${worstSlot}`,
          type: 'TEAM_COMPLIANCE_ALERT',
          level: rate < 60 ? 'CRITICAL' : 'WARNING',
          title: `${offenders.length} employee(s) are overdue`,
          body: `${offenders
            .slice(0, 5)
            .map((o) => o.name)
            .join(', ')}${offenders.length > 5 ? ` and ${offenders.length - 5} more` : ''} ${offenders.length === 1 ? 'has' : 'have'} unlogged hours more than ${Math.round(graceMinutes / 60)} hour(s) past due. ${department.name} is at ${rate}%.`,
          link: `/monitor?date=${dateKey}&departmentId=${department.id}`,
          entityType: 'Department',
          entityId: department.id,
          email: leadDigestEmail({
            leadName: lead.firstName,
            departmentName: department.name,
            workDate: dateKey,
            offenders: offenders.map((o) => ({
              name: o.name,
              employeeCode: o.employeeCode,
              missing: o.missing,
            })),
            compliance: { total, compliant, offenders: offenders.length, rate },
          }),
        }));

        leadsAlerted += await notifyMany(alerts);
      }
    }

    // ── 3. MANAGEMENT ──────────────────────────────────────────────────────
    // One company-wide roll-up. Management does not want a message per employee;
    // they want the number and a link.
    if (escalateToManagement && companyOffenders.length) {
      const managers = await prisma.user.findMany({
        where: { role: 'MANAGEMENT', status: 'ACTIVE' },
        select: { id: true, email: true },
      });

      const byDepartment = new Map();
      for (const o of companyOffenders) {
        byDepartment.set(o.department, (byDepartment.get(o.department) ?? 0) + 1);
      }

      const breakdown = [...byDepartment.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, count]) => `${name}: ${count}`)
        .join(' · ');

      // Bucketed to the hour, so Management gets at most one of these per hour —
      // and only when the situation has actually changed.
      const hourBucket = Math.floor(nowMinutes / 60);

      await notifyMany(
        managers.map((m) => ({
          userId: m.id,
          to: m.email,
          dedupeKey: `overdue:mgmt:${dateKey}:${m.id}:${hourBucket}:${companyOffenders.length}`,
          type: 'TEAM_COMPLIANCE_ALERT',
          level: companyOffenders.length >= 10 ? 'CRITICAL' : 'WARNING',
          title: `${companyOffenders.length} employee(s) overdue company-wide`,
          body: `${breakdown}. Each has hours unlogged more than ${Math.round(graceMinutes / 60)} hour(s) past due.`,
          link: `/dashboard?date=${dateKey}`,
        })),
      );
    }

    return `Notified ${employeesNotified} employee(s), alerted ${leadsAlerted} lead(s), ${companyOffenders.length} overdue company-wide`;
  });

// ---------------------------------------------------------------------------
// Tech Lead digest
// ---------------------------------------------------------------------------

/**
 * Twice a day, each Tech Lead gets one email listing exactly who in their
 * DEPARTMENT is behind. One email with a list beats N emails with one name.
 */
export const runLeadDigest = () =>
  withLock('lead-digest', 10 * 60, async () => {
    const enabled = await settings.get(SETTING_KEY.LEAD_DIGEST_ENABLED, true);
    if (!enabled) return 'Lead digest is disabled in settings';

    const workDate = todayWorkDate();

    const leads = await prisma.user.findMany({
      where: { role: 'TECH_LEAD', status: 'ACTIVE', departmentId: { not: null } },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        departmentId: true,
        department: {
          select: { id: true, code: true, name: true, workingWeekdays: true, requiredSlotsPerDay: true },
        },
      },
    });

    let sent = 0;

    for (const lead of leads) {
      if (!(await isWorkingDay(lead.department, workDate))) continue;

      const employees = await prisma.user.findMany({
        where: {
          departmentId: lead.departmentId,
          status: 'ACTIVE',
          role: { in: ['EMPLOYEE', 'TECH_LEAD'] },
          id: { not: lead.id }, // a lead is not on their own chase list
        },
        select: { id: true, firstName: true, lastName: true, employeeCode: true },
      });

      if (!employees.length) continue;

      const days = await prisma.taskDay.findMany({
        where: { userId: { in: employees.map((e) => e.id) }, workDate },
        select: { userId: true, filledSlots: true, expectedSlots: true },
      });
      const dayByUser = new Map(days.map((d) => [d.userId, d]));

      const required = lead.department.requiredSlotsPerDay;

      const offenders = employees
        .map((e) => {
          const day = dayByUser.get(e.id);
          const filled = day?.filledSlots ?? 0;
          const expected = day?.expectedSlots || required;
          return {
            name: fullName(e),
            employeeCode: e.employeeCode,
            missing: Math.max(expected - filled, 0),
          };
        })
        .filter((e) => e.missing > 0)
        .sort((a, b) => b.missing - a.missing);

      const compliant = employees.length - offenders.length;
      const compliance = {
        total: employees.length,
        compliant,
        offenders: offenders.length,
        rate: employees.length ? Math.round((compliant / employees.length) * 100) : 0,
      };

      // Silence is a feature: if the whole department is up to date, do not send
      // a "nothing to do" email. A digest that arrives every day regardless is a
      // digest nobody opens.
      if (!offenders.length) {
        logger.info('Lead digest skipped — department fully compliant', {
          department: lead.department.code,
        });
        continue;
      }

      await notifyMany([
        {
          userId: lead.id,
          to: lead.email,
          type: 'TEAM_COMPLIANCE_ALERT',
          level: compliance.rate < 60 ? 'CRITICAL' : 'WARNING',
          title: `${offenders.length} employee(s) have not logged their hours`,
          body: `${lead.department.name} is at ${compliance.rate}% compliance for ${formatWorkDate(workDate)}.`,
          link: `/monitor?date=${formatWorkDate(workDate)}&departmentId=${lead.departmentId}`,
          email: leadDigestEmail({
            leadName: lead.firstName,
            departmentName: lead.department.name,
            workDate: formatWorkDate(workDate),
            offenders,
            compliance,
          }),
        },
      ]);

      sent += 1;
    }

    return `Sent ${sent} lead digest(s)`;
  });

// ---------------------------------------------------------------------------
// Management daily summary
// ---------------------------------------------------------------------------

export const runManagementSummary = () =>
  withLock('management-summary', 10 * 60, async () => {
    const enabled = await settings.get(SETTING_KEY.MANAGEMENT_SUMMARY_ENABLED, true);
    if (!enabled) return 'Management summary is disabled in settings';

    const workDate = todayWorkDate();

    const managers = await prisma.user.findMany({
      where: { role: 'MANAGEMENT', status: 'ACTIVE' },
      select: { id: true, email: true, firstName: true },
    });
    if (!managers.length) return 'No active Management accounts';

    const departments = await prisma.department.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        requiredSlotsPerDay: true,
        _count: {
          select: { users: { where: { status: 'ACTIVE', role: { in: ['EMPLOYEE', 'TECH_LEAD'] } } } },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const [entriesByDept, projectRows, daysByDept, lateCount] = await Promise.all([
      prisma.taskEntry.groupBy({
        by: ['departmentId'],
        where: { workDate },
        _count: { _all: true },
      }),
      // Replaces the old status GROUP BY. "27 hours logged, 8 of them COMPLETED"
      // was never a sentence that meant anything; "27 hours across 6 projects" is.
      prisma.taskEntry.groupBy({
        by: ['departmentId', 'projectId'],
        where: { workDate },
        _count: { _all: true },
      }),
      prisma.taskDay.groupBy({
        by: ['departmentId'],
        where: { workDate },
        _sum: { filledSlots: true, expectedSlots: true },
        _count: { _all: true },
      }),
      prisma.taskEntry.count({ where: { workDate, isLate: true } }),
    ]);

    const entryCountByDept = new Map(entriesByDept.map((r) => [r.departmentId, r._count._all]));
    const dayStatsByDept = new Map(daysByDept.map((r) => [r.departmentId, r]));

    // One row per (department, project) pair, so counting rows per department
    // gives the number of distinct projects that moved there today.
    const projectsByDept = new Map();
    for (const row of projectRows) {
      projectsByDept.set(row.departmentId, (projectsByDept.get(row.departmentId) ?? 0) + 1);
    }

    const departmentRows = departments.map((d) => {
      const stats = dayStatsByDept.get(d.id);
      const expected = stats?._sum.expectedSlots ?? d._count.users * d.requiredSlotsPerDay;
      const filled = stats?._sum.filledSlots ?? 0;

      return {
        name: d.name,
        employees: d._count.users,
        entries: entryCountByDept.get(d.id) ?? 0,
        projects: projectsByDept.get(d.id) ?? 0,
        compliance: expected ? Math.round((filled / expected) * 100) : 0,
      };
    });

    const totalEntries = [...entryCountByDept.values()].reduce((a, b) => a + b, 0);

    const totals = {
      entries: totalEntries,
      activeEmployees: daysByDept.reduce((sum, d) => sum + d._count._all, 0),
      /** Distinct projects that saw any work today, company-wide. */
      projects: new Set(projectRows.map((r) => r.projectId)).size,
      lateUpdates: lateCount,
      complianceRate: departmentRows.length
        ? Math.round(
            departmentRows.reduce((sum, d) => sum + d.compliance, 0) / departmentRows.length,
          )
        : 0,
    };

    const email = managementSummaryEmail({
      workDate: formatWorkDate(workDate),
      totals,
      departments: departmentRows,
    });

    await notifyMany(
      managers.map((m) => ({
        userId: m.id,
        to: m.email,
        type: 'DAILY_SUMMARY',
        level: 'INFO',
        title: `Daily summary — ${totals.entries} entries, ${totals.complianceRate}% compliance`,
        body: `${totals.activeEmployees} employees logged work across ${departmentRows.length} departments.`,
        link: '/dashboard',
        email,
      })),
    );

    return `Summary sent to ${managers.length} manager(s)`;
  });

// ---------------------------------------------------------------------------
// Cross-check: sheets never submitted
// ---------------------------------------------------------------------------

/** Escalates yesterday's un-submitted sheets to the department's Tech Lead. */
export const runUnsubmittedCheck = () =>
  withLock('unsubmitted-check', 10 * 60, async () => {
    const required = await settings.get(SETTING_KEY.REQUIRE_DAILY_SUBMISSION, true);
    if (!required) return 'Daily submission is not required';

    const yesterday = new Date(todayWorkDate());
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);

    const stale = await prisma.taskDay.findMany({
      where: { workDate: yesterday, status: DAY_STATUS.DRAFT, filledSlots: { gt: 0 } },
      select: {
        id: true,
        userId: true,
        departmentId: true,
        filledSlots: true,
        expectedSlots: true,
        user: { select: { firstName: true, email: true } },
      },
    });

    if (!stale.length) return 'No unsubmitted sheets';

    await notifyMany(
      stale.map((d) => ({
        userId: d.userId,
        type: 'MISSED_HOURLY_UPDATE',
        level: 'WARNING',
        title: 'Yesterday’s task sheet was never submitted',
        body: `Your sheet for ${formatWorkDate(yesterday)} (${d.filledSlots}/${d.expectedSlots} hours) is still in draft. Submit it for approval.`,
        link: `/tasks?date=${formatWorkDate(yesterday)}`,
        entityType: 'TaskDay',
        entityId: d.id,
      })),
    );

    return `Nudged ${stale.length} unsubmitted sheet(s)`;
  });
