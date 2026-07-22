import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditIcon from '@mui/icons-material/EditOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import ViewListIcon from '@mui/icons-material/ViewListOutlined';

import EmptyState from '../../../components/common/EmptyState.jsx';
import Guard from '../../../components/common/Guard.jsx';
import { useConfirm } from '../../../components/common/ConfirmDialog.jsx';
import { departments as departmentsApi } from '../../../api/endpoints.js';
import { PERMISSIONS } from '../../../utils/constants.js';

import ToneChip from './ToneChip.jsx';
import { errorMessage, isActionable } from './apiError.js';
import { ColorField, OptionsChipEditor, WeekdayField } from './DepartmentFormControls.jsx';
import {
  FIELD_TYPE_OPTIONS,
  EMPTY_FIELD,
  bySortOrder,
  departmentConfigKey,
  departmentEditSchema,
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
} from './departmentConfig.js';

const TABS = ['Details', 'Working hours', 'Task fields'];

export default function DepartmentDrawer({ departmentId, onClose, onDeleteRequest }) {
  const [tab, setTab] = useState(0);

  const configQuery = useQuery({
    queryKey: departmentConfigKey(departmentId),
    queryFn: () => departmentsApi.config(departmentId).then((res) => res.data),
  });

  const department = configQuery.data;

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 560 } } } }}
    >
      {configQuery.isFetching && <LinearProgress />}

      {/* The department's own colour, as a header rule — the same accent it wears
          on its card, in the sidebar and on every chip that names it. */}
      <Box sx={{ height: 4, bgcolor: department?.colorHex ?? 'primary.main', flexShrink: 0 }} />

      <Box sx={{ p: 2.5, pb: 0 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" noWrap>
              {department?.name ?? 'Department'}
            </Typography>
            {department && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                  {department.code}
                </Typography>
                <ToneChip
                  tone={department.isActive ? 'success' : 'neutral'}
                  label={department.isActive ? 'Active' : 'Inactive'}
                />
              </Stack>
            )}
          </Box>

          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Tabs value={tab} onChange={(_event, value) => setTab(value)} sx={{ mt: 2 }}>
          {TABS.map((label) => (
            <Tab key={label} label={label} sx={{ minWidth: 0 }} />
          ))}
        </Tabs>
      </Box>

      <Divider />

      <Box sx={{ p: 2.5, overflowY: 'auto' }}>
        {configQuery.isError && (
          <Alert severity="error">
            {errorMessage(configQuery.error, 'Could not load this department.')}
          </Alert>
        )}

        {department && tab === 0 && (
          <DetailsTab department={department} onDeleteRequest={onDeleteRequest} />
        )}
        {department && tab === 1 && <WorkingHoursTab department={department} />}
        {department && tab === 2 && <TaskFieldsTab department={department} />}
      </Box>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ *
 * Details
 * ------------------------------------------------------------------ */

function DetailsTab({ department, onDeleteRequest }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(departmentEditSchema),
    defaultValues: {
      name: department.name ?? '',
      description: department.description ?? '',
      colorHex: department.colorHex ?? '#2563EB',
      icon: department.icon ?? '',
      isActive: department.isActive,
      sortOrder: department.sortOrder ?? 0,
      requiredSlotsPerDay: department.requiredSlotsPerDay ?? 7,
      workingWeekdays: department.workingWeekdays ?? [1, 2, 3, 4, 5],
      aiAnalysisEnabled: department.aiAnalysisEnabled ?? true,
    },
  });

  const mutation = useMutation({
    // The API's update schema is NOT a partial — every one of these keys is
    // required together, so a "just the name" PATCH would 422.
    mutationFn: (values) =>
      departmentsApi.update(department.id, {
        name: values.name,
        description: values.description,
        colorHex: values.colorHex,
        icon: values.icon,
        isActive: values.isActive,
        sortOrder: values.sortOrder,
        requiredSlotsPerDay: values.requiredSlotsPerDay,
        workingWeekdays: values.workingWeekdays,
        aiAnalysisEnabled: values.aiAnalysisEnabled,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: departmentConfigKey(department.id) });
      queryClient.invalidateQueries({ queryKey: ['departments'] });
      enqueueSnackbar('Department updated', { variant: 'success' });
    },
    onError: (error) => setServerError(error),
  });

  return (
    <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
      <Stack spacing={2.5}>
        {serverError && isActionable(serverError) && (
          <Alert severity="error" onClose={() => setServerError(null)}>
            {errorMessage(serverError)}
          </Alert>
        )}

        <Controller
          name="name"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Name"
              size="small"
              error={Boolean(errors.name)}
              helperText={errors.name?.message}
            />
          )}
        />

        <Controller
          name="description"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Description"
              size="small"
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
              helperText={errors.colorHex?.message}
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
                label="Icon"
                size="small"
                fullWidth
                error={Boolean(errors.icon)}
                helperText={errors.icon?.message}
              />
            )}
          />
          <Controller
            name="sortOrder"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Sort order"
                type="number"
                size="small"
                fullWidth
                slotProps={{ htmlInput: { min: 0, max: 999 } }}
                error={Boolean(errors.sortOrder)}
                helperText={errors.sortOrder?.message ?? 'Lower comes first.'}
              />
            )}
          />
        </Stack>

        <Controller
          name="requiredSlotsPerDay"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              label="Required hours per day"
              type="number"
              size="small"
              slotProps={{ htmlInput: { min: 1, max: 24 } }}
              error={Boolean(errors.requiredSlotsPerDay)}
              helperText={
                errors.requiredSlotsPerDay?.message ??
                'How many hours must be filled for a day to count as complete.'
              }
            />
          )}
        />

        <Controller
          name="workingWeekdays"
          control={control}
          render={({ field }) => (
            <WeekdayField
              value={field.value}
              onChange={field.onChange}
              error={Boolean(errors.workingWeekdays)}
              helperText={errors.workingWeekdays?.message}
            />
          )}
        />

        <Controller
          name="isActive"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Switch {...field} checked={field.value} size="small" />}
              label={
                <Typography variant="body2">
                  Active — an inactive department leaves every dropdown, but keeps all of its history
                </Typography>
              }
            />
          )}
        />

        {/* A data-sharing decision, so it says plainly what it does. Switching it
            off excludes this department from the analyser's query entirely — the
            work is never read, not merely hidden after the fact. */}
        <Controller
          name="aiAnalysisEnabled"
          control={control}
          render={({ field }) => (
            <FormControlLabel
              control={<Switch {...field} checked={field.value} size="small" />}
              label={
                <Typography variant="body2">
                  AI analysis —{' '}
                  {field.value
                    ? "this department's assignments and hour descriptions are sent to the analyser"
                    : 'switched off. Nothing from this department is sent to the AI at all.'}
                </Typography>
              }
            />
          )}
        />

        <Typography variant="caption" color="text.disabled">
          The code <strong>{department.code}</strong> is immutable — integrations and seeds resolve
          this department by it.
        </Typography>

        <Divider />

        <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="center">
          <Guard permission={PERMISSIONS.DEPARTMENT_MANAGE}>
            <Button
              color="error"
              size="small"
              startIcon={<DeleteIcon fontSize="small" />}
              onClick={() => onDeleteRequest(department)}
            >
              Delete department
            </Button>
          </Guard>

          <Button
            type="submit"
            variant="contained"
            disabled={mutation.isPending || !isDirty}
          >
            Save changes
          </Button>
        </Stack>
      </Stack>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Working hours
 * ------------------------------------------------------------------ */

/**
 * How often employees must describe what they completed.
 *
 * The two-step is the whole design: PREVIEW, then apply. Changing a live
 * department's grid is not a text edit — it can retire columns that people have
 * already logged work against, and it re-labels others. The server computes the
 * preview with the same planner it uses to write, so what is shown here is
 * exactly what will happen, not an approximation of it.
 */
function CadencePanel({ department, onApplied }) {
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();

  const [intervalMinutes, setIntervalMinutes] = useState(department.slotIntervalMinutes ?? 60);
  const [dayStart, setDayStart] = useState(minutesToTime(department.dayStartMinute ?? 600));
  const [dayEnd, setDayEnd] = useState(minutesToTime(department.dayEndMinute ?? 1080));
  const [plan, setPlan] = useState(null);

  const body = () => ({
    slotIntervalMinutes: Number(intervalMinutes),
    dayStartMinute: timeToMinutes(dayStart),
    dayEndMinute: timeToMinutes(dayEnd),
  });

  const previewMutation = useMutation({
    mutationFn: () => departmentsApi.rebuildTimeSlots(department.id, { ...body(), dryRun: true }),
    onSuccess: (res) => setPlan(res.data),
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const applyMutation = useMutation({
    mutationFn: () => departmentsApi.rebuildTimeSlots(department.id, body()),
    onSuccess: (res) => {
      setPlan(null);
      onApplied?.();
      enqueueSnackbar(res.message ?? 'Working hours rebuilt', { variant: 'success' });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const handleApply = async () => {
    // Only ask when something irreversible-looking is actually going to happen.
    // A confirmation on a harmless change teaches people to click through the
    // one that matters.
    const losing = plan?.retired?.length ?? 0;
    const moving = plan?.adjusted?.length ?? 0;
    if (losing || moving) {
      const parts = [];
      if (losing) parts.push(`${losing} column${losing > 1 ? 's' : ''} carrying logged work will be retired — the work stays, the column leaves the grid`);
      if (moving) parts.push(`${moving} column${moving > 1 ? 's' : ''} with logged work will be re-labelled to its new span`);
      const confirmed = await confirm({
        title: 'Rebuild this department’s working hours?',
        message: `${parts.join('. ')}. No task entry is ever deleted.`,
        confirmLabel: 'Rebuild',
      });
      if (!confirmed) return;
    }
    applyMutation.mutate();
  };

  const dirty =
    Number(intervalMinutes) !== (department.slotIntervalMinutes ?? 60) ||
    timeToMinutes(dayStart) !== (department.dayStartMinute ?? 600) ||
    timeToMinutes(dayEnd) !== (department.dayEndMinute ?? 1080);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>
        Logging cadence
      </Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        How often people in this department describe what they have completed. Longer blocks suit
        work that cannot be summarised every hour.
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 1.5 }}>
        <TextField
          select
          size="small"
          label="Log every"
          value={intervalMinutes}
          onChange={(e) => {
            setIntervalMinutes(e.target.value);
            setPlan(null);
          }}
          sx={{ minWidth: 140 }}
        >
          {[30, 60, 120, 180, 240].map((m) => (
            <MenuItem key={m} value={m}>
              {m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          type="time"
          label="Day starts"
          value={dayStart}
          onChange={(e) => {
            setDayStart(e.target.value);
            setPlan(null);
          }}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          size="small"
          type="time"
          label="Day ends"
          value={dayEnd}
          onChange={(e) => {
            setDayEnd(e.target.value);
            setPlan(null);
          }}
          InputLabelProps={{ shrink: true }}
        />
      </Stack>

      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          size="small"
          variant="outlined"
          onClick={() => previewMutation.mutate()}
          disabled={previewMutation.isPending}
        >
          Preview the grid
        </Button>
        {plan && (
          <Button
            size="small"
            variant="contained"
            onClick={handleApply}
            disabled={applyMutation.isPending}
          >
            Apply
          </Button>
        )}
        {dirty && !plan && (
          <Typography variant="caption" color="text.secondary">
            Preview to see what changes before anything is written.
          </Typography>
        )}
      </Stack>

      {plan && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
            {plan.requiredSlotsPerDay} block{plan.requiredSlotsPerDay === 1 ? '' : 's'} to fill each day
          </Typography>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {plan.columns.map((c) => (
              <Chip
                key={c.label}
                size="small"
                label={c.label}
                variant={c.isBreak ? 'outlined' : 'filled'}
              />
            ))}
          </Stack>

          {plan.retired?.length > 0 && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              These columns carry logged work and will be <b>retired, not deleted</b> — they leave
              the grid, the entries behind them stay:{' '}
              {plan.retired.map((r) => `${r.label} (${r.entries})`).join(', ')}
            </Alert>
          )}
          {plan.adjusted?.length > 0 && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              These columns already have work logged against them and will be re-labelled to their
              new span:{' '}
              {plan.adjusted.map((a) => `${a.from} → ${a.to} (${a.entries})`).join(', ')}
            </Alert>
          )}
        </Box>
      )}
    </Paper>
  );
}

function WorkingHoursTab({ department }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();

  const [editing, setEditing] = useState(null);

  const slots = useMemo(
    () => [...(department.timeSlots ?? [])].sort(bySortOrder),
    [department.timeSlots],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: departmentConfigKey(department.id) });
    queryClient.invalidateQueries({ queryKey: ['departments'] });
  };

  const removeMutation = useMutation({
    mutationFn: (slotId) => departmentsApi.removeTimeSlot(department.id, slotId),
    onSuccess: (res) => {
      invalidate();
      // A soft delete: work was already logged against this hour, so the API
      // retired the column instead of destroying the entries under it. That is
      // information, not a failure — say so, in the server's own words.
      if (res.data?.retired) {
        enqueueSnackbar(res.data.message, { variant: 'info', autoHideDuration: 8000 });
      } else {
        enqueueSnackbar('Working hour removed', { variant: 'success' });
      }
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const handleRemove = async (slot) => {
    const confirmed = await confirm({
      title: `Remove "${slot.label}"?`,
      message:
        'It disappears from new task sheets. If work has already been logged against it, the hour is retired rather than deleted and that work is untouched.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (confirmed) removeMutation.mutate(slot.id);
  };

  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={false}>
        These are the columns of this department&apos;s task grid — one block per entry, on every
        employee&apos;s sheet.
      </Alert>

      <Guard permission={PERMISSIONS.DEPARTMENT_MANAGE}>
        <CadencePanel department={department} onApplied={invalidate} />
      </Guard>

      <Guard permission={PERMISSIONS.DEPARTMENT_MANAGE}>
        <Box>
          <Button
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            onClick={() => setEditing({})}
            disabled={slots.length >= 24}
          >
            Add an hour
          </Button>
        </Box>
      </Guard>

      {slots.length === 0 ? (
        <EmptyState
          dense
          icon={ScheduleIcon}
          title="No working hours"
          message="This department has no task grid until it has at least one hour."
        />
      ) : (
        <Stack spacing={1}>
          {slots.map((slot, index) => (
            <Paper key={slot.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Typography variant="caption" color="text.disabled" sx={{ width: 18 }}>
                  {index + 1}
                </Typography>

                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap>
                    {slot.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {slotLabel(slot.startMinute, slot.endMinute)}
                  </Typography>
                </Box>

                {slot.isBreak && <ToneChip tone="warning" label="Break" />}
                {slot.isOvertime && <ToneChip tone="purple" label="Overtime" />}

                <Guard permission={PERMISSIONS.DEPARTMENT_MANAGE}>
                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => setEditing(slot)}
                        aria-label={`Edit ${slot.label}`}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Remove">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={removeMutation.isPending}
                          onClick={() => handleRemove(slot)}
                          aria-label={`Remove ${slot.label}`}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Guard>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {editing && (
        <TimeSlotDialog
          departmentId={department.id}
          slot={editing.id ? editing : null}
          siblings={slots}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            invalidate();
            enqueueSnackbar(message, { variant: 'success' });
          }}
        />
      )}
    </Stack>
  );
}

function TimeSlotDialog({ departmentId, slot, siblings, onClose, onSaved }) {
  const isEdit = Boolean(slot);
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(timeSlotSchema),
    defaultValues: {
      label: slot?.label ?? '',
      start: slot ? minutesToTime(slot.startMinute) : '',
      end: slot ? minutesToTime(slot.endMinute) : '',
      isBreak: slot?.isBreak ?? false,
    },
  });

  const mutation = useMutation({
    mutationFn: (body) =>
      isEdit
        ? departmentsApi.updateTimeSlot(departmentId, slot.id, body)
        : departmentsApi.addTimeSlot(departmentId, { ...body, isOvertime: false }),
    onSuccess: () => onSaved(isEdit ? 'Working hour updated' : 'Working hour added'),
    onError: (error) => setServerError(error),
  });

  const submit = (values) => {
    const startMinute = timeToMinutes(values.start);
    const endMinute = endMinuteFor(values.end);

    // The API rejects an overlapping column on create (TIME_SLOT_OVERLAP) but does
    // NOT re-check it on update, so this is the only thing standing between an edit
    // and two columns that both own 14:00.
    const overlap = findOverlap(
      [...siblings, { id: slot?.id, label: values.label || null, startMinute, endMinute }],
      slot?.id,
    );

    if (overlap) {
      setError('start', { message: overlapMessage(overlap) });
      return;
    }

    mutation.mutate({
      label: values.label || slotLabel(startMinute, endMinute),
      startMinute,
      endMinute,
      isBreak: values.isBreak,
    });
  };

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit(submit)} noValidate>
        <DialogTitle>{isEdit ? 'Edit working hour' : 'Add a working hour'}</DialogTitle>

        <DialogContent>
          {serverError && isActionable(serverError) && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServerError(null)}>
              {errorMessage(serverError)}
            </Alert>
          )}

          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction="row" spacing={2}>
              <Controller
                name="start"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="From"
                    type="time"
                    fullWidth
                    error={Boolean(errors.start)}
                    helperText={errors.start?.message}
                  />
                )}
              />
              <Controller
                name="end"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="To"
                    type="time"
                    fullWidth
                    error={Boolean(errors.end)}
                    helperText={errors.end?.message}
                  />
                )}
              />
            </Stack>

            <Controller
              name="label"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Label (optional)"
                  placeholder="10:00 - 11:00"
                  error={Boolean(errors.label)}
                  helperText={errors.label?.message ?? 'Left blank, the hour labels itself.'}
                />
              )}
            />

            <Controller
              name="isBreak"
              control={control}
              render={({ field }) => (
                <FormControlLabel
                  control={<Checkbox {...field} checked={field.value} size="small" />}
                  label={
                    <Typography variant="body2">
                      This is a break — no work is logged against it and it never counts toward the
                      daily requirement
                    </Typography>
                  }
                />
              )}
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Add hour'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Task fields
 * ------------------------------------------------------------------ */

function TaskFieldsTab({ department }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();

  const [editing, setEditing] = useState(null);

  const fields = useMemo(
    () => [...(department.fieldDefinitions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [department.fieldDefinitions],
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: departmentConfigKey(department.id) });

  const retireMutation = useMutation({
    mutationFn: (fieldId) => departmentsApi.removeField(department.id, fieldId),
    onSuccess: () => {
      invalidate();
      enqueueSnackbar('Field retired. Its stored values are still queryable.', { variant: 'info' });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const handleRetire = async (field) => {
    const confirmed = await confirm({
      title: `Retire "${field.label}"?`,
      message:
        'It leaves the task form immediately. Values already logged under it are kept and stay reportable — this is a retirement, not a deletion.',
      confirmLabel: 'Retire field',
      destructive: true,
    });
    if (confirmed) retireMutation.mutate(field.id);
  };

  return (
    <Stack spacing={2}>
      <Alert severity="info" icon={false}>
        These fields appear on this department&apos;s task form and nowhere else.
      </Alert>

      <Guard permission={PERMISSIONS.DEPARTMENT_MANAGE}>
        <Box>
          <Button
            size="small"
            startIcon={<AddIcon fontSize="small" />}
            onClick={() => setEditing({})}
            disabled={fields.length >= 30}
          >
            Add a field
          </Button>
        </Box>
      </Guard>

      {fields.length === 0 ? (
        <EmptyState
          dense
          icon={ViewListIcon}
          title="No custom fields"
          message="This department uses the standard task form. Add a field to capture something only it tracks."
        />
      ) : (
        <Stack spacing={1}>
          {fields.map((field) => (
            <Paper key={field.id} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" alignItems="flex-start" spacing={1.5}>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap>
                    {field.label}
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontFamily: 'monospace' }}
                  >
                    {field.key}
                  </Typography>

                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }} flexWrap="wrap" useFlexGap>
                    <ToneChip
                      tone="info"
                      label={
                        FIELD_TYPE_OPTIONS.find((option) => option.value === field.type)?.label ??
                        field.type
                      }
                    />
                    {field.isRequired && <ToneChip tone="error" label="Required" />}
                    {field.showInTable && <ToneChip tone="neutral" label="Grid column" />}
                  </Stack>
                </Box>

                <Guard permission={PERMISSIONS.DEPARTMENT_MANAGE}>
                  <Stack direction="row" spacing={0.25}>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => setEditing(field)}
                        aria-label={`Edit ${field.label}`}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Retire">
                      <span>
                        <IconButton
                          size="small"
                          color="error"
                          disabled={retireMutation.isPending}
                          onClick={() => handleRetire(field)}
                          aria-label={`Retire ${field.label}`}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Guard>
              </Stack>
            </Paper>
          ))}
        </Stack>
      )}

      {editing && (
        <TaskFieldDialog
          departmentId={department.id}
          field={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            invalidate();
            enqueueSnackbar(message, { variant: 'success' });
          }}
        />
      )}
    </Stack>
  );
}

function TaskFieldDialog({ departmentId, field, onClose, onSaved }) {
  const isEdit = Boolean(field);
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(taskFieldSchema),
    defaultValues: {
      key: field?.key ?? EMPTY_FIELD.key,
      label: field?.label ?? EMPTY_FIELD.label,
      type: field?.type ?? EMPTY_FIELD.type,
      isRequired: field?.isRequired ?? EMPTY_FIELD.isRequired,
      showInTable: field?.showInTable ?? EMPTY_FIELD.showInTable,
      options: field?.options ?? [],
    },
  });

  const type = watch('type');

  const mutation = useMutation({
    mutationFn: (values) => {
      const body = toFieldBody(values);

      // The key is never sent on an update: the API refuses to change it once work
      // exists under it (FIELD_KEY_IMMUTABLE), and re-sending the same value would
      // only make that check run for nothing.
      if (isEdit) {
        const { key: _key, ...rest } = body;
        return departmentsApi.updateField(departmentId, field.id, rest);
      }

      return departmentsApi.addField(departmentId, body);
    },
    onSuccess: () => onSaved(isEdit ? 'Field updated' : 'Field added'),
    onError: (error) => setServerError(error),
  });

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <DialogTitle>{isEdit ? `Edit "${field.label}"` : 'Add a task field'}</DialogTitle>

        <DialogContent>
          {serverError && isActionable(serverError) && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServerError(null)}>
              {errorMessage(serverError)}
            </Alert>
          )}

          <Stack spacing={2} sx={{ pt: 1 }}>
            <Controller
              name="label"
              control={control}
              render={({ field: control_ }) => (
                <TextField
                  {...control_}
                  label="Label"
                  error={Boolean(errors.label)}
                  helperText={errors.label?.message ?? 'What the employee sees on their task form.'}
                  autoFocus
                />
              )}
            />

            <Controller
              name="key"
              control={control}
              render={({ field: control_ }) => (
                <TextField
                  {...control_}
                  label="Key"
                  disabled={isEdit}
                  error={Boolean(errors.key)}
                  helperText={
                    errors.key?.message ??
                    (isEdit
                      ? 'The key cannot be changed once tasks have been logged against it — the stored values would be orphaned. Change the label instead.'
                      : 'e.g. renderMinutes. Letters, numbers and underscores; must start with a letter.')
                  }
                />
              )}
            />

            <Controller
              name="type"
              control={control}
              render={({ field: control_ }) => (
                <TextField
                  {...control_}
                  select
                  label="Type"
                  error={Boolean(errors.type)}
                  helperText={errors.type?.message}
                >
                  {FIELD_TYPE_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />

            {hasOptions(type) && (
              <Controller
                name="options"
                control={control}
                render={({ field: control_ }) => (
                  <OptionsChipEditor
                    value={control_.value}
                    onChange={control_.onChange}
                    error={Boolean(errors.options)}
                    helperText={errors.options?.message}
                  />
                )}
              />
            )}

            <Divider />

            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <Controller
                name="isRequired"
                control={control}
                render={({ field: control_ }) => (
                  <FormControlLabel
                    control={<Checkbox {...control_} checked={control_.value} size="small" />}
                    label={<Typography variant="body2">Required</Typography>}
                  />
                )}
              />
              <Controller
                name="showInTable"
                control={control}
                render={({ field: control_ }) => (
                  <FormControlLabel
                    control={<Checkbox {...control_} checked={control_.value} size="small" />}
                    label={<Typography variant="body2">Show as a grid column</Typography>}
                  />
                )}
              />
            </Stack>
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Add field'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
