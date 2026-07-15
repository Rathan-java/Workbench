import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import IconButton from '@mui/material/IconButton';
import SearchIcon from '@mui/icons-material/SearchOutlined';
import ClearIcon from '@mui/icons-material/CloseRounded';
import FilterAltOffIcon from '@mui/icons-material/FilterAltOffOutlined';

/** Wraps the row of filters every admin list screen puts above its table. */
export default function FilterBar({ children, onReset, canReset = false, sx }) {
  return (
    <Paper
      sx={{
        p: 1.5,
        mb: 2,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 1.5,
        ...sx,
      }}
    >
      {children}

      {onReset && (
        <Box sx={{ ml: { sm: 'auto' } }}>
          <Button
            size="small"
            color="inherit"
            startIcon={<FilterAltOffIcon fontSize="small" />}
            onClick={onReset}
            disabled={!canReset}
          >
            Reset
          </Button>
        </Box>
      )}
    </Paper>
  );
}

export function SearchField({ value, onChange, placeholder = 'Search…', width = 260, ...rest }) {
  return (
    <TextField
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      size="small"
      sx={{ width: { xs: '100%', sm: width } }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" sx={{ color: 'text.disabled' }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={() => onChange('')} aria-label="Clear search">
                <ClearIcon fontSize="small" />
              </IconButton>
            </InputAdornment>
          ) : null,
        },
      }}
      {...rest}
    />
  );
}

/**
 * @param {Array<{value: string, label: string}>} options
 */
export function SelectFilter({
  label,
  value,
  onChange,
  options = [],
  allLabel = 'All',
  width = 170,
  disabled = false,
  ...rest
}) {
  return (
    <TextField
      select
      label={label}
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      disabled={disabled}
      sx={{ width: { xs: '100%', sm: width } }}
      {...rest}
    >
      <MenuItem value="">{allLabel}</MenuItem>
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
