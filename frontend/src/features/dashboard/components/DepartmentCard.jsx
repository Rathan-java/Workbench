import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';

/**
 * ONE CARD PER DEPARTMENT. The whole dashboard, really.
 *
 * ── THE ONE NUMBER, AND WHY IT IS NOT THE OBVIOUS ONE ───────────────────────
 * The card reads `27 / 30`, where 30 is **employees × hours that have FINISHED** —
 * not employees × hours in the working day.
 *
 * At 13:15, with a day starting at 10:00, exactly three hour-windows have closed.
 * For 10 people that is 30 expected updates. The naive alternative (7 hours × 10 =
 * 70) would have this card reading "12/70 — 17%" at 11am every single morning,
 * when nobody could possibly have logged more. A number that is red by construction
 * every morning is a number everybody has learned to ignore by lunchtime — and then
 * the day it means something, nobody looks.
 *
 * The hour currently being worked is excluded on purpose. Nobody is behind on an
 * hour they are still living through.
 */

/**
 * ── ON COLOUR ───────────────────────────────────────────────────────────────
 * RED IS RESERVED. It is not used here at all.
 *
 * The first version painted every card red the moment a department was below
 * target — which, at 10:30 in the morning, is every department, every day. A
 * dashboard that is a wall of alarm before anyone has had a chance to be wrong is
 * a dashboard people learn to flinch at and then stop opening. The colour stops
 * carrying information and starts carrying anxiety.
 *
 * So on this screen:
 *   - GREEN  means "done, nothing to do here".
 *   - AMBER  means "behind, worth a look".
 *   - BLUE   is the neutral, in-progress default — the colour of a normal morning.
 *
 * Red is spent in exactly one place in this product: an action that destroys
 * something. Being 40% through your day at 11am is not that.
 */
const STATUS = {
  ON_TRACK: { label: 'On track', colour: 'success' },
  SLIPPING: { label: 'Catching up', colour: 'warning' },
  AT_RISK: { label: 'Behind', colour: 'warning' },
  NOT_STARTED: { label: 'Not due yet', colour: 'default' },
  NON_WORKING: { label: 'Not a working day', colour: 'default' },
};

export default function DepartmentCard({ department, onClick }) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';

  const {
    name,
    colorHex,
    employees,
    hoursElapsed,
    updated,
    expected,
    rate,
    missing,
    employeesBehind,
    status,
    holiday,
    isWorkingDay,
  } = department;

  const meta = STATUS[status] ?? STATUS.NOT_STARTED;
  const accent = colorHex ?? theme.palette.primary.main;

  /** Nothing is due yet — say so plainly rather than showing a hollow 0%. */
  const idle = !isWorkingDay || expected === 0;

  // Green when done, amber when genuinely behind, and the department's OWN colour
  // the rest of the time. Its own colour is the pleasant default: it identifies
  // the card, it is never alarming, and it means the palette only shifts when
  // something has actually changed.
  const barColour = status === 'ON_TRACK' ? 'success' : status === 'AT_RISK' ? 'warning' : 'primary';

  /** The big number takes the accent unless the state genuinely warrants otherwise. */
  const numberColour =
    status === 'ON_TRACK'
      ? theme.palette.success.main
      : status === 'AT_RISK'
        ? theme.palette.warning.main
        : accent;

  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2.25,
        borderRadius: 2.5,
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 140ms, transform 140ms',
        '&:hover': onClick
          ? { borderColor: alpha(accent, 0.5), transform: 'translateY(-2px)' }
          : undefined,
        // The department's own colour, as a spine down the left edge. It is the
        // fastest way to know which card you are reading without parsing text.
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          bgcolor: accent,
        },
      }}
    >
      <Stack spacing={1.75} sx={{ pl: 0.75 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Typography variant="subtitle1" sx={{ fontWeight: 650, lineHeight: 1.3, minWidth: 0 }} noWrap>
            {name}
          </Typography>
          <Chip
            size="small"
            label={meta.label}
            color={meta.colour === 'default' ? undefined : meta.colour}
            variant={meta.colour === 'default' ? 'outlined' : 'filled'}
            sx={{ height: 21, fontSize: 10.5, fontWeight: 700, flexShrink: 0 }}
          />
        </Stack>

        {idle ? (
          <Box sx={{ py: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {holiday
                ? `Holiday — ${holiday}`
                : !isWorkingDay
                  ? 'Not a working day for this department'
                  : 'No hour has finished yet today'}
            </Typography>
          </Box>
        ) : (
          <>
            {/* THE NUMBER. Everything else on this card is context for it. */}
            <Stack direction="row" alignItems="baseline" spacing={1}>
              <Typography
                variant="h3"
                sx={{
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                  fontVariantNumeric: 'tabular-nums',
                  color: numberColour,
                }}
              >
                {updated}
              </Typography>
              <Typography
                variant="h5"
                sx={{ fontWeight: 500, color: 'text.disabled', fontVariantNumeric: 'tabular-nums' }}
              >
                / {expected}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, color: numberColour, fontVariantNumeric: 'tabular-nums' }}
              >
                {Math.round(rate)}%
              </Typography>
            </Stack>

            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: -0.75 }}>
              hourly updates done
            </Typography>

            <LinearProgress
              variant="determinate"
              value={Math.min(rate, 100)}
              color={barColour}
              sx={{
                height: 7,
                borderRadius: 4,
                bgcolor: alpha(theme.palette.text.primary, dark ? 0.1 : 0.07),
              }}
            />
          </>
        )}

        <Stack
          direction="row"
          spacing={1.75}
          alignItems="center"
          sx={{ pt: 0.25, color: 'text.secondary' }}
        >
          <Tooltip title="Employees in this department">
            <Stack direction="row" spacing={0.5} alignItems="center">
              <PeopleOutlinedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">{employees}</Typography>
            </Stack>
          </Tooltip>

          <Tooltip title="Hour-windows that have finished so far. The hour being worked right now is not counted.">
            <Stack direction="row" spacing={0.5} alignItems="center">
              <ScheduleOutlinedIcon sx={{ fontSize: 15 }} />
              <Typography variant="caption">
                {hoursElapsed} {hoursElapsed === 1 ? 'hour' : 'hours'} done
              </Typography>
            </Stack>
          </Tooltip>

          <Box sx={{ flex: 1 }} />

          {!idle && missing > 0 && (
            // Plain secondary text. "8 to go" is information, not an emergency —
            // and rendering it in alarm red at 10:30, when it could not possibly be
            // anything else, is how a colour stops meaning anything.
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
              {missing} to go
              {employeesBehind > 0 && ` · ${employeesBehind} behind`}
            </Typography>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}
