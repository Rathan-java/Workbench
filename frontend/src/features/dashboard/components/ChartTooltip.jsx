import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/**
 * The recharts default tooltip is a white div with a 1px grey border — it
 * ignores the theme entirely and is unreadable on a dark surface. This one is
 * built from the theme, so it follows the app into dark mode.
 *
 * Recharts clones this element and injects `active`, `payload` and `label`.
 *
 * @param {object} props
 * @param {(label: unknown) => string} [props.labelFormatter]
 * @param {(value: number, entry: object) => string} [props.valueFormatter]
 */
export default function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  hideLabel = false,
}) {
  if (!active || !payload?.length) return null;

  const heading = labelFormatter ? labelFormatter(label) : label;

  return (
    <Paper
      elevation={6}
      sx={{
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        minWidth: 132,
        pointerEvents: 'none',
        backgroundColor: 'background.paper',
      }}
    >
      {!hideLabel && heading != null && heading !== '' && (
        <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
          {heading}
        </Typography>
      )}

      <Stack spacing={0.5}>
        {payload.map((entry, index) => {
          const swatch = entry.color ?? entry.payload?.fill ?? entry.fill;

          return (
            <Stack
              key={`${entry.dataKey ?? entry.name ?? index}`}
              direction="row"
              alignItems="center"
              spacing={1}
            >
              <Box
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '2px',
                  flexShrink: 0,
                  backgroundColor: swatch,
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1, whiteSpace: 'nowrap' }}>
                {entry.name}
              </Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                {valueFormatter ? valueFormatter(entry.value, entry) : entry.value}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
    </Paper>
  );
}
