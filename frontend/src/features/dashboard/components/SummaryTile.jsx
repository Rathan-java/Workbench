import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

import { formatNumber } from '../../../utils/format.js';

/**
 * One tinted count in a summary strip.
 *
 * `value` may be a number (formatted) or a ready-made node — the follow-up strip
 * mixes counts with a percentage, and formatting a "78%" through formatNumber
 * would print an em dash.
 *
 * @param {object} props
 * @param {string} props.label
 * @param {number|React.ReactNode} props.value
 * @param {string} props.color   — a resolved theme colour.
 */
export default function SummaryTile({ label, value, color }) {
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        px: 1.5,
        py: 1.25,
        borderRadius: 1.5,
        textAlign: 'center',
        backgroundColor: alpha(color, 0.08),
        border: (theme) => `1px solid ${alpha(color, theme.palette.mode === 'light' ? 0.2 : 0.3)}`,
      }}
    >
      <Typography variant="h5" sx={{ color, lineHeight: 1.2 }}>
        {typeof value === 'number' ? formatNumber(value) : value}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {label}
      </Typography>
    </Box>
  );
}
