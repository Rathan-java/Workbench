import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import PersonOffOutlinedIcon from '@mui/icons-material/PersonOffOutlined';

import EmptyState from '../../../components/common/EmptyState.jsx';
import ErrorState from '../../../components/common/ErrorState.jsx';
import ChartCard from './ChartCard.jsx';
import SummaryTile from './SummaryTile.jsx';
import { FOLLOW_UP_LABELS, complianceTone, followUpTone } from '../tone.js';
import { formatNumber, formatPercent, initials } from '../../../utils/format.js';

const clampRate = (value) => Math.min(Math.max(Number(value) || 0, 0), 100);

/** "120" → "2 hours". The grace period has to be readable in a sentence. */
const describeGrace = (minutes) => {
  const total = Number(minutes) || 0;
  if (total < 60) return `${total} minute${total === 1 ? '' : 's'}`;

  const hours = Math.round((total / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? '' : 's'}`;
};

const plural = (count, word) => `${formatNumber(count)} ${word}${count === 1 ? '' : 's'}`;

/** One labelled track. The children are the segments drawn inside it. */
function Bar({ label, value, children }) {
  const theme = useTheme();

  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 52, flexShrink: 0, textAlign: 'right' }}
      >
        {label}
      </Typography>

      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minWidth: 60,
          height: 8,
          borderRadius: 4,
          overflow: 'hidden',
          backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === 'light' ? 0.08 : 0.16),
        }}
      >
        {children}
      </Box>

      <Typography variant="caption" sx={{ width: 40, flexShrink: 0, textAlign: 'right', fontWeight: 600 }}>
        {formatPercent(value, 0)}
      </Typography>
    </Stack>
  );
}

/**
 * The two bars that carry the entire point of this panel.
 *
 * "Filled" and "On time" are drawn on identical tracks, left-aligned, one under
 * the other — so the difference in their lengths is read directly, without any
 * arithmetic. That difference IS the back-filling, so it is also drawn
 * explicitly: the tail of the Filled bar that the On-time bar does not reach is
 * hatched in amber. A team at 100% filled and 30% on time therefore shows a long
 * grey bar with a 70%-wide amber hatch above a short bar — unmissable, and
 * impossible to mistake for "green because everything got filled".
 */
function FollowUpBars({ team, tone }) {
  const theme = useTheme();

  const fill = clampRate(team.fillRate);
  const onTime = clampRate(team.onTimeRate);
  const gap = Math.max(fill - onTime, 0);
  const lateEntries = Math.max(team.filledEntries - team.onTimeEntries, 0);

  const filledColor = theme.palette.text.secondary;
  const lateColor = theme.palette.warning.main;

  return (
    <Stack spacing={0.75} sx={{ width: '100%' }}>
      <Bar label="Filled" value={fill}>
        <Box
          sx={{
            position: 'absolute',
            insetBlock: 0,
            left: 0,
            width: `${fill}%`,
            borderRadius: 4,
            backgroundColor: filledColor,
            opacity: 0.55,
          }}
        />

        {gap > 0 && (
          <Tooltip
            title={`${plural(lateEntries, 'hour')} filled in after the grace period — logged, but not on time.`}
          >
            <Box
              sx={{
                position: 'absolute',
                insetBlock: 0,
                left: `${onTime}%`,
                width: `${gap}%`,
                backgroundColor: alpha(lateColor, 0.3),
                // Hatching, not a flat block: this segment is a different KIND of
                // thing from the bar it sits in — work that happened, late.
                backgroundImage: `repeating-linear-gradient(135deg, ${lateColor} 0 2px, transparent 2px 5px)`,
              }}
            />
          </Tooltip>
        )}
      </Bar>

      <Bar label="On time" value={onTime}>
        <Box
          sx={{
            position: 'absolute',
            insetBlock: 0,
            left: 0,
            width: `${onTime}%`,
            borderRadius: 4,
            backgroundColor: tone,
          }}
        />
      </Bar>

      {/* pl matches the Bar label column (52) plus its gap (8), so the sentence
          starts exactly where the tracks do. */}
      {gap > 0 && (
        <Typography variant="caption" sx={{ pl: '60px', color: lateColor }}>
          {plural(lateEntries, 'hour')} back-filled — {formatPercent(gap, 0)} of due hours logged late
        </Typography>
      )}
    </Stack>
  );
}

function TeamRow({ team, date }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  const tone = followUpTone(team.status, theme);
  const notDue = team.status === 'NOT_DUE';
  const behind = team.membersBehind ?? [];
  const expandable = behind.length > 0;

  return (
    <Box
      sx={{
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
        // AT_RISK earns a tinted surface. Everything else stays on the paper, so
        // the tint means something when it appears.
        backgroundColor:
          team.status === 'AT_RISK' ? alpha(tone, theme.palette.mode === 'light' ? 0.04 : 0.08) : undefined,
        opacity: notDue ? 0.6 : 1,
      }}
    >
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={{ xs: 1.5, md: 2 }}
        alignItems={{ xs: 'stretch', md: 'center' }}
        sx={{ p: 1.5 }}
      >
        {/* Identity: team, department, lead */}
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: { md: 220 }, flex: { md: '0 0 34%' } }}>
          <IconButton
            size="small"
            onClick={() => setOpen((current) => !current)}
            disabled={!expandable}
            aria-label={open ? `Hide who is behind in ${team.name}` : `Show who is behind in ${team.name}`}
            aria-expanded={open}
            sx={{ flexShrink: 0 }}
          >
            <ExpandMoreIcon
              sx={{
                fontSize: 18,
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 150ms ease',
              }}
            />
          </IconButton>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={0.75} sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {team.name}
              </Typography>

              {team.department && (
                <Chip
                  label={team.department.name}
                  size="small"
                  sx={{
                    flexShrink: 0,
                    height: 20,
                    fontSize: '0.6875rem',
                    color: team.department.colorHex ?? undefined,
                    backgroundColor: team.department.colorHex
                      ? alpha(team.department.colorHex, theme.palette.mode === 'light' ? 0.1 : 0.16)
                      : undefined,
                  }}
                />
              )}
            </Stack>

            {team.lead ? (
              <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.5, minWidth: 0 }}>
                <Avatar
                  src={team.lead.avatarPath ? `/uploads/${team.lead.avatarPath}` : undefined}
                  sx={{ width: 20, height: 20, fontSize: '0.5625rem', fontWeight: 600 }}
                >
                  {initials(team.lead.fullName)}
                </Avatar>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {team.lead.fullName} · {plural(team.memberCount, 'member')}
                </Typography>
              </Stack>
            ) : (
              // No lead is not a cosmetic gap: it means nobody is accountable for
              // chasing this team's hours, which is the whole mechanism here.
              <Chip
                icon={<PersonOffOutlinedIcon sx={{ fontSize: 14 }} />}
                label="No lead"
                size="small"
                color="warning"
                variant="outlined"
                sx={{ mt: 0.5, height: 20, fontSize: '0.6875rem' }}
              />
            )}
          </Box>
        </Stack>

        {/* The bars */}
        <Box sx={{ flex: 1, minWidth: 0, pl: { xs: 0, md: 1 } }}>
          {notDue ? (
            <Typography variant="caption" color="text.disabled">
              Nothing due yet — no hour has passed its grace period today.
            </Typography>
          ) : (
            <FollowUpBars team={team} tone={tone} />
          )}
        </Box>

        {/* Verdict */}
        <Stack
          direction="row"
          alignItems="center"
          justifyContent={{ xs: 'space-between', md: 'flex-end' }}
          spacing={1}
          sx={{ flexShrink: 0, minWidth: { md: 168 } }}
        >
          <Chip
            label={FOLLOW_UP_LABELS[team.status] ?? team.status}
            size="small"
            sx={{
              fontWeight: 600,
              color: tone,
              backgroundColor: alpha(tone, theme.palette.mode === 'light' ? 0.1 : 0.16),
            }}
          />

          <Typography
            variant="caption"
            sx={{ minWidth: 62, textAlign: 'right', color: behind.length > 0 ? 'warning.main' : 'text.disabled' }}
          >
            {behind.length > 0 ? `${formatNumber(behind.length)} behind` : notDue ? '—' : 'Nobody behind'}
          </Typography>
        </Stack>
      </Stack>

      <Collapse in={open} unmountOnExit>
        <Stack
          spacing={0.5}
          sx={{ px: 1.5, pb: 1.5, pt: 0.5, borderTop: `1px solid ${theme.palette.divider}`, mt: 0.5 }}
        >
          {behind.map((member) => (
            <Stack
              key={member.userId}
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={{ py: 0.75, px: 1, borderRadius: 1.5, '&:hover': { backgroundColor: 'action.hover' } }}
            >
              <Avatar
                src={member.avatarPath ? `/uploads/${member.avatarPath}` : undefined}
                sx={{ width: 28, height: 28, fontSize: '0.625rem', fontWeight: 600 }}
              >
                {initials(member.fullName)}
              </Avatar>

              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                  {member.fullName}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">
                  {member.employeeCode}
                </Typography>
              </Box>

              <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600, flexShrink: 0 }}>
                {plural(member.overdueHours, 'hour')} overdue
              </Typography>

              <Button
                component={RouterLink}
                to={`/monitor?userId=${member.userId}&date=${date}`}
                size="small"
                variant="outlined"
                sx={{ flexShrink: 0 }}
              >
                View sheet
              </Button>
            </Stack>
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

/**
 * TEAM FOLLOW-UP — is the process being followed, right now?
 *
 * The panel exists to separate two numbers that a single "compliance" bar would
 * fuse into a comfortable lie:
 *
 *   fillRate    — did the hour get logged at all?
 *   onTimeRate  — did it get logged while it was still true?
 *
 * A team that writes the whole day up at 6pm scores 100% on the first and close
 * to zero on the second. Their lead spent the day blind. So on-time is the
 * headline, filled is the context, and the GAP between them is drawn as its own
 * marked region rather than left to be inferred.
 */
export default function TeamFollowUpPanel({ data, loading, error, onRetry }) {
  const theme = useTheme();

  const teams = useMemo(() => {
    const rows = data?.teams ?? [];

    // The API sorts worst-first on onTimeRate — which puts NOT_DUE teams (rate 0
    // because nothing is due yet) at the very top, above teams that are genuinely
    // failing. Push them to the bottom; the order within each group is the
    // server's.
    return [...rows].sort((a, b) => Number(a.status === 'NOT_DUE') - Number(b.status === 'NOT_DUE'));
  }, [data]);

  const summary = data?.summary;
  const graceMinutes = data?.graceMinutes;

  const subtitle =
    graceMinutes == null
      ? 'On time beats filled — a day written up at 6pm is a day your lead spent blind.'
      : `An hour counts as overdue ${describeGrace(graceMinutes)} after it ends. Filling it in later still counts as filled — but not as on time.`;

  /**
   * ChartCard's own loading/empty slots size themselves to `height: 100%`, which
   * collapses to nothing in a `height="auto"` card — so, exactly as CompliancePanel
   * and EmployeeLeaderboard do, the three states are owned here and the card is
   * used for the header and the surface.
   */
  const body = () => {
    if (loading) {
      return (
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1}>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} variant="rounded" height={62} sx={{ flex: 1 }} />
            ))}
          </Stack>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} variant="rounded" height={78} />
          ))}
        </Stack>
      );
    }

    if (error) return <ErrorState dense error={error} onRetry={onRetry} />;

    if (teams.length === 0) {
      return (
        <EmptyState
          dense
          icon={GroupsOutlinedIcon}
          title="No teams in scope"
          message="There are no active teams with members here, so there is nothing to follow up on."
        />
      );
    }

    return (
      <Stack spacing={2}>
        {summary && (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
              gap: 1,
            }}
          >
            <SummaryTile label="On track" value={summary.onTrack} color={theme.palette.success.main} />
            <SummaryTile
              label="Back-filling"
              value={summary.backfilling}
              color={theme.palette.warning.main}
            />
            <SummaryTile label="At risk" value={summary.atRisk} color={theme.palette.warning.main} />
            <SummaryTile
              label={summary.employeesBehind === 1 ? 'Person behind' : 'People behind'}
              value={summary.employeesBehind}
              color={summary.employeesBehind > 0 ? theme.palette.warning.main : theme.palette.text.disabled}
            />
          </Box>
        )}

        {summary && summary.backfilling > 0 && (
          <Typography variant="caption" color="text.secondary">
            {plural(summary.backfilling, 'team')} filled {formatPercent(summary.companyFillRate, 0)} of
            their due hours but only {formatPercent(summary.companyOnTimeRate, 0)} on time. Filled is not
            the same as followed.
          </Typography>
        )}

        <Stack spacing={1}>
          {teams.map((team) => (
            <TeamRow key={team.teamId} team={team} date={data.date} />
          ))}
        </Stack>
      </Stack>
    );
  };

  return (
    <ChartCard
      title="Team follow-up"
      subtitle={subtitle}
      height="auto"
      action={
        loading ? (
          <Skeleton variant="rounded" width={140} height={24} />
        ) : (
          summary && (
            <Tooltip title="Share of due hours filled WITHIN the grace period, across every team in scope.">
              <Stack direction="row" alignItems="baseline" spacing={0.75}>
                <Typography
                  variant="h6"
                  sx={{ lineHeight: 1, color: complianceTone(summary.companyOnTimeRate, theme) }}
                >
                  {formatPercent(summary.companyOnTimeRate, 0)}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  on time company-wide
                </Typography>
              </Stack>
            </Tooltip>
          )
        )
      }
    >
      {body()}
    </ChartCard>
  );
}
