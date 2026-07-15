import Chip from '@mui/material/Chip';
import { alpha, useTheme } from '@mui/material/styles';
import { toneHex } from './tones.js';

/** Tinted chip for roles, user status, project status and audit action families. */
export default function ToneChip({ tone = 'neutral', label, size = 'small', variant = 'filled', sx, ...rest }) {
  const theme = useTheme();
  const color = toneHex(tone, theme);
  const isDark = theme.palette.mode === 'dark';

  return (
    <Chip
      size={size}
      label={label}
      sx={{
        color,
        backgroundColor: variant === 'filled' ? alpha(color, isDark ? 0.16 : 0.1) : 'transparent',
        border: variant === 'outlined' ? `1px solid ${alpha(color, 0.5)}` : '1px solid transparent',
        fontWeight: 500,
        ...sx,
      }}
      {...rest}
    />
  );
}
