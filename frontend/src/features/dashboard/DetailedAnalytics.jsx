import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import AccessTimeOutlinedIcon from '@mui/icons-material/AccessTimeOutlined';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';

import ErrorState from '../../components/common/ErrorState.jsx';
import DateRangeFilter from '../../components/common/DateRangeFilter.jsx';

import ChartCard from './components/ChartCard.jsx';
import ChartTooltip from './components/ChartTooltip.jsx';
import CompliancePanel from './components/CompliancePanel.jsx';
import EmployeeLeaderboard from './components/EmployeeLeaderboard.jsx';
import KpiCard from './components/KpiCard.jsx';
import TeamFollowUpPanel from './components/TeamFollowUpPanel.jsx';

import { dashboard, departments as departmentsApi, teams as teamsApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSIONS } from '../../utils/constants.js';
import { formatApiDate, formatDate, formatNumber, formatPercent, truncate } from '../../utils/format.js';
import {
  DEFAULT_PRESET,
  anchorDate,
  countDays,
  describeRange,
  resolveRange,
} from '../../utils/dateRange.js';

/** A dot-and-label legend — recharts' own <Legend> can't be styled from the theme cleanly. */
function SeriesLegend({ items }) {
  return (
    <Stack direction="row" spacing={1.5}>
      {items.map((item) => (
        <Stack key={item.label} direction="row" alignItems="center" spacing={0.625}>
          <Box sx={{ width: 8, height: 8, borderRadius: '2px', backgroundColor: item.color }} />
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

/** How many projects the "Top projects" panel ranks. Six rows fit without scrolling. */
const TOP_PROJECTS = 6;

/** "0 → active today" reads as a fact; "0 days ago" reads as a rounding error. */
const describeActivity = (days) => {
  if (days === null || days === undefined) return 'no activity yet';
  if (days <= 0) return 'active today';
  return `${formatNumber(days)} day${days === 1 ? '' : 's'} ago`;
};

/**
 * Where the hours went.
 *
 * This panel replaced the status donut. An entry is an hour already worked, so
 * it has no work-status to slice into six wedges — and the question a CEO
 * actually asks of a week of logged time is "which projects consumed it, who is
 * on them, and which one has gone quiet". A ranked bar list answers all three in
 * one read; a donut answered none of them.
 *
 * A project that has not been touched in days is tinted AMBER, not red: going
 * quiet is a thing to look at, not a failure. Red stays reserved for destruction.
 */
function TopProjectsList({ rows }) {
  const theme = useTheme();

  // Bars are relative to the busiest project in the list, not to the total: with
  // twenty projects in scope every bar would otherwise be a sliver.
  const busiest = Math.max(...rows.map((row) => row.hoursLogged ?? 0), 1);

  return (
    <Stack spacing={1.75} sx={{ pt: 0.5 }}>
      {rows.map((project) => {
        const hours = project.hoursLogged ?? 0;
        const days = project.daysSinceActivity;
        const quiet = typeof days === 'number' && days > 0;
        const contributors = project.contributorCount ?? 0;

        return (
          <Box key={project.projectId ?? project.code}>
            <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 0.625 }}>
              <Typography
                variant="caption"
                sx={{ fontWeight: 700, letterSpacing: '0.04em', color: 'text.secondary', flexShrink: 0 }}
              >
                {project.code}
              </Typography>
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {project.name}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
                {formatNumber(hours)}h
              </Typography>
            </Stack>

            <Box
              sx={{
                height: 6,
                borderRadius: 3,
                backgroundColor: alpha(theme.palette.primary.main, 0.1),
                overflow: 'hidden',
              }}
            >
              <Box
                sx={{
                  width: `${Math.max((hours / busiest) * 100, 2)}%`,
                  height: '100%',
                  borderRadius: 3,
                  backgroundColor: theme.palette.primary.main,
                }}
              />
            </Box>

            <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {formatNumber(contributors)} {contributors === 1 ? 'contributor' : 'contributors'}
              </Typography>
              <Typography
                variant="caption"
                sx={{ fontWeight: 500, color: quiet ? 'warning.main' : 'text.secondary' }}
              >
                {describeActivity(days)}
              </Typography>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}

/**
 * The detailed analytics — every chart, KPI, leaderboard and follow-up panel the
 * dashboard used to lead with.
 *
 * They are all still here, and none of them were wrong. They were just the wrong
 * thing to show FIRST. A CEO opening the dashboard needs "is each department
 * keeping up, and who do I chase" — not a 30-day compliance trend. So this now
 * lives behind a "Detailed analytics" toggle: one click away for whoever wants it,
 * and out of the way of whoever does not.
 */
export default function DetailedAnalytics() {
  const theme = useTheme();
  const mode = theme.palette.mode;
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const canTeam = can(PERMISSIONS.DASHBOARD_TEAM);
  const canGlobal = can(PERMISSIONS.DASHBOARD_GLOBAL);

  /* ---------------------------------------------------------------- *
   * Filter state lives in the URL — a filtered dashboard is a thing a
   * manager pastes into Slack, and that link has to reproduce the view.
   * ---------------------------------------------------------------- */
  const [searchParams, setSearchParams] = useSearchParams();

  const preset = searchParams.get('preset') ?? DEFAULT_PRESET;
  const dateFromParam = searchParams.get('dateFrom') ?? '';
  const dateToParam = searchParams.get('dateTo') ?? '';
  const departmentId = searchParams.get('departmentId') ?? '';
  const teamId = searchParams.get('teamId') ?? '';

  const range = useMemo(
    () => resolveRange({ preset, dateFrom: dateFromParam, dateTo: dateToParam }),
    [preset, dateFromParam, dateToParam],
  );

  const updateParams = useCallback(
    (patch) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          Object.entries(patch).forEach(([key, value]) => {
            if (value === undefined || value === null || value === '') next.delete(key);
            else next.set(key, String(value));
          });
          return next;
        },
        // Replace, not push: tweaking a filter six times should not mean six
        // taps of the back button to leave the page.
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const handleRangeChange = (next) => {
    updateParams({
      preset: next.preset,
      // Presets stay relative in the URL; only a custom window pins its dates.
      dateFrom: next.preset === 'custom' ? next.dateFrom : undefined,
      dateTo: next.preset === 'custom' ? next.dateTo : undefined,
    });
  };

  // A team belongs to a department: changing the department can only invalidate
  // the team selection, so drop it rather than send an impossible pair.
  const handleDepartmentChange = (event) =>
    updateParams({ departmentId: event.target.value, teamId: undefined });

  const resetFilters = () => setSearchParams(new URLSearchParams(), { replace: true });

  const hasFilters = Boolean(departmentId || teamId) || preset !== DEFAULT_PRESET;

  /* ---------------------------------------------------------------- *
   * Queries
   *
   * summary and compliance are SNAPSHOTS — the API takes `date`, not a range —
   * so they are anchored to the last day of the selected window (clamped to
   * today). Everything else is a true range aggregate.
   * ---------------------------------------------------------------- */
  const anchor = useMemo(() => anchorDate(range), [range]);

  const scopeFilters = useMemo(
    () => ({ departmentId: departmentId || undefined, teamId: teamId || undefined }),
    [departmentId, teamId],
  );

  const rangeFilters = useMemo(
    () => ({ dateFrom: range.dateFrom, dateTo: range.dateTo, ...scopeFilters }),
    [range, scopeFilters],
  );

  const snapshotFilters = useMemo(
    () => ({ date: anchor, ...scopeFilters }),
    [anchor, scopeFilters],
  );

  const unwrap = (response) => response.data;

  const summaryQuery = useQuery({
    queryKey: ['dashboard', 'summary', snapshotFilters],
    queryFn: () => dashboard.summary(snapshotFilters),
    select: unwrap,
    staleTime: 30_000,
  });

  const trendQuery = useQuery({
    queryKey: ['dashboard', 'trend', rangeFilters],
    queryFn: () => dashboard.trend(rangeFilters),
    select: unwrap,
    staleTime: 60_000,
  });

  const projectQuery = useQuery({
    queryKey: ['dashboard', 'productivity-project', rangeFilters],
    queryFn: () => dashboard.projectProductivity(rangeFilters),
    select: unwrap,
    staleTime: 60_000,
  });

  const hourlyQuery = useQuery({
    queryKey: ['dashboard', 'hourly-activity', rangeFilters],
    queryFn: () => dashboard.hourlyActivity(rangeFilters),
    select: unwrap,
    staleTime: 60_000,
  });

  const departmentQuery = useQuery({
    queryKey: ['dashboard', 'productivity-department', rangeFilters],
    queryFn: () => dashboard.departmentProductivity(rangeFilters),
    select: unwrap,
    staleTime: 60_000,
    enabled: canGlobal,
  });

  const employeeQuery = useQuery({
    queryKey: ['dashboard', 'productivity-employee', rangeFilters],
    queryFn: () => dashboard.employeeProductivity(rangeFilters),
    select: unwrap,
    staleTime: 60_000,
  });

  const complianceQuery = useQuery({
    queryKey: ['dashboard', 'compliance', snapshotFilters],
    queryFn: () => dashboard.compliance(snapshotFilters),
    select: unwrap,
    staleTime: 30_000,
    enabled: canTeam,
  });

  /**
   * Follow-up is LIVE and team-comparative: it takes `date` and `departmentId`
   * only. Passing the page's `teamId` would leave a one-row panel whose whole
   * job is ranking teams against each other, so the team filter deliberately
   * does not reach it.
   */
  const followUpQuery = useQuery({
    queryKey: ['dashboard', 'team-follow-up', anchor, departmentId],
    queryFn: () => dashboard.teamFollowUp({ date: anchor, departmentId: departmentId || undefined }),
    select: unwrap,
    staleTime: 30_000,
    enabled: canTeam,
  });

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'list'],
    queryFn: () => departmentsApi.list(),
    select: unwrap,
    staleTime: 5 * 60_000,
    enabled: canTeam,
  });

  const teamsQuery = useQuery({
    queryKey: ['teams', 'options', departmentId],
    queryFn: () => teamsApi.options({ departmentId: departmentId || undefined }),
    select: unwrap,
    staleTime: 5 * 60_000,
    enabled: canTeam,
  });

  const isRefreshing = useIsFetching({ queryKey: ['dashboard'] }) > 0;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] });

  /* ---------------------------------------------------------------- *
   * Derived chart data
   * ---------------------------------------------------------------- */
  const summary = summaryQuery.data;
  const cards = summary?.cards;
  const rates = summary?.rates;
  const notLogged = cards?.notLoggedToday ?? 0;
  const isToday = summary?.date === formatApiDate(dayjs());

  const trendData = trendQuery.data ?? [];
  const trendEmpty = !trendData.some((point) => point.expectedSlots > 0 || point.filledSlots > 0);

  /**
   * Top six by hours. The API returns every project in scope, including the ones
   * nobody logged against; a project with zero hours has nothing to say in a bar
   * list, and six rows is what fits beside the trend chart without scrolling.
   */
  const projectData = useMemo(
    () =>
      [...(projectQuery.data ?? [])]
        .filter((project) => (project.hoursLogged ?? 0) > 0)
        .sort((a, b) => (b.hoursLogged ?? 0) - (a.hoursLogged ?? 0))
        .slice(0, TOP_PROJECTS),
    [projectQuery.data],
  );

  /**
   * `lateEntries` is a SUBSET of `entries`, not a sibling of it — stacking the
   * two raw fields would count every late update twice and inflate the day.
   * The honest stack is (on time) + (late) = entries.
   */
  const hourlyData = useMemo(
    () =>
      (hourlyQuery.data ?? []).map((slot) => ({
        ...slot,
        onTime: Math.max(slot.entries - slot.lateEntries, 0),
      })),
    [hourlyQuery.data],
  );

  const departmentData = useMemo(
    () => [...(departmentQuery.data ?? [])].sort((a, b) => a.complianceRate - b.complianceRate),
    [departmentQuery.data],
  );

  const departments = departmentsQuery.data ?? [];
  const teams = teamsQuery.data ?? [];
  const ownDepartment = departments.length === 1 ? departments[0] : null;

  const axisTick = { fill: theme.palette.text.secondary, fontSize: 11 };
  const gridStroke = theme.palette.divider;
  const primary = theme.palette.primary.main;
  const lateColor = theme.palette.warning.main;

  /**
   * There is no "completed" tile and no "blocked" tile: an entry records an hour
   * that has already been worked, so every logged hour IS completed work and
   * none of it can be blocked. What is left to count is the hours themselves,
   * the projects they went to, who logged them, and who did not.
   */
  const kpis = [
    {
      key: 'hours',
      icon: AccessTimeOutlinedIcon,
      label: isToday ? 'Hours logged today' : 'Hours logged',
      value: formatNumber(cards?.hoursLogged ?? 0),
      suffix: 'h',
      subtext: 'Every logged hour is work already done',
      color: primary,
    },
    {
      key: 'projects',
      icon: FolderOpenOutlinedIcon,
      label: isToday ? 'Projects active today' : 'Projects active',
      value: formatNumber(cards?.projectsActiveToday ?? 0),
      subtext:
        (cards?.projectsActiveToday ?? 0) === 1
          ? 'One project took the hours'
          : 'Projects that took an hour of someone’s day',
      color: theme.palette.primary.light,
    },
    {
      key: 'active',
      icon: GroupsOutlinedIcon,
      label: 'Employees active',
      value: formatNumber(cards?.activeEmployees ?? 0),
      suffix: `/ ${formatNumber(cards?.headcount ?? 0)}`,
      subtext: `${formatPercent(rates?.participation ?? 0, 1)} participation`,
      color: theme.palette.info.main,
    },
    {
      key: 'not-logged',
      icon: notLogged > 0 ? PersonOffOutlinedIcon : CheckCircleOutlineIcon,
      label: isToday ? 'Not logged today' : 'Not logged',
      value: formatNumber(notLogged),
      subtext:
        notLogged > 0
          ? `${notLogged === 1 ? 'person has' : 'people have'} an empty sheet`
          : 'Everyone has logged',
      color: notLogged > 0 ? theme.palette.warning.main : theme.palette.success.main,
      // The one number this page exists for. It shouts, but only when it must.
      emphasis: notLogged > 0,
    },
    {
      key: 'late',
      icon: ScheduleOutlinedIcon,
      label: 'Late updates',
      value: formatNumber(cards?.lateUpdates ?? 0),
      subtext: `${formatPercent(rates?.punctuality ?? 0, 1)} logged on time`,
      color: theme.palette.warning.main,
    },
  ];

  /* ---------------------------------------------------------------- *
   * The summary is the spine of this page: if it failed, the KPI rail,
   * the date and the headline rates are all missing, and a page of
   * charts around a hole is worse than an honest error.
   * ---------------------------------------------------------------- */
  if (summaryQuery.isError) {
    return (
      <Box>
        <Paper sx={{ borderRadius: 2 }}>
          <ErrorState error={summaryQuery.error} onRetry={() => summaryQuery.refetch()} />
        </Paper>
      </Box>
    );
  }

  const rangeCaption = `${describeRange(range)} · ${countDays(range)} day${countDays(range) === 1 ? '' : 's'}`;

  return (
    <Box>
      {/* No PageHeader — the dashboard owns the title. This is a section inside it. */}
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 1.5 }}
      >
        <Typography variant="caption" color="text.secondary">
          {summary
            ? `Snapshot for ${formatDate(summary.date)} · trends over ${rangeCaption}`
            : 'Executive analytics'}
        </Typography>
        <Tooltip title="Refresh">
          <span>
            <IconButton onClick={refresh} disabled={isRefreshing} size="small">
              <RefreshIcon
                sx={{
                  fontSize: 19,
                  animation: isRefreshing ? 'dash-spin 900ms linear infinite' : 'none',
                  '@keyframes dash-spin': { to: { transform: 'rotate(360deg)' } },
                }}
              />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {/* Filter bar */}
      <Paper sx={{ p: 2, mb: 2.5, borderRadius: 2 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', md: 'flex-start' }}
          flexWrap="wrap"
          useFlexGap
        >
          {canGlobal && (
            <TextField
              select
              size="small"
              label="Department"
              value={departmentId}
              onChange={handleDepartmentChange}
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="">All departments</MenuItem>
              {departments.map((department) => (
                <MenuItem key={department.id} value={department.id}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: department.colorHex ?? 'text.disabled',
                      }}
                    />
                    <span>{department.name}</span>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* A Tech Lead has exactly one department. A dropdown of one is a
              control that can't do anything — state the scope instead. */}
          {!canGlobal && canTeam && ownDepartment && (
            <Stack spacing={0.5} sx={{ justifyContent: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                Department
              </Typography>
              <Chip
                label={ownDepartment.name}
                sx={{
                  alignSelf: 'flex-start',
                  height: 32,
                  color: ownDepartment.colorHex ?? undefined,
                  backgroundColor: ownDepartment.colorHex
                    ? alpha(ownDepartment.colorHex, mode === 'light' ? 0.1 : 0.16)
                    : undefined,
                }}
              />
            </Stack>
          )}

          {canTeam && (
            <TextField
              select
              size="small"
              label="Team"
              value={teamId}
              onChange={(event) => updateParams({ teamId: event.target.value })}
              sx={{ minWidth: 190 }}
              disabled={teamsQuery.isPending}
            >
              <MenuItem value="">All teams</MenuItem>
              {teams.map((team) => (
                <MenuItem key={team.id} value={team.id}>
                  {team.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <DateRangeFilter
            value={{ preset, dateFrom: dateFromParam, dateTo: dateToParam }}
            onChange={handleRangeChange}
          />

          {hasFilters && (
            <Button size="small" onClick={resetFilters} sx={{ alignSelf: 'center' }}>
              Reset
            </Button>
          )}
        </Stack>
      </Paper>

      {/* KPI rail */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, 1fr)',
            sm: 'repeat(3, 1fr)',
            xl: 'repeat(5, 1fr)',
          },
          gap: 2,
          mb: 2.5,
        }}
      >
        {/* `key` is destructured OUT of the spread. Spreading an object that
            contains a `key` property passes it as a prop as well as a React key,
            which React warns about and which will become an error in a future
            major. */}
        {kpis.map(({ key, ...kpi }) => (
          <KpiCard key={key} loading={summaryQuery.isPending} {...kpi} />
        ))}
      </Box>

      {/* Follow-up sits ABOVE the charts: it is the live, actionable panel — who
          is behind, right now — and the charts are the history around it. */}
      {canTeam && (
        <Box sx={{ mb: 2.5 }}>
          <TeamFollowUpPanel
            data={followUpQuery.data}
            loading={followUpQuery.isPending}
            error={followUpQuery.error}
            onRetry={() => followUpQuery.refetch()}
          />
        </Box>
      )}

      {/* Charts */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: 2.5,
          alignItems: 'stretch',
        }}
      >
        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 8' } }}>
          <ChartCard
            title="Compliance trend"
            subtitle={`Share of expected slots filled · ${describeRange(range)}`}
            height={280}
            loading={trendQuery.isPending}
            error={trendQuery.error}
            onRetry={() => trendQuery.refetch()}
            isEmpty={trendEmpty}
            emptyMessage="Nobody was expected to log time in this window."
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="complianceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={primary} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={primary} stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={{ stroke: gridStroke }}
                  minTickGap={24}
                  tickFormatter={(value) => dayjs(value).format('D MMM')}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  tickFormatter={(value) => `${value}%`}
                />
                <RechartsTooltip
                  cursor={{ stroke: gridStroke, strokeWidth: 1 }}
                  content={
                    <ChartTooltip
                      labelFormatter={(value) => formatDate(value)}
                      valueFormatter={(value, entry) =>
                        `${formatPercent(value, 1)} (${formatNumber(entry.payload.filledSlots)}/${formatNumber(entry.payload.expectedSlots)})`
                      }
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="complianceRate"
                  name="Compliance"
                  stroke={primary}
                  strokeWidth={2}
                  fill="url(#complianceGradient)"
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </Box>

        <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 4' } }}>
          <ChartCard
            title="Top projects"
            subtitle={`Where the hours went · ${describeRange(range)}`}
            height="auto"
            loading={projectQuery.isPending}
            error={projectQuery.error}
            onRetry={() => projectQuery.refetch()}
            isEmpty={projectData.length === 0}
            emptyMessage="No hours were logged against any project in this window."
          >
            <TopProjectsList rows={projectData} />
          </ChartCard>
        </Box>

        <Box sx={{ gridColumn: { xs: 'span 12', lg: canGlobal ? 'span 6' : 'span 12' } }}>
          <ChartCard
            title="Hourly activity"
            subtitle="Entries logged per time slot"
            height={260}
            action={
              <SeriesLegend
                items={[
                  { label: 'On time', color: primary },
                  { label: 'Late', color: lateColor },
                ]}
              />
            }
            loading={hourlyQuery.isPending}
            error={hourlyQuery.error}
            onRetry={() => hourlyQuery.refetch()}
            isEmpty={hourlyData.length === 0}
            emptyMessage="No entries were logged against any time slot in this window."
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={axisTick}
                  tickLine={false}
                  axisLine={{ stroke: gridStroke }}
                  interval="preserveStartEnd"
                  minTickGap={4}
                />
                <YAxis
                  tick={axisTick}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                  allowDecimals={false}
                />
                <RechartsTooltip
                  cursor={{ fill: alpha(theme.palette.text.primary, 0.04) }}
                  content={<ChartTooltip valueFormatter={(value) => formatNumber(value)} />}
                />
                <Bar dataKey="onTime" name="On time" stackId="slot" fill={primary} maxBarSize={44} />
                <Bar
                  dataKey="lateEntries"
                  name="Late"
                  stackId="slot"
                  fill={lateColor}
                  maxBarSize={44}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </Box>

        {canGlobal && (
          <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 6' } }}>
            <ChartCard
              title="Department compliance"
              subtitle="Worst first — a department that logged nothing still gets a bar"
              height={Math.max(200, departmentData.length * 42)}
              loading={departmentQuery.isPending}
              error={departmentQuery.error}
              onRetry={() => departmentQuery.refetch()}
              isEmpty={departmentData.length === 0}
              emptyMessage="No departments are in scope."
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={departmentData}
                  margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke={gridStroke} strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={axisTick}
                    tickLine={false}
                    axisLine={{ stroke: gridStroke }}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={axisTick}
                    tickLine={false}
                    axisLine={false}
                    width={104}
                    tickFormatter={(value) => truncate(value, 14)}
                  />
                  <RechartsTooltip
                    cursor={{ fill: alpha(theme.palette.text.primary, 0.04) }}
                    content={
                      <ChartTooltip
                        valueFormatter={(value, entry) =>
                          `${formatPercent(value, 1)} (${formatNumber(entry.payload.filledSlots)}/${formatNumber(entry.payload.expectedSlots)})`
                        }
                      />
                    }
                  />
                  <Bar dataKey="complianceRate" name="Compliance" radius={[0, 4, 4, 0]} maxBarSize={22}>
                    {departmentData.map((department) => (
                      // Each department's own brand colour, as configured in admin.
                      <Cell
                        key={department.departmentId}
                        fill={department.colorHex ?? theme.palette.primary.main}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </Box>
        )}

        <Box sx={{ gridColumn: { xs: 'span 12', lg: canTeam ? 'span 7' : 'span 12' } }}>
          <ChartCard
            title="Employee productivity"
            subtitle={`Lowest compliance first · ${describeRange(range)}`}
            height="auto"
          >
            <EmployeeLeaderboard
              rows={employeeQuery.data}
              loading={employeeQuery.isPending}
              error={employeeQuery.error}
              onRetry={() => employeeQuery.refetch()}
            />
          </ChartCard>
        </Box>

        {canTeam && (
          <Box sx={{ gridColumn: { xs: 'span 12', lg: 'span 5' } }}>
            <ChartCard
              title="Live compliance"
              subtitle={summary ? `As of ${formatDate(summary.date)}` : undefined}
              height="auto"
              sx={{ maxHeight: 520 }}
            >
              <CompliancePanel
                data={complianceQuery.data}
                loading={complianceQuery.isPending}
                error={complianceQuery.error}
                onRetry={() => complianceQuery.refetch()}
              />
            </ChartCard>
          </Box>
        )}
      </Box>
    </Box>
  );
}
