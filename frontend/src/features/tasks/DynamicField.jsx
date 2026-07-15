/**
 * Renders ONE department-specific task field from its server-side definition.
 *
 * This component is the client half of the schema-driven design. The server
 * ships a list of TaskFieldDefinition rows for the employee's department; this
 * turns each one into the right control. Consequently:
 *
 *   - A Tech engineer's form grows a "Ticket / PR Reference" text box.
 *   - A marketer's grows "Channel", "Campaign" and "Ad Spend (₹)".
 *   - A social media exec's grows a multi-select "Platform".
 *   - An editor's grows "Edit Stage" and a "Render Time" duration.
 *
 * …and nobody wrote four forms. Adding a fifth department, or a new field to an
 * existing one, is a row in the database. This file does not change.
 */
import {
  TextField,
  MenuItem,
  Checkbox,
  FormControlLabel,
  Autocomplete,
  Chip,
  InputAdornment,
} from '@mui/material';
import { FIELD_TYPE } from '../../utils/constants.js';

/**
 * @param {object} props
 * @param {object} props.field  A TaskFieldDefinition from the API.
 * @param {*} props.value
 * @param {(value: *) => void} props.onChange
 * @param {string} [props.error]
 * @param {boolean} [props.disabled]
 */
export default function DynamicField({ field, value, onChange, error, disabled }) {
  const common = {
    label: field.label,
    error: Boolean(error),
    helperText: error ?? field.helpText ?? ' ',
    disabled,
    fullWidth: true,
    size: 'small',
    required: field.isRequired,
  };

  switch (field.type) {
    case FIELD_TYPE.SELECT:
      return (
        <TextField
          {...common}
          select
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          {/* An explicit "clear" option: a required-looking select with no way
              back to empty is a trap for a user who picked the wrong thing. */}
          {!field.isRequired && (
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
          )}
          {(field.options ?? []).map((option) => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </TextField>
      );

    case FIELD_TYPE.MULTISELECT:
      return (
        <Autocomplete
          multiple
          disableCloseOnSelect
          options={field.options ?? []}
          value={Array.isArray(value) ? value : []}
          onChange={(_e, next) => onChange(next.length ? next : null)}
          disabled={disabled}
          size="small"
          renderTags={(tags, getTagProps) =>
            tags.map((tag, index) => {
              const { key, ...chipProps } = getTagProps({ index });
              return <Chip key={key} label={tag} size="small" {...chipProps} />;
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label={field.label}
              required={field.isRequired}
              error={Boolean(error)}
              helperText={error ?? field.helpText ?? ' '}
              placeholder={field.placeholder}
            />
          )}
        />
      );

    case FIELD_TYPE.NUMBER:
      return (
        <TextField
          {...common}
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          inputProps={{ min: field.minValue ?? undefined, max: field.maxValue ?? undefined }}
          placeholder={field.placeholder}
        />
      );

    case FIELD_TYPE.DURATION_MINUTES:
      return (
        <TextField
          {...common}
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          inputProps={{ min: field.minValue ?? 0, max: field.maxValue ?? 1440 }}
          InputProps={{
            endAdornment: <InputAdornment position="end">min</InputAdornment>,
          }}
        />
      );

    case FIELD_TYPE.BOOLEAN:
      return (
        <FormControlLabel
          control={
            <Checkbox
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
              size="small"
            />
          }
          label={field.label}
        />
      );

    case FIELD_TYPE.DATE:
      return (
        <TextField
          {...common}
          type="date"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          InputLabelProps={{ shrink: true }}
        />
      );

    case FIELD_TYPE.URL:
      return (
        <TextField
          {...common}
          type="url"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={field.placeholder ?? 'https://'}
        />
      );

    case FIELD_TYPE.TEXTAREA:
      return (
        <TextField
          {...common}
          multiline
          minRows={2}
          maxRows={5}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={field.placeholder}
          inputProps={{ maxLength: field.maxLength ?? 2000 }}
        />
      );

    case FIELD_TYPE.TEXT:
    default:
      return (
        <TextField
          {...common}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder={field.placeholder}
          inputProps={{ maxLength: field.maxLength ?? 255 }}
        />
      );
  }
}
