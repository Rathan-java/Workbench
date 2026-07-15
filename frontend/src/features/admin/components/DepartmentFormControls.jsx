import { useState } from 'react';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormHelperText from '@mui/material/FormHelperText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

import { PRESET_COLORS, WEEKDAYS } from './departmentConfig.js';

/**
 * Eight presets for speed, a native picker for the brand hue nobody guessed.
 * The department's colour is its identity everywhere in the app — the sidebar
 * accent, the chips, the cards — so it is worth a real control rather than a
 * text field the admin has to type a hex code into.
 */
export function ColorField({ value, onChange, error, helperText }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Colour
      </Typography>

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        {PRESET_COLORS.map((color) => {
          const selected = color.toUpperCase() === (value ?? '').toUpperCase();

          return (
            <Tooltip key={color} title={color}>
              <Box
                component="button"
                type="button"
                aria-label={`Use ${color}`}
                aria-pressed={selected}
                onClick={() => onChange(color)}
                sx={(theme) => ({
                  width: 30,
                  height: 30,
                  p: 0,
                  borderRadius: '50%',
                  cursor: 'pointer',
                  bgcolor: color,
                  border: selected
                    ? `2px solid ${theme.palette.text.primary}`
                    : `1px solid ${alpha(theme.palette.common.black, 0.15)}`,
                  outline: selected ? `2px solid ${alpha(color, 0.35)}` : 'none',
                  outlineOffset: 2,
                  transition: theme.transitions.create(['transform', 'border-color']),
                  '&:hover': { transform: 'scale(1.08)' },
                })}
              />
            </Tooltip>
          );
        })}

        <Box
          component="input"
          type="color"
          aria-label="Pick a custom colour"
          value={value ?? '#2563EB'}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          sx={{
            width: 40,
            height: 30,
            p: 0,
            border: 0,
            bgcolor: 'transparent',
            cursor: 'pointer',
          }}
        />

        <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'monospace' }}>
          {value}
        </Typography>
      </Stack>

      {helperText && <FormHelperText error={error}>{helperText}</FormHelperText>}
    </Box>
  );
}

/** ISO weekdays: Monday is 1, Sunday is 7 — the numbers the API stores. */
export function WeekdayField({ value = [], onChange, error, helperText }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Working days
      </Typography>

      <ToggleButtonGroup
        value={value}
        onChange={(_event, next) => onChange([...next].sort((a, b) => a - b))}
        size="small"
        sx={{ flexWrap: 'wrap' }}
      >
        {WEEKDAYS.map((day) => (
          <ToggleButton key={day.value} value={day.value} sx={{ px: 1.75 }}>
            {day.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {helperText && <FormHelperText error={error}>{helperText}</FormHelperText>}
    </Box>
  );
}

/**
 * The choices behind a SELECT / MULTISELECT field. Enter adds, backspace on an
 * empty box removes the last one — the two gestures anyone typing a list expects.
 */
export function OptionsChipEditor({ value = [], onChange, error, helperText }) {
  const [draft, setDraft] = useState('');

  const commit = () => {
    const option = draft.trim();
    if (!option) return;
    // Silently dropping a duplicate beats letting a form show the same choice twice.
    if (!value.includes(option)) onChange([...value, option]);
    setDraft('');
  };

  return (
    <Box>
      <TextField
        label="Choices"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        size="small"
        fullWidth
        error={error}
        helperText={helperText ?? 'Type a choice and press Enter'}
      />

      {value.length > 0 && (
        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {value.map((option) => (
            <Chip
              key={option}
              label={option}
              size="small"
              onDelete={() => onChange(value.filter((item) => item !== option))}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}
