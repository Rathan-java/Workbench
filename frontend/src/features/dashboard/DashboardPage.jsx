/**
 * THE DASHBOARD.
 *
 * This is the first screen a CEO opens, and most days it is the only one they
 * will read. So it answers exactly two questions, and deliberately refuses to
 * answer any others above the fold:
 *
 *     1. "Is each department keeping up?"     →  one card per department, 27/30
 *     2. "Who do I need to chase?"            →  a list of names
 *
 * Everything else — the charts, the trends, the leaderboards, the team follow-up
 * panel — still exists, and none of it was wrong. It was simply the wrong thing
 * to show FIRST. It now sits behind a "Detailed analytics" toggle: one click away
 * for whoever wants it, out of the way of whoever does not.
 *
 * ── TODAY, NOT THE LAST 30 DAYS ─────────────────────────────────────────────
 * The old default was a 30-day range, which was the wrong instinct. A 30-day
 * aggregate is precisely the thing that hides "half the company hasn't logged
 * anything since Tuesday" inside a comfortable monthly average.
 *
 * So the default is TODAY, with arrows to step back one day at a time. The range
 * view still exists; you just have to ask for it — which is the right default for
 * a report you read occasionally, rather than a status you check every morning.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InsightsIcon from '@mui/icons-material/InsightsOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';

import PageHeader from '../../components/common/PageHeader.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';

import DayNavigator from './components/DayNavigator.jsx';
import DepartmentCard from './components/DepartmentCard.jsx';
import UpdateRequiredCard from './components/UpdateRequiredCard.jsx';
import CompliancePanel from './components/CompliancePanel.jsx';
import DeliveryPanel from './components/DeliveryPanel.jsx';
import DetailedAnalytics from './DetailedAnalytics.jsx';

import { dashboard } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSIONS } from '../../utils/constants.js';
import { formatApiDate, formatDate } from '../../utils/format.js';

export default function DashboardPage() {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const queryClient = useQueryClient();
  const { can, user } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const [showDetail, setShowDetail] = useState(false);

  const date = searchParams.get('date') ?? formatApiDate(new Date());

  const setDate = (next) => {
    const params = new URLSearchParams(searchParams);
    params.set('date', next);
    setSearchParams(params, { replace: true });
  };

  const overviewQuery = useQuery({
    queryKey: ['dashboard', 'overview', date],
    queryFn: () => dashboard.overview({ date }),
    select: (response) => response.data,
    // The whole point is watching work as it happens. A stale overview is a
    // dashboard that quietly lies about the current state of the company.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const complianceQuery = useQuery({
    queryKey: ['dashboard', 'compliance', date],
    queryFn: () => dashboard.compliance({ date }),
    select: (response) => response.data,
    enabled: can(PERMISSIONS.DASHBOARD_TEAM),
    refetchInterval: 60_000,
  });

  const overview = overviewQuery.data;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['dashboard'] });

  if (overviewQuery.isError) {
    return (
      <Box>
        <PageHeader title="Dashboard" />
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <ErrorState error={overviewQuery.error} onRetry={() => overviewQuery.refetch()} />
        </Paper>
      </Box>
    );
  }

  const totals = overview?.totals;
  const rate = totals?.rate ?? 0;

  /**
   * ── RED IS RESERVED ────────────────────────────────────────────────────────
   * Green when the day is done, amber when it is genuinely lagging, and BLUE the
   * rest of the time — because "40% through the morning" is not a crisis, it is
   * a Tuesday.
   *
   * The first cut of this screen went red the moment the company was below
   * target, which at 10:30 is every single morning. A dashboard that screams
   * before anyone has had a chance to be wrong is one people learn to flinch at
   * and then stop opening — and the colour stops carrying information and starts
   * carrying anxiety.
   *
   * Red is spent in exactly one place in this product: an action that destroys
   * something.
   */
  const tone = rate >= 90 ? 'success' : rate >= 60 ? 'primary' : 'warning';

  return (
    <Box>
      <PageHeader
        title={`Good ${greeting()}, ${user?.firstName ?? ''}`.trim()}
        subtitle={
          overview
            ? overview.isToday
              ? 'Where the company stands right now.'
              : `Where the company stood on ${formatDate(overview.date)}.`
            : ' '
        }
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <DayNavigator date={date} onChange={setDate} />
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={refresh}>
                <RefreshIcon sx={{ fontSize: 19 }} />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      />

      {/* ─── THE HEADLINE ────────────────────────────────────────────────────
        * One sentence, one number. If somebody reads nothing else on this page,
        * this is the thing they should walk away with.
        */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, sm: 2.75 },
          mb: 2.5,
          borderRadius: 2.5,
          bgcolor: alpha(theme.palette[tone].main, dark ? 0.08 : 0.04),
          borderColor: alpha(theme.palette[tone].main, 0.25),
        }}
      >
        {overviewQuery.isPending ? (
          <Skeleton variant="rounded" height={56} />
        ) : (
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={{ xs: 2, sm: 3 }}
            alignItems={{ sm: 'center' }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Stack direction="row" alignItems="baseline" spacing={1.25} sx={{ mb: 0.75 }}>
                <Typography
                  variant="h3"
                  sx={{
                    fontWeight: 700,
                    lineHeight: 1,
                    letterSpacing: '-0.03em',
                    color: `${tone}.main`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {totals?.updated ?? 0}
                </Typography>
                <Typography variant="h5" sx={{ fontWeight: 500, color: 'text.disabled' }}>
                  / {totals?.expected ?? 0}
                </Typography>
                <Typography variant="body1" color="text.secondary" sx={{ pl: 0.5 }}>
                  hourly updates done
                </Typography>
              </Stack>

              <LinearProgress
                variant="determinate"
                value={Math.min(rate, 100)}
                color={tone}
                sx={{
                  height: 8,
                  borderRadius: 4,
                  bgcolor: alpha(theme.palette.text.primary, dark ? 0.1 : 0.07),
                }}
              />
            </Box>

            <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />

            <Stack direction="row" spacing={3}>
              <Metric value={`${Math.round(rate)}%`} label="complete" tone={tone} />
              <Metric
                value={totals?.employeesBehind ?? 0}
                label="people behind"
                // Amber, not red. Somebody being behind is something to act on,
                // not something to panic about — and the chase list below already
                // tells you exactly who they are.
                tone={totals?.employeesBehind ? 'warning' : 'success'}
              />
            </Stack>
          </Stack>
        )}
      </Paper>

      {/* ─── ONE CARD PER DEPARTMENT ─────────────────────────────────────── */}
      <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: '0.08em' }}>
        Departments
      </Typography>

      <Grid container spacing={2} sx={{ mt: 0, mb: 3 }}>
        {overviewQuery.isPending
          ? [0, 1, 2, 3].map((i) => (
              <Grid key={i} item xs={12} sm={6} lg={3}>
                <Skeleton variant="rounded" height={170} />
              </Grid>
            ))
          : (overview?.departments ?? []).map((department) => (
              <Grid key={department.departmentId} item xs={12} sm={6} lg={3}>
                <DepartmentCard department={department} />
              </Grid>
            ))}
      </Grid>

      {/* ─── WHO TO CHASE, AND WHO HAS LOGGED NOTHING ──────────────────────
        * `alignItems: flex-start` matters: without it the two cards stretch to a
        * common height, and on the good days — when nobody is behind — the empty
        * "Update required" card becomes a huge white void next to a long
        * compliance list. An empty state should look calm, not broken.
        */}
      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} lg={can(PERMISSIONS.DASHBOARD_TEAM) ? 6 : 12}>
          {overviewQuery.isPending ? (
            <Skeleton variant="rounded" height={280} />
          ) : (
            <UpdateRequiredCard
              data={overview?.updateRequired}
              date={date}
              thresholdHours={overview?.updateRequiredHours ?? 3}
            />
          )}
        </Grid>

        {can(PERMISSIONS.DASHBOARD_TEAM) && (
          <Grid item xs={12} lg={6}>
            <CompliancePanel
              data={complianceQuery.data}
              loading={complianceQuery.isPending}
              error={complianceQuery.error}
              onRetry={() => complianceQuery.refetch()}
            />
          </Grid>
        )}
      </Grid>

      {/* ─── ASSIGNED WORK — the delivery axis ─────────────────────────────
        * Compliance (above) is "did they log their hours". This is "is the
        * assigned work getting done". It hides itself when nothing is assigned. */}
      <Box sx={{ mt: 3 }}>
        <DeliveryPanel />
      </Box>

      {/* ─── EVERYTHING ELSE, ONE CLICK AWAY ─────────────────────────────── */}
      <Divider sx={{ my: 3.5 }}>
        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<InsightsIcon sx={{ fontSize: 17 }} />}
          endIcon={
            <ExpandMoreIcon
              sx={{
                fontSize: 18,
                transform: showDetail ? 'rotate(180deg)' : 'none',
                transition: 'transform 160ms',
              }}
            />
          }
          onClick={() => setShowDetail((v) => !v)}
          sx={{ color: 'text.secondary', fontWeight: 600 }}
        >
          {showDetail ? 'Hide detailed analytics' : 'Detailed analytics'}
        </Button>
      </Divider>

      {/* Lazily mounted: an Employee who never opens this never pays for the
          charting library, and the dashboard's first paint stays fast. */}
      <Collapse in={showDetail} unmountOnExit>
        <DetailedAnalytics />
      </Collapse>
    </Box>
  );
}

function Metric({ value, label, tone }) {
  return (
    <Box sx={{ textAlign: 'center', minWidth: 62 }}>
      <Typography
        variant="h5"
        sx={{
          fontWeight: 700,
          lineHeight: 1.1,
          color: `${tone}.main`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
};
