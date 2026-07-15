import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { alpha } from '@mui/material/styles';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import LightModeRoundedIcon from '@mui/icons-material/LightModeRounded';
import DarkModeRoundedIcon from '@mui/icons-material/DarkModeRounded';
import { useThemeMode } from '../../theme/ThemeModeContext.jsx';

const FEATURES = [
  { icon: TaskAltRoundedIcon, text: 'Daily task sheets with a full approval trail' },
  { icon: InsightsRoundedIcon, text: 'Live productivity across teams and departments' },
  { icon: ShieldRoundedIcon, text: 'Role-scoped access, audited end to end' },
];

/**
 * The shell every unauthenticated screen sits in.
 *
 * Two panels: a branded gradient on the left that carries the product story, and
 * a plain, quiet card on the right that carries the form. The left panel is
 * `display: none` below `md` — on a phone it would push the form below the fold,
 * and nobody signs in to read marketing copy.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.footer]
 */
export default function AuthLayout({ title, subtitle, children, footer }) {
  const { mode, toggleMode } = useThemeMode();

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        // The brand panel is fixed-ish and the form panel takes the rest, so the
        // card stays optically centred instead of drifting on ultrawide screens.
        gridTemplateColumns: { xs: '1fr', md: 'minmax(360px, 44%) 1fr' },
        bgcolor: 'background.default',
      }}
    >
      {/* ---------------------------------------------------------------- *
       * Left: brand panel
       * ---------------------------------------------------------------- */}
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'relative',
          overflow: 'hidden',
          p: 6,
          color: '#FFFFFF',
          background: (theme) =>
            `linear-gradient(150deg, ${theme.palette.primary.dark} 0%, ${theme.palette.primary.main} 45%, ${
              theme.palette.mode === 'light' ? '#1E3A8A' : '#0B1B3F'
            } 100%)`,
        }}
      >
        {/* Two soft radial washes lift the flat gradient — a single linear ramp
            reads as a cheap CSS background at this size. */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `
              radial-gradient(60% 50% at 85% 8%, ${alpha('#FFFFFF', 0.16)} 0%, transparent 60%),
              radial-gradient(50% 45% at 5% 95%, ${alpha('#0F172A', 0.35)} 0%, transparent 55%)
            `,
          }}
        />

        <Stack direction="row" alignItems="center" spacing={1.25} sx={{ position: 'relative' }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 2,
              display: 'grid',
              placeItems: 'center',
              bgcolor: alpha('#FFFFFF', 0.16),
              border: `1px solid ${alpha('#FFFFFF', 0.24)}`,
              fontWeight: 700,
              fontSize: '0.9375rem',
              letterSpacing: '-0.02em',
            }}
          >
            A
          </Box>
          <Typography sx={{ fontWeight: 650, letterSpacing: '-0.01em', fontSize: '1rem' }}>
            Ara Workbench
          </Typography>
        </Stack>

        <Box sx={{ position: 'relative', maxWidth: 460 }}>
          <Typography
            variant="h2"
            sx={{ fontWeight: 650, letterSpacing: '-0.025em', lineHeight: 1.15 }}
          >
            Every task, every day, accounted for.
          </Typography>

          <Typography
            sx={{
              mt: 2,
              fontSize: '0.9375rem',
              lineHeight: 1.65,
              color: alpha('#FFFFFF', 0.75),
            }}
          >
            The single place your teams log work, submit it for review, and see where the day
            actually went.
          </Typography>

          <Stack spacing={1.75} sx={{ mt: 5 }}>
            {FEATURES.map(({ icon: Icon, text }) => (
              <Stack key={text} direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    bgcolor: alpha('#FFFFFF', 0.12),
                  }}
                >
                  <Icon sx={{ fontSize: 15, color: alpha('#FFFFFF', 0.9) }} />
                </Box>
                <Typography
                  variant="body2"
                  sx={{ color: alpha('#FFFFFF', 0.82), fontSize: '0.875rem' }}
                >
                  {text}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>

        <Typography
          variant="caption"
          sx={{ position: 'relative', color: alpha('#FFFFFF', 0.55) }}
        >
          © {new Date().getFullYear()} Ara. All rights reserved.
        </Typography>
      </Box>

      {/* ---------------------------------------------------------------- *
       * Right: the form
       * ---------------------------------------------------------------- */}
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 2.5, sm: 4 },
        }}
      >
        <Tooltip title={mode === 'light' ? 'Dark mode' : 'Light mode'}>
          <IconButton
            onClick={toggleMode}
            size="small"
            sx={{ position: 'absolute', top: 16, right: 16, color: 'text.secondary' }}
            aria-label="Toggle colour mode"
          >
            {mode === 'light' ? (
              <DarkModeRoundedIcon sx={{ fontSize: 18 }} />
            ) : (
              <LightModeRoundedIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Tooltip>

        <Box sx={{ width: '100%', maxWidth: 420 }}>
          {/* The wordmark only appears here when the brand panel is hidden. */}
          <Stack
            direction="row"
            alignItems="center"
            spacing={1.25}
            sx={{ display: { xs: 'flex', md: 'none' }, mb: 4 }}
          >
            <Box
              sx={{
                width: 30,
                height: 30,
                borderRadius: 2,
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
                fontWeight: 700,
                fontSize: '0.875rem',
              }}
            >
              A
            </Box>
            <Typography sx={{ fontWeight: 650, letterSpacing: '-0.01em' }}>
              Ara Workbench
            </Typography>
          </Stack>

          <Paper
            sx={{
              p: { xs: 2.5, sm: 4 },
              borderRadius: 3,
              boxShadow: (theme) => theme.shadows[2],
            }}
          >
            <Box sx={{ mb: 3 }}>
              <Typography variant="h3" component="h1" sx={{ fontSize: '1.5rem' }}>
                {title}
              </Typography>
              {subtitle && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {subtitle}
                </Typography>
              )}
            </Box>

            {children}
          </Paper>

          {footer && (
            <Box sx={{ mt: 3, textAlign: 'center' }}>
              {footer}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
