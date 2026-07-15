import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import RadioButtonUncheckedRoundedIcon from '@mui/icons-material/RadioButtonUncheckedRounded';
import { alpha } from '@mui/material/styles';
import { PASSWORD_RULES } from './passwordSchema.js';

/**
 * The live password policy checklist. Shared by the reset, force-change and
 * security-tab forms — the policy is one thing, so it renders from one place.
 *
 * It ticks as the user types rather than waiting for a submit: a composition
 * rule the user only discovers *after* failing is a rule that feels arbitrary.
 *
 * @param {object}  props
 * @param {string}  props.value    the password being typed
 * @param {boolean} [props.dense]  tighter spacing, for use inside a card
 */
export default function PasswordPolicy({ value = '', dense = false, sx }) {
  return (
    <Box
      component="ul"
      aria-label="Password requirements"
      sx={{
        listStyle: 'none',
        m: 0,
        p: dense ? 1.25 : 1.5,
        display: 'grid',
        gap: dense ? 0.25 : 0.5,
        borderRadius: 2,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        bgcolor: (theme) =>
          theme.palette.mode === 'light'
            ? alpha(theme.palette.slate[500], 0.04)
            : alpha(theme.palette.slate[100], 0.03),
        ...sx,
      }}
    >
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        const Icon = met ? CheckCircleRoundedIcon : RadioButtonUncheckedRoundedIcon;

        return (
          <Box
            key={rule.id}
            component="li"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
          >
            <Icon
              sx={{
                fontSize: 15,
                flexShrink: 0,
                color: met ? 'success.main' : 'text.disabled',
                transition: 'color 150ms ease',
              }}
            />
            <Typography
              variant="caption"
              sx={{
                color: met ? 'text.primary' : 'text.secondary',
                textDecoration: 'none',
                transition: 'color 150ms ease',
              }}
            >
              {rule.label}
            </Typography>
            {/* Screen readers get the state explicitly; the colour alone is not a message. */}
            <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
              {met ? 'met' : 'not met'}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
