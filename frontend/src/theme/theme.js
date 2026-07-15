import { createTheme, alpha } from '@mui/material/styles';

/* ------------------------------------------------------------------ *
 * Design tokens
 * ------------------------------------------------------------------ */

/** Neutral slate ramp. Every surface, border and text colour derives from this. */
export const slate = {
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A',
  950: '#020617',
};

export const brand = {
  light: '#2563EB',
  dark: '#3B82F6',
};

const semantic = {
  light: {
    success: '#15803D',
    warning: '#B45309',
    error: '#DC2626',
    info: '#0369A1',
  },
  dark: {
    success: '#4ADE80',
    warning: '#FBBF24',
    error: '#F87171',
    info: '#38BDF8',
  },
};

/**
 * Soft, low-spread elevation. MUI's defaults are two stacked umbral/penumbral
 * shadows tuned for Material paper; at enterprise density they read as muddy.
 * These are a single tight ambient shadow plus a hairline, which is what the
 * Linear/Atlassian family of products actually use.
 */
const buildShadows = (mode) => {
  const c = mode === 'light' ? '15, 23, 42' : '0, 0, 0';
  const o = mode === 'light' ? 1 : 1.8;
  const s = [
    'none',
    `0 1px 2px 0 rgba(${c}, ${0.04 * o})`,
    `0 1px 3px 0 rgba(${c}, ${0.06 * o}), 0 1px 2px -1px rgba(${c}, ${0.04 * o})`,
    `0 2px 4px -1px rgba(${c}, ${0.06 * o}), 0 1px 2px -1px rgba(${c}, ${0.04 * o})`,
    `0 4px 6px -1px rgba(${c}, ${0.07 * o}), 0 2px 4px -2px rgba(${c}, ${0.05 * o})`,
    `0 6px 10px -2px rgba(${c}, ${0.08 * o}), 0 2px 6px -2px rgba(${c}, ${0.05 * o})`,
    `0 8px 16px -4px rgba(${c}, ${0.09 * o}), 0 4px 8px -4px rgba(${c}, ${0.05 * o})`,
    `0 12px 20px -6px rgba(${c}, ${0.1 * o}), 0 4px 10px -4px rgba(${c}, ${0.06 * o})`,
    `0 16px 28px -8px rgba(${c}, ${0.12 * o}), 0 6px 12px -6px rgba(${c}, ${0.06 * o})`,
  ];
  // MUI requires exactly 25 entries; saturate the tail with the deepest value.
  return Array.from({ length: 25 }, (_, i) => s[Math.min(i, s.length - 1)]);
};

/* ------------------------------------------------------------------ *
 * There are no task status / priority colour maps here any more.
 *
 * A task entry records an hour that has already been worked, so it has no
 * work-status to colour and no priority to rank. What a screen needs to colour
 * about an entry is its PROJECT and its department — both of which carry their
 * own configured colour from the API — and lateness, which is warning-amber.
 *
 * Approval state (TaskDay.status) is a different axis and is coloured by MUI's
 * semantic palette at the call site.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * Theme factory
 * ------------------------------------------------------------------ */

const buildPalette = (mode) => {
  const isLight = mode === 'light';
  const sem = semantic[mode];

  return {
    mode,
    primary: {
      main: isLight ? brand.light : brand.dark,
      light: isLight ? '#60A5FA' : '#93C5FD',
      dark: isLight ? '#1D4ED8' : '#2563EB',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: isLight ? slate[600] : slate[300],
      contrastText: isLight ? '#FFFFFF' : slate[900],
    },
    success: { main: sem.success, contrastText: '#FFFFFF' },
    warning: { main: sem.warning, contrastText: '#FFFFFF' },
    error: { main: sem.error, contrastText: '#FFFFFF' },
    info: { main: sem.info, contrastText: '#FFFFFF' },
    background: {
      default: isLight ? slate[50] : slate[950],
      paper: isLight ? '#FFFFFF' : slate[900],
    },
    text: {
      primary: isLight ? slate[900] : slate[100],
      secondary: isLight ? slate[500] : slate[400],
      disabled: isLight ? slate[400] : slate[600],
    },
    divider: isLight ? slate[200] : alpha(slate[300], 0.12),
    action: {
      hover: isLight ? alpha(slate[500], 0.05) : alpha(slate[100], 0.06),
      selected: isLight ? alpha(brand.light, 0.08) : alpha(brand.dark, 0.16),
      focus: isLight ? alpha(brand.light, 0.12) : alpha(brand.dark, 0.2),
    },
    slate,
  };
};

const typography = {
  fontFamily: [
    'Inter',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ].join(','),
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 650,
  // Tight tracking on headings; Inter's default tracking is tuned for body copy
  // and looks loose at display sizes.
  h1: { fontSize: '2.25rem', fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.2 },
  h2: { fontSize: '1.875rem', fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.25 },
  h3: { fontSize: '1.5rem', fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1.3 },
  h4: { fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.35 },
  h5: { fontSize: '1.0625rem', fontWeight: 600, letterSpacing: '-0.015em', lineHeight: 1.4 },
  h6: { fontSize: '0.9375rem', fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.45 },
  subtitle1: { fontSize: '0.9375rem', fontWeight: 500, lineHeight: 1.5 },
  subtitle2: { fontSize: '0.8125rem', fontWeight: 600, lineHeight: 1.5 },
  body1: { fontSize: '0.875rem', lineHeight: 1.6 },
  body2: { fontSize: '0.8125rem', lineHeight: 1.55 },
  button: { fontSize: '0.875rem', fontWeight: 600, letterSpacing: 0, textTransform: 'none' },
  caption: { fontSize: '0.75rem', lineHeight: 1.45, letterSpacing: '0.01em' },
  overline: {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    lineHeight: 1.4,
  },
};

const buildComponents = (mode, palette) => {
  const isLight = mode === 'light';
  const border = `1px solid ${palette.divider}`;

  return {
    MuiCssBaseline: {
      styleOverrides: {
        '*, *::before, *::after': { boxSizing: 'border-box' },
        html: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
        body: { backgroundColor: palette.background.default },
        // Slim scrollbars — full-width native bars break the density illusion.
        '::-webkit-scrollbar': { width: 10, height: 10 },
        '::-webkit-scrollbar-track': { background: 'transparent' },
        '::-webkit-scrollbar-thumb': {
          backgroundColor: isLight ? slate[300] : slate[700],
          borderRadius: 8,
          border: `2px solid ${palette.background.default}`,
        },
        '::-webkit-scrollbar-thumb:hover': {
          backgroundColor: isLight ? slate[400] : slate[600],
        },
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: 8,
          padding: '6px 14px',
          transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
        },
        sizeSmall: { padding: '4px 10px', fontSize: '0.8125rem' },
        sizeLarge: { padding: '9px 20px', fontSize: '0.9375rem' },
        contained: {
          '&:hover': { boxShadow: 'none' },
        },
        outlined: {
          borderColor: isLight ? slate[300] : alpha(slate[300], 0.2),
          color: palette.text.primary,
          '&:hover': {
            borderColor: isLight ? slate[400] : alpha(slate[300], 0.35),
            backgroundColor: palette.action.hover,
          },
        },
        text: {
          '&:hover': { backgroundColor: palette.action.hover },
        },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border,
        },
        // An explicitly elevated Paper (menus, popovers) opts back into shadow.
        elevation1: { border, boxShadow: 'none' },
      },
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border,
          borderRadius: 12,
          backgroundImage: 'none',
        },
      },
    },

    MuiCardHeader: {
      styleOverrides: {
        root: { padding: '16px 20px 8px' },
        title: { fontSize: '0.9375rem', fontWeight: 600, letterSpacing: '-0.01em' },
        subheader: { fontSize: '0.8125rem', color: palette.text.secondary },
      },
    },

    MuiCardContent: {
      styleOverrides: {
        root: { padding: '12px 20px 20px', '&:last-child': { paddingBottom: 20 } },
      },
    },

    MuiTextField: {
      defaultProps: { variant: 'outlined', size: 'small', fullWidth: true },
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: isLight ? '#FFFFFF' : alpha(slate[950], 0.4),
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: isLight ? slate[300] : alpha(slate[300], 0.16),
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: isLight ? slate[400] : alpha(slate[300], 0.28),
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: palette.primary.main,
          },
          '&.Mui-focused': {
            boxShadow: `0 0 0 3px ${alpha(palette.primary.main, isLight ? 0.12 : 0.24)}`,
          },
        },
        input: { fontSize: '0.875rem', padding: '9px 12px' },
        inputSizeSmall: { padding: '8px 12px' },
      },
    },

    MuiInputLabel: {
      styleOverrides: {
        root: { fontSize: '0.875rem' },
      },
    },

    MuiFormHelperText: {
      styleOverrides: {
        root: { fontSize: '0.75rem', marginLeft: 2 },
      },
    },

    MuiTable: {
      defaultProps: { size: 'small' },
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '10px 16px',
          fontSize: '0.8125rem',
          borderBottom: `1px solid ${palette.divider}`,
        },
        head: {
          fontSize: '0.6875rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: palette.text.secondary,
          backgroundColor: isLight ? slate[50] : alpha(slate[800], 0.5),
          whiteSpace: 'nowrap',
          lineHeight: 1.5,
        },
        sizeSmall: { padding: '8px 14px' },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child td': { borderBottom: 0 },
          '&.MuiTableRow-hover:hover': { backgroundColor: palette.action.hover },
        },
      },
    },

    MuiTableSortLabel: {
      styleOverrides: {
        root: {
          '&.Mui-active': { color: palette.text.primary },
        },
      },
    },

    MuiChip: {
      defaultProps: { size: 'small' },
      styleOverrides: {
        root: {
          fontWeight: 500,
          fontSize: '0.75rem',
          borderRadius: 6,
          height: 22,
        },
        sizeSmall: { height: 22 },
        label: { paddingLeft: 8, paddingRight: 8 },
      },
    },

    MuiTooltip: {
      defaultProps: { arrow: true, enterDelay: 400 },
      styleOverrides: {
        tooltip: {
          backgroundColor: isLight ? slate[800] : slate[700],
          color: '#FFFFFF',
          fontSize: '0.75rem',
          fontWeight: 500,
          borderRadius: 6,
          padding: '6px 10px',
          boxShadow: `0 4px 12px -2px ${alpha('#0F172A', 0.2)}`,
        },
        arrow: { color: isLight ? slate[800] : slate[700] },
      },
    },

    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'transparent' },
      styleOverrides: {
        root: {
          backgroundColor: alpha(palette.background.paper, isLight ? 0.8 : 0.7),
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          borderBottom: border,
          boxShadow: 'none',
          color: palette.text.primary,
        },
      },
    },

    MuiToolbar: {
      styleOverrides: {
        root: { minHeight: 56, '@media (min-width:600px)': { minHeight: 56 } },
      },
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: palette.background.paper,
          backgroundImage: 'none',
          borderRight: border,
        },
      },
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          marginInline: 8,
          paddingBlock: 7,
          '&.Mui-selected': {
            backgroundColor: palette.action.selected,
            color: palette.primary.main,
            '& .MuiListItemIcon-root': { color: palette.primary.main },
            '&:hover': { backgroundColor: palette.action.selected },
          },
        },
      },
    },

    MuiListItemIcon: {
      styleOverrides: {
        root: { minWidth: 34, color: palette.text.secondary },
      },
    },

    MuiListItemText: {
      styleOverrides: {
        primary: { fontSize: '0.875rem', fontWeight: 500 },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 40, borderBottom: border },
        indicator: { height: 2, borderRadius: 2 },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          fontSize: '0.875rem',
          minHeight: 40,
          padding: '8px 14px',
          color: palette.text.secondary,
          '&.Mui-selected': { color: palette.primary.main },
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 12, boxShadow: buildShadows(mode)[8] },
      },
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: { fontSize: '1.0625rem', fontWeight: 600, letterSpacing: '-0.015em', padding: '20px 24px 8px' },
      },
    },

    MuiDialogContent: {
      styleOverrides: { root: { padding: '8px 24px' } },
    },

    MuiDialogActions: {
      styleOverrides: { root: { padding: '16px 24px 20px', gap: 8 } },
    },

    MuiMenu: {
      styleOverrides: {
        paper: { borderRadius: 10, boxShadow: buildShadows(mode)[6], marginTop: 4 },
      },
    },

    MuiMenuItem: {
      styleOverrides: {
        root: { fontSize: '0.875rem', borderRadius: 6, marginInline: 6, minHeight: 36 },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8, fontSize: '0.875rem', border },
      },
    },

    MuiSkeleton: {
      defaultProps: { animation: 'wave' },
      styleOverrides: {
        root: { backgroundColor: isLight ? slate[200] : alpha(slate[100], 0.08), borderRadius: 6 },
      },
    },

    MuiDivider: {
      styleOverrides: { root: { borderColor: palette.divider } },
    },

    MuiTablePagination: {
      styleOverrides: {
        root: { borderTop: border, fontSize: '0.8125rem' },
        selectLabel: { fontSize: '0.8125rem' },
        displayedRows: { fontSize: '0.8125rem' },
      },
    },
  };
};

/**
 * @param {'light'|'dark'} mode
 * @returns {import('@mui/material/styles').Theme}
 */
export const createAppTheme = (mode = 'light') => {
  const palette = buildPalette(mode);

  return createTheme({
    palette,
    typography,
    shape: { borderRadius: 8 },
    shadows: buildShadows(mode),
    spacing: 8,
    components: buildComponents(mode, palette),
  });
};

export default createAppTheme;
