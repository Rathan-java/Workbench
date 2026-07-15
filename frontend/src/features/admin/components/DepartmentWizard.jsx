import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useFieldArray, useForm, useWatch, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/AddRounded';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHighOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';

import { departments as departmentsApi } from '../../../api/endpoints.js';
import { errorMessage, isActionable } from './apiError.js';
import { ColorField, OptionsChipEditor, WeekdayField } from './DepartmentFormControls.jsx';
import {
  DEFAULT_COLOR,
  DEFAULT_WEEKDAYS,
  EMPTY_FIELD,
  FIELD_TYPE_OPTIONS,
  STANDARD_DAY,
  departmentDetailsSchema,
  endMinuteFor,
  findOverlap,
  hasOptions,
  minutesToTime,
  overlapMessage,
  slotLabel,
  taskFieldSchema,
  timeSlotSchema,
  timeToMinutes,
  toFieldBody,
  workingSlotCount,
} from './departmentConfig.js';

const STEPS = ['Details', 'Working hours', 'Task fields'];

/** Which fields each step owns, so "Next" only validates what is on screen. */
const STEP_FIELDS = [
  ['code', 'name', 'description', 'colorHex', 'icon', 'requiredSlotsPerDay', 'workingWeekdays'],
  ['timeSlots'],
  ['fields'],
];

const wizardSchema = departmentDetailsSchema
  .extend({
    timeSlots: z.array(timeSlotSchema).min(1, 'Add at least one working hour').max(24),
    fields: z.array(taskFieldSchema).max(30),
  })
  .superRefine((values, ctx) => {
    const rows = values.timeSlots.map((slot) => ({
      label: slot.label,
      startMinute: timeToMinutes(slot.start),
      endMinute: endMinuteFor(slot.end),
    }));

    if (findOverlap(rows)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timeSlots'],
        message: 'Two working hours overlap',
      });
    }

    const keys = values.fields.map((field) => field.key.toLowerCase());
    keys.forEach((key, index) => {
      if (keys.indexOf(key) !== index) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', index, 'key'],
          message: 'Another field already uses this key',
        });
      }
    });
  });

const emptySlotRow = () => ({ label: '', start: '', end: '', isBreak: false });

/**
 * Creating a department is the whole payoff of modelling departments as data: the
 * hours and fields set up here BECOME that department's task-entry screen the
 * moment it is saved — its grid columns and its form — with no code change
 * anywhere. So the wizard is honest about that, step by step.
 */
export default function DepartmentWizard({ onClose, onCreated }) {
  const [activeStep, setActiveStep] = useState(0);
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    trigger,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(wizardSchema),
    mode: 'onTouched',
    defaultValues: {
      code: '',
      name: '',
      description: '',
      colorHex: DEFAULT_COLOR,
      icon: '',
      requiredSlotsPerDay: 7,
      workingWeekdays: [...DEFAULT_WEEKDAYS],
      timeSlots: [],
      fields: [],
    },
  });

  const slots = useFieldArray({ control, name: 'timeSlots' });
  const fields = useFieldArray({ control, name: 'fields' });

  const watchedSlots = useWatch({ control, name: 'timeSlots' });
  const watchedFields = useWatch({ control, name: 'fields' }) ?? [];
  const requiredSlotsPerDay = useWatch({ control, name: 'requiredSlotsPerDay' });

  const rows = useMemo(
    () =>
      (watchedSlots ?? []).map((slot) => ({
        label: slot.label || null,
        startMinute: timeToMinutes(slot.start),
        endMinute: endMinuteFor(slot.end),
        isBreak: slot.isBreak,
      })),
    [watchedSlots],
  );

  const complete = rows.filter(
    (row) => Number.isInteger(row.startMinute) && Number.isInteger(row.endMinute),
  );
  const overlap = findOverlap(complete);
  const workingCount = workingSlotCount(complete);

  /** The compliance target can't be met by a grid that has fewer columns than it. */
  const shortOfTarget =
    complete.length > 0 && Number(requiredSlotsPerDay) > workingCount ? workingCount : null;

  const mutation = useMutation({
    mutationFn: (values) =>
      departmentsApi.create({
        code: values.code,
        name: values.name,
        description: values.description,
        colorHex: values.colorHex,
        icon: values.icon,
        requiredSlotsPerDay: values.requiredSlotsPerDay,
        workingWeekdays: values.workingWeekdays,
        timeSlots: values.timeSlots.map((slot) => {
          const startMinute = timeToMinutes(slot.start);
          const endMinute = endMinuteFor(slot.end);

          return {
            // The API generates "10:00 - 11:00" itself when the label is omitted;
            // an empty string would be stored verbatim, so send nothing instead.
            label: slot.label || slotLabel(startMinute, endMinute),
            startMinute,
            endMinute,
            isBreak: slot.isBreak,
            isOvertime: false,
          };
        }),
        fields: values.fields.map(toFieldBody),
      }),
    onSuccess: (res) => onCreated(res.data),
    onError: (error) => setServerError(error),
  });

  const next = async () => {
    const valid = await trigger(STEP_FIELDS[activeStep]);
    if (valid) setActiveStep((step) => step + 1);
  };

  const fillStandardDay = () => {
    setValue(
      'timeSlots',
      STANDARD_DAY.map((slot) => ({
        label: slot.isBreak ? slot.label : '',
        start: minutesToTime(slot.startMinute),
        end: minutesToTime(slot.endMinute),
        isBreak: slot.isBreak,
      })),
      { shouldValidate: true, shouldDirty: true },
    );
  };

  const isLastStep = activeStep === STEPS.length - 1;

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="md" fullWidth>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <DialogTitle>New department</DialogTitle>

        <DialogContent dividers>
          <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
            {STEPS.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {serverError && isActionable(serverError) && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServerError(null)}>
              {errorMessage(serverError)}
            </Alert>
          )}

          {activeStep === 0 && (
            <Stack spacing={2.5}>
              <Alert severity="info" icon={false}>
                A department is not an enum — it is a row. Everything you set here becomes its
                employees&apos; task-entry screen: the hours they log against and the fields they
                fill in. No code change, no release.
              </Alert>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Controller
                  name="name"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Name"
                      fullWidth
                      error={Boolean(errors.name)}
                      helperText={errors.name?.message}
                      autoFocus
                    />
                  )}
                />
                <Controller
                  name="code"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Code"
                      fullWidth
                      onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                      error={Boolean(errors.code)}
                      helperText={
                        errors.code?.message ?? 'e.g. VIDEO_EDITING. Cannot be changed later.'
                      }
                    />
                  )}
                />
              </Stack>

              <Controller
                name="description"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Description (optional)"
                    multiline
                    minRows={2}
                    error={Boolean(errors.description)}
                    helperText={errors.description?.message}
                  />
                )}
              />

              <Controller
                name="colorHex"
                control={control}
                render={({ field }) => (
                  <ColorField
                    value={field.value}
                    onChange={field.onChange}
                    error={Boolean(errors.colorHex)}
                    helperText={
                      errors.colorHex?.message ??
                      'The accent this department wears everywhere in the app.'
                    }
                  />
                )}
              />

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Controller
                  name="icon"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Icon (optional)"
                      fullWidth
                      error={Boolean(errors.icon)}
                      helperText={errors.icon?.message ?? 'A short icon name, e.g. movie'}
                    />
                  )}
                />
                <Controller
                  name="requiredSlotsPerDay"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Required hours per day"
                      type="number"
                      fullWidth
                      slotProps={{ htmlInput: { min: 1, max: 24 } }}
                      error={Boolean(errors.requiredSlotsPerDay)}
                      helperText={
                        errors.requiredSlotsPerDay?.message ??
                        'How many hours must be filled for a day to count as complete.'
                      }
                    />
                  )}
                />
              </Stack>

              <Controller
                name="workingWeekdays"
                control={control}
                render={({ field }) => (
                  <WeekdayField
                    value={field.value}
                    onChange={field.onChange}
                    error={Boolean(errors.workingWeekdays)}
                    helperText={
                      errors.workingWeekdays?.message ??
                      'Days this department is expected to log work.'
                    }
                  />
                )}
              />
            </Stack>
          )}

          {activeStep === 1 && (
            <Stack spacing={2}>
              <Alert severity="info" icon={false}>
                These are the COLUMNS of the department&apos;s task grid. An employee gets one row
                per hour and logs what they did in it, so the hours you add here are literally the
                shape of their day.
              </Alert>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AutoFixHighIcon fontSize="small" />}
                  onClick={fillStandardDay}
                >
                  Use a standard working day
                </Button>
                <Button
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => slots.append(emptySlotRow())}
                  disabled={slots.fields.length >= 24}
                >
                  Add an hour
                </Button>
              </Stack>

              {overlap && <Alert severity="error">{overlapMessage(overlap)}</Alert>}

              {shortOfTarget !== null && (
                <Alert severity="warning">
                  This department requires {requiredSlotsPerDay} hours a day but only has{' '}
                  {shortOfTarget} working {shortOfTarget === 1 ? 'column' : 'columns'} (breaks
                  don&apos;t count). Nobody would ever be able to complete a day.
                </Alert>
              )}

              {slots.fields.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    No working hours yet. Start from a standard day and adjust, or add them one by
                    one.
                  </Typography>
                  {errors.timeSlots?.message && (
                    <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
                      {errors.timeSlots.message}
                    </Typography>
                  )}
                </Paper>
              ) : (
                <Stack spacing={1}>
                  {slots.fields.map((row, index) => (
                    <SlotRow
                      key={row.id}
                      control={control}
                      index={index}
                      errors={errors.timeSlots?.[index]}
                      preview={rows[index]}
                      onRemove={() => slots.remove(index)}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          )}

          {activeStep === 2 && (
            <Stack spacing={2}>
              <Alert severity="info" icon={false}>
                <AlertTitle sx={{ fontSize: 14 }}>Optional — you can add these later</AlertTitle>
                Fields appear on this department&apos;s task form and nowhere else. Video Editing
                asks for a render time; Marketing asks for ad spend. Same app, different form.
              </Alert>

              <Box>
                <Button
                  size="small"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => fields.append({ ...EMPTY_FIELD, options: [] })}
                  disabled={fields.fields.length >= 30}
                >
                  Add a field
                </Button>
              </Box>

              {fields.fields.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.secondary">
                    No custom fields. The department still gets the standard task form — description,
                    status, priority, project.
                  </Typography>
                </Paper>
              ) : (
                <Stack spacing={1.5}>
                  {fields.fields.map((row, index) => (
                    <FieldRow
                      key={row.id}
                      control={control}
                      index={index}
                      errors={errors.fields?.[index]}
                      type={watchedFields[index]?.type}
                      onRemove={() => fields.remove(index)}
                    />
                  ))}
                </Stack>
              )}
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
            Cancel
          </Button>

          <Box sx={{ flex: 1 }} />

          {activeStep > 0 && (
            <Button
              onClick={() => setActiveStep((step) => step - 1)}
              color="inherit"
              disabled={mutation.isPending}
            >
              Back
            </Button>
          )}

          {isLastStep ? (
            <Button type="submit" variant="contained" disabled={mutation.isPending}>
              Create department
            </Button>
          ) : (
            <Button onClick={next} variant="contained">
              Next
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}

function SlotRow({ control, index, errors, preview, onRemove }) {
  const complete =
    Number.isInteger(preview?.startMinute) && Number.isInteger(preview?.endMinute);

  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
        <Typography variant="caption" color="text.disabled" sx={{ width: 20 }}>
          {index + 1}
        </Typography>

        <Controller
          name={`timeSlots.${index}.start`}
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="From"
              type="time"
              size="small"
              sx={{ width: { xs: '100%', md: 130 } }}
              error={Boolean(errors?.start)}
              helperText={errors?.start?.message}
            />
          )}
        />

        <Controller
          name={`timeSlots.${index}.end`}
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="To"
              type="time"
              size="small"
              sx={{ width: { xs: '100%', md: 130 } }}
              error={Boolean(errors?.end)}
              helperText={errors?.end?.message}
            />
          )}
        />

        <Controller
          name={`timeSlots.${index}.label`}
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Label (optional)"
              size="small"
              fullWidth
              placeholder={complete ? slotLabel(preview.startMinute, preview.endMinute) : '10:00 - 11:00'}
              error={Boolean(errors?.label)}
              helperText={errors?.label?.message}
            />
          )}
        />

        <Controller
          name={`timeSlots.${index}.isBreak`}
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Checkbox {...field} checked={field.value} size="small" />}
              label={<Typography variant="body2">Break</Typography>}
              sx={{ mr: 0, flexShrink: 0 }}
            />
          )}
        />

        <IconButton size="small" color="error" onClick={onRemove} aria-label={`Remove hour ${index + 1}`}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  );
}

function FieldRow({ control, index, errors, type, onRemove }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
          <Controller
            name={`fields.${index}.label`}
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Label"
                size="small"
                fullWidth
                error={Boolean(errors?.label)}
                helperText={errors?.label?.message ?? 'What the employee sees'}
              />
            )}
          />

          <Controller
            name={`fields.${index}.key`}
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Key"
                size="small"
                fullWidth
                error={Boolean(errors?.key)}
                helperText={errors?.key?.message ?? 'e.g. renderMinutes. Immutable once used.'}
              />
            )}
          />

          <Controller
            name={`fields.${index}.type`}
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                select
                label="Type"
                size="small"
                sx={{ width: { xs: '100%', sm: 210 }, flexShrink: 0 }}
                error={Boolean(errors?.type)}
                helperText={errors?.type?.message}
              >
                {FIELD_TYPE_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            )}
          />

          <IconButton
            size="small"
            color="error"
            onClick={onRemove}
            aria-label={`Remove field ${index + 1}`}
            sx={{ mt: { sm: 0.5 } }}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Stack>

        {hasOptions(type) && (
          <Controller
            name={`fields.${index}.options`}
            control={control}
            render={({ field }) => (
              <OptionsChipEditor
                value={field.value}
                onChange={field.onChange}
                error={Boolean(errors?.options)}
                helperText={errors?.options?.message}
              />
            )}
          />
        )}

        <Divider />

        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          <Controller
            name={`fields.${index}.isRequired`}
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox {...field} checked={field.value} size="small" />}
                label={<Typography variant="body2">Required</Typography>}
              />
            )}
          />
          <Controller
            name={`fields.${index}.showInTable`}
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox {...field} checked={field.value} size="small" />}
                label={<Typography variant="body2">Show as a grid column</Typography>}
              />
            )}
          />
        </Stack>
      </Stack>
    </Paper>
  );
}
