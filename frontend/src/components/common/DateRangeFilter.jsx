import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import InputAdornment from '@mui/material/InputAdornment';
import CalendarTodayOutlinedIcon from '@mui/icons-material/CalendarTodayOutlined';
import dayjs from 'dayjs';

import { RANGE_PRESETS, describeRange, resolveRange } from '../../utils/dateRange.js';
import { formatApiDate } from '../../utils/format.js';

/**
 * Preset + custom date-range control, shared by the dashboard and the reports
 * builder.
 *
 * `value` carries the raw filter state ({ preset, dateFrom, dateTo }); the
 * effective window is derived here so the caller never has to hold two copies
 * of the truth. Switching to "Custom" seeds the inputs from whatever the
 * previous preset resolved to, so the fields are never blank.
 *
 * Native `<input type="date">` on purpose — the project has no @mui/x-date-pickers
 * dependency, and adding a picker library for two fields is not a trade worth making.
 *
 * @param {object} props
 * @param {{preset?: string, dateFrom?: string, dateTo?: string}} props.value
 * @param {(next: {preset: string, dateFrom: string, dateTo: string}) => void} props.onChange
 */
export default function DateRangeFilter({
  value,
  onChange,
  size = 'small',
  disabled = false,
  showCaption = true,
  presetLabel = 'Period',
}) {
  const effective = resolveRange(value);
  const preset = value?.preset ?? 'last30';
  const isCustom = preset === 'custom';
  const today = formatApiDate(dayjs());

  const handlePreset = (event) => {
    const next = event.target.value;
    // Carry the resolved dates across so the custom inputs open pre-filled.
    onChange({ preset: next, ...(next === 'custom' ? effective : resolveRange({ preset: next })) });
  };

  /** An inverted range is corrected on entry rather than rejected on submit. */
  const handleFrom = (event) => {
    const dateFrom = event.target.value;
    if (!dateFrom) return;
    const dateTo = dayjs(dateFrom).isAfter(dayjs(effective.dateTo)) ? dateFrom : effective.dateTo;
    onChange({ preset: 'custom', dateFrom, dateTo });
  };

  const handleTo = (event) => {
    const dateTo = event.target.value;
    if (!dateTo) return;
    const dateFrom = dayjs(dateTo).isBefore(dayjs(effective.dateFrom)) ? dateTo : effective.dateFrom;
    onChange({ preset: 'custom', dateFrom, dateTo });
  };

  return (
    <Stack spacing={0.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        <TextField
          select
          size={size}
          label={presetLabel}
          value={preset}
          onChange={handlePreset}
          disabled={disabled}
          sx={{ minWidth: 168 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <CalendarTodayOutlinedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                </InputAdornment>
              ),
            },
          }}
        >
          {RANGE_PRESETS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>

        {isCustom && (
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField
              type="date"
              size={size}
              label="From"
              value={effective.dateFrom}
              onChange={handleFrom}
              disabled={disabled}
              sx={{ minWidth: 156 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
            />
            <Typography variant="body2" color="text.disabled">
              –
            </Typography>
            <TextField
              type="date"
              size={size}
              label="To"
              value={effective.dateTo}
              onChange={handleTo}
              disabled={disabled}
              sx={{ minWidth: 156 }}
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
            />
          </Stack>
        )}
      </Stack>

      {showCaption && !isCustom && (
        <Typography variant="caption" color="text.secondary" sx={{ pl: 0.5 }}>
          {describeRange(effective)}
        </Typography>
      )}
    </Stack>
  );
}
