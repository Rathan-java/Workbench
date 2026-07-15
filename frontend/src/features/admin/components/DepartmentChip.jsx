import Chip from '@mui/material/Chip';
import { alpha, lighten, useTheme } from '@mui/material/styles';

/**
 * A department's identity is its colour — the same four hues appear on every
 * admin screen, so they come from `department.colorHex` (seeded per department)
 * rather than from the theme palette.
 *
 * The seeded hex values are chosen for a white background. On #020617 a 600-weight
 * hue reads as mud, so dark mode lifts the foreground into the 300/400 band and
 * drops the tint opacity — the same trick theme.js uses for status chips.
 */
export default function DepartmentChip({ department, size = 'small', variant = 'filled', sx, ...rest }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  if (!department) {
    return (
      <Chip
        size={size}
        label="No department"
        sx={{ color: 'text.disabled', bgcolor: 'action.hover', ...sx }}
        {...rest}
      />
    );
  }

  const base = /^#[0-9A-Fa-f]{6}$/.test(department.colorHex ?? '')
    ? department.colorHex
    : theme.palette.primary.main;

  const color = isDark ? lighten(base, 0.35) : base;

  return (
    <Chip
      size={size}
      label={department.name ?? department.code}
      sx={{
        color,
        backgroundColor: variant === 'filled' ? alpha(color, isDark ? 0.16 : 0.1) : 'transparent',
        border: variant === 'outlined' ? `1px solid ${alpha(color, 0.5)}` : '1px solid transparent',
        fontWeight: 500,
        maxWidth: 180,
        ...sx,
      }}
      {...rest}
    />
  );
}
