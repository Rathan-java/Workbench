import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';

import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/TodayOutlined';

import dayjs from 'dayjs';
import { formatApiDate } from '../../../utils/format.js';

/**
 * ONE DAY AT A TIME.
 *
 * The dashboard used to default to a 30-day range, which was the wrong instinct.
 * A CEO opening this at 11am wants to know about *this morning* — and a 30-day
 * aggregate is precisely the thing that hides "half the company hasn't logged
 * anything since Tuesday" inside a comfortable monthly average.
 *
 * So: today by default, and arrows to step back a day at a time. The 30-day view
 * still exists, but you have to ask for it — which is the correct default for a
 * report you read occasionally rather than a status you check every morning.
 */
export default function DayNavigator({ date, onChange }) {
  const theme = useTheme();

  const today = formatApiDate(new Date());
  const isToday = date === today;

  const shift = (days) => onChange(formatApiDate(dayjs(date).add(days, 'day')));

  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Paper
        variant="outlined"
        sx={{ display: 'flex', alignItems: 'center', borderRadius: 2, overflow: 'hidden' }}
      >
        <Tooltip title="Previous day">
          <IconButton size="small" onClick={() => shift(-1)} aria-label="Previous day">
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Box
          component="input"
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          sx={{
            border: 'none',
            outline: 'none',
            bgcolor: 'transparent',
            color: 'text.primary',
            fontFamily: 'inherit',
            fontSize: 13.5,
            fontWeight: 600,
            px: 0.75,
            py: 0.5,
            // Without this the native calendar glyph stays black on a dark background.
            colorScheme: theme.palette.mode,
          }}
        />

        <Tooltip title={isToday ? 'This is the latest day' : 'Next day'}>
          <span>
            <IconButton
              size="small"
              onClick={() => shift(1)}
              disabled={isToday}
              aria-label="Next day"
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Paper>

      {!isToday && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<TodayIcon sx={{ fontSize: 16 }} />}
          onClick={() => onChange(today)}
        >
          Today
        </Button>
      )}
    </Stack>
  );
}
