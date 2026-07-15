import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

/**
 * One executive number.
 *
 * `emphasis` is the whole point of the component: on a wall of six identical
 * cards, the one that says "four people have not logged today" must not look
 * like the one that says "twelve tasks completed". Emphasis tints the surface
 * and the number so the eye lands there first, and it is switched on by the
 * DATA, not by the layout.
 *
 * @param {object} props
 * @param {React.ElementType} props.icon
 * @param {string} props.label
 * @param {React.ReactNode} props.value
 * @param {string} [props.suffix]   — rendered smaller beside the value ("/ 24").
 * @param {string} [props.subtext]
 * @param {string} props.color      — a resolved CSS colour from the theme.
 * @param {boolean} [props.emphasis]
 * @param {boolean} [props.loading]
 */
export default function KpiCard({
  icon: Icon,
  label,
  value,
  suffix,
  subtext,
  color,
  emphasis = false,
  loading = false,
}) {
  if (loading) {
    return (
      <Paper sx={{ p: 2, borderRadius: 2, height: '100%' }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width="60%" height={14} />
            <Skeleton variant="text" width="40%" height={36} sx={{ mt: 0.5 }} />
            <Skeleton variant="text" width="75%" height={12} />
          </Box>
          <Skeleton variant="rounded" width={36} height={36} />
        </Stack>
      </Paper>
    );
  }

  return (
    <Paper
      sx={{
        position: 'relative',
        p: 2,
        pl: 2.25,
        height: '100%',
        borderRadius: 2,
        overflow: 'hidden',
        borderColor: emphasis ? alpha(color, 0.4) : undefined,
        backgroundColor: emphasis ? alpha(color, 0.06) : undefined,
        transition: 'border-color 120ms ease, background-color 120ms ease',
        // The accent rail: a hairline of the metric's own colour, not a border
        // on every edge — it reads as a category marker rather than a warning box.
        '&::before': {
          content: '""',
          position: 'absolute',
          insetBlock: 0,
          left: 0,
          width: 3,
          backgroundColor: color,
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="overline" color="text.secondary" noWrap component="div">
            {label}
          </Typography>

          <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.25 }}>
            <Typography
              variant="h3"
              component="div"
              sx={{ color: emphasis ? color : 'text.primary', lineHeight: 1.1 }}
            >
              {value}
            </Typography>

            {suffix && (
              <Typography variant="subtitle1" color="text.secondary" sx={{ fontWeight: 500 }}>
                {suffix}
              </Typography>
            )}
          </Stack>

          {subtext && (
            <Typography
              variant="caption"
              sx={{ mt: 0.5, display: 'block', color: emphasis ? color : 'text.secondary' }}
            >
              {subtext}
            </Typography>
          )}
        </Box>

        <Box
          sx={{
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            width: 36,
            height: 36,
            borderRadius: 1.5,
            color,
            backgroundColor: alpha(color, emphasis ? 0.16 : 0.1),
          }}
        >
          <Icon sx={{ fontSize: 19 }} />
        </Box>
      </Stack>
    </Paper>
  );
}
