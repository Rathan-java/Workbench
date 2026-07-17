/**
 * THE TASK SHEET — the screen every employee uses every day.
 *
 * The brief was explicit: no Kanban, no drag-and-drop. A clean, table-like
 * interface where a row is a day and the columns are the working hours. That is
 * exactly what this is.
 *
 * The columns are NOT hardcoded. They come from the employee's department, so a
 * Tech engineer sees 10:00–18:00 while a Video Editor sees their later shift —
 * from the same component, because the grid is rendered from the server's
 * `cells` array.
 *
 * On a phone the same data reflows into a vertical stack. A hard-coded 7-column
 * table on a 390px screen is unusable, and "responsive" has to mean more than
 * "it technically renders".
 */
import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Stack,
  Chip,
  Alert,
  AlertTitle,
  LinearProgress,
  Tooltip,
  useTheme,
  useMediaQuery,
  Divider,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TodayIcon from '@mui/icons-material/TodayOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';
import RestaurantIcon from '@mui/icons-material/RestaurantOutlined';
import EventBusyIcon from '@mui/icons-material/EventBusyOutlined';
import AddIcon from '@mui/icons-material/Add';

import PageHeader from '../../components/common/PageHeader.jsx';
import LoadingScreen from '../../components/common/LoadingScreen.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import { tasks as tasksApi, projects as projectsApi, departments as departmentsApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatApiDate, formatDate } from '../../utils/format.js';
import TaskCellEditor from './TaskCellEditor.jsx';
import TaskHistoryDrawer from './TaskHistoryDrawer.jsx';
import { dayjs } from '../../utils/format.js';

const DAY_STATUS_META = {
  DRAFT: { color: 'default', label: 'Draft', icon: null },
  SUBMITTED: { color: 'info', label: 'Submitted for approval', icon: <SendIcon sx={{ fontSize: 14 }} /> },
  APPROVED: { color: 'success', label: 'Approved', icon: <CheckCircleIcon sx={{ fontSize: 14 }} /> },
  REJECTED: { color: 'warning', label: 'Returned for changes', icon: null },
};

export default function TaskSheetPage() {
  const [params, setParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { user } = useAuth();

  const date = params.get('date') ?? formatApiDate(new Date());
  const [historyEntry, setHistoryEntry] = useState(null);

  const setDate = (next) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('date', next);
    setParams(nextParams, { replace: true });
  };

  const gridQuery = useQuery({
    queryKey: ['tasks', 'grid', date],
    queryFn: () => tasksApi.getGrid({ date }),
  });

  const grid = gridQuery.data?.data;
  const departmentId = grid?.employee?.departmentId ?? user?.departmentId;

  // The department's field definitions and project list change roughly never —
  // cache them hard rather than refetching on every date change.
  const configQuery = useQuery({
    queryKey: ['departments', departmentId, 'config'],
    queryFn: () => departmentsApi.config(departmentId),
    enabled: Boolean(departmentId),
    staleTime: 30 * 60 * 1000,
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', 'options', departmentId],
    queryFn: () => projectsApi.options({ departmentId }),
    enabled: Boolean(departmentId),
    staleTime: 10 * 60 * 1000,
  });

  const saveEntry = useMutation({
    mutationFn: (body) => tasksApi.saveEntry({ date, ...body }),
    onSuccess: (result) => {
      // A DRAFT THAT WAS HELD, NOT STORED.
      //
      // An autosave fires while somebody is still typing, before they have picked
      // a project — and projectId is required, so the server declines to create
      // the row and says so rather than writing an hour that no project report
      // could ever see. There is no entry to patch in; the cell stays honestly
      // "unsaved" and the user's text is untouched in the box in front of them.
      //
      // Without this guard the line below reads .timeSlotId off null and the whole
      // task sheet white-screens the moment anyone types before choosing a project
      // — which is to say, always.
      if (!result?.data?.entry) return;

      // Patch the cached grid in place rather than refetching. A refetch on every
      // keystroke-triggered auto-save would re-render the cell the user is
      // actively typing in, and their cursor would jump. This is the difference
      // between an auto-save that feels invisible and one that fights you.
      queryClient.setQueryData(['tasks', 'grid', date], (old) => {
        if (!old?.data) return old;
        const entry = result.data.entry;
        return {
          ...old,
          data: {
            ...old.data,
            cells: old.data.cells.map((cell) =>
              cell.timeSlot.id === entry.timeSlotId ? { ...cell, entry, isMissing: false } : cell,
            ),
            day: { ...old.data.day, ...result.data.day },
            summary: {
              ...old.data.summary,
              filledSlots: result.data.day.filledSlots,
              completionRate: old.data.summary.requiredSlots
                ? Math.round((result.data.day.filledSlots / old.data.summary.requiredSlots) * 100)
                : 0,
            },
          },
        };
      });
    },
  });

  const submitDay = useMutation({
    mutationFn: () => tasksApi.submitDay({ date }),
    onSuccess: () => {
      enqueueSnackbar('Task sheet submitted for approval', { variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'grid', date] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => {
      enqueueSnackbar(error.message ?? 'Could not submit the sheet', { variant: 'error' });
    },
  });

  /**
   * Appends the next hour after the department's last column, flagged as overtime.
   * The server refuses to roll past midnight — work after 00:00 belongs to the
   * NEXT day's sheet, and quietly filing it under today would corrupt every
   * date-bounded report in the system.
   */
  const addOvertime = useMutation({
    mutationFn: () => departmentsApi.addOvertimeSlot(departmentId),
    onSuccess: () => {
      enqueueSnackbar('Extra hour added. It will not count toward your required hours.', {
        variant: 'success',
      });
      // The department's slot list changed, so BOTH the config and the grid are stale.
      queryClient.invalidateQueries({ queryKey: ['departments', departmentId, 'config'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'grid', date] });
    },
    onError: (error) => enqueueSnackbar(error.message ?? 'Could not add the hour', { variant: 'error' }),
  });

  /**
   * Undo an extra hour. The counterpart to the "+": if you can add one, you can
   * take it back. The server only allows it while the column is empty, so this
   * can never remove someone's logged work.
   */
  const removeOvertime = useMutation({
    mutationFn: (slotId) => departmentsApi.removeOvertimeSlot(departmentId, slotId),
    onSuccess: () => {
      enqueueSnackbar('Extra hour removed.', { variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['departments', departmentId, 'config'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', 'grid', date] });
    },
    onError: (error) =>
      enqueueSnackbar(error.message ?? 'Could not remove the hour', { variant: 'error' }),
  });

  const shiftDate = (days) => setDate(formatApiDate(dayjs(date).add(days, 'day')));

  const isToday = date === formatApiDate(new Date());
  const isFuture = dayjs(date).isAfter(dayjs(), 'day');

  const workCells = useMemo(
    () => (grid?.cells ?? []).filter((c) => !c.timeSlot.isBreak),
    [grid],
  );

  if (gridQuery.isLoading) return <LoadingScreen message="Loading your task sheet…" />;

  if (gridQuery.isError) {
    return (
      <ErrorState
        title="Could not load your task sheet"
        message={gridQuery.error?.message}
        onRetry={() => gridQuery.refetch()}
      />
    );
  }

  const { day, summary, permissions, isWorkingDay } = grid;
  const statusMeta = DAY_STATUS_META[day.status] ?? DAY_STATUS_META.DRAFT;
  const complete = summary.filledSlots >= summary.requiredSlots;

  return (
    <Box>
      <PageHeader
        title="My Task Sheet"
        subtitle={`${grid.employee.department?.name ?? ''} · ${formatDate(date)}`}
        actions={
          <Stack direction="row" spacing={1} alignItems="center">
            <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', borderRadius: 2 }}>
              <IconButton size="small" onClick={() => shiftDate(-1)} aria-label="Previous day">
                <ChevronLeftIcon fontSize="small" />
              </IconButton>
              <Box
                component="input"
                type="date"
                value={date}
                max={formatApiDate(new Date())}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                sx={{
                  border: 'none',
                  outline: 'none',
                  bgcolor: 'transparent',
                  color: 'text.primary',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  fontWeight: 600,
                  px: 0.5,
                  colorScheme: theme.palette.mode,
                }}
              />
              <IconButton
                size="small"
                onClick={() => shiftDate(1)}
                disabled={isToday}
                aria-label="Next day"
              >
                <ChevronRightIcon fontSize="small" />
              </IconButton>
            </Paper>

            {!isToday && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<TodayIcon sx={{ fontSize: 16 }} />}
                onClick={() => setDate(formatApiDate(new Date()))}
              >
                Today
              </Button>
            )}

            {permissions.canSubmit && day.status !== 'SUBMITTED' && day.status !== 'APPROVED' && (
              <Tooltip
                title={
                  complete
                    ? 'Send this sheet to your Tech Lead for approval'
                    : `Log all ${summary.requiredSlots} hours before submitting`
                }
              >
                <span>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SendIcon sx={{ fontSize: 16 }} />}
                    onClick={() => submitDay.mutate()}
                    disabled={!complete || submitDay.isPending}
                  >
                    Submit
                  </Button>
                </span>
              </Tooltip>
            )}
          </Stack>
        }
      />

      {/* --- the day's status strip --- */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2.5, borderRadius: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.75 }}>
              <Chip
                size="small"
                icon={statusMeta.icon ?? undefined}
                label={statusMeta.label}
                color={statusMeta.color}
                variant={day.status === 'DRAFT' ? 'outlined' : 'filled'}
                sx={{ fontWeight: 650, height: 22 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12.5 }}>
                {summary.filledSlots} of {summary.requiredSlots} hours logged
              </Typography>
              {summary.lateSlots > 0 && (
                <Chip
                  size="small"
                  label={`${summary.lateSlots} late`}
                  color="warning"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }}
                />
              )}
            </Stack>

            <LinearProgress
              variant="determinate"
              value={Math.min(summary.completionRate, 100)}
              color={complete ? 'success' : summary.completionRate > 50 ? 'primary' : 'warning'}
              sx={{ height: 6, borderRadius: 3 }}
            />
          </Box>

          <Box sx={{ textAlign: { sm: 'right' }, minWidth: 88 }}>
            <Typography
              variant="h4"
              sx={{
                fontWeight: 700,
                lineHeight: 1,
                color: complete ? 'success.main' : 'text.primary',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {summary.completionRate}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              complete
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* --- why can't I type? --- */}
      {permissions.isLocked && (
        <Alert severity={day.status === 'APPROVED' ? 'success' : 'info'} icon={<LockIcon />} sx={{ mb: 2.5 }}>
          <AlertTitle sx={{ fontWeight: 700 }}>{permissions.lockReason}</AlertTitle>
          {day.status === 'SUBMITTED' &&
            'Your Tech Lead is reviewing this sheet. Ask them to return it if you need to make changes.'}
          {day.status === 'APPROVED' &&
            `Approved by ${day.reviewedBy?.fullName ?? 'your Tech Lead'}. This sheet is now locked.`}
        </Alert>
      )}

      {day.status === 'REJECTED' && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          <AlertTitle sx={{ fontWeight: 700 }}>Returned for changes</AlertTitle>
          {day.reviewNote ? (
            <Typography variant="body2">“{day.reviewNote}”</Typography>
          ) : (
            'Your Tech Lead has asked for changes.'
          )}
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Edit the hours below and submit again — editing moves the sheet back to draft automatically.
          </Typography>
        </Alert>
      )}

      {!permissions.canEdit && !permissions.isLocked && permissions.lockReason && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          {permissions.lockReason}. Ask your Tech Lead to update older entries on your behalf.
        </Alert>
      )}

      {!isWorkingDay && (
        <Alert severity="info" icon={<EventBusyIcon />} sx={{ mb: 2.5 }}>
          This is not a working day for {grid.employee.department?.name}. You can still log work if you
          came in, and it will not count against your compliance.
        </Alert>
      )}

      {isFuture && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          You cannot log work for a future date.
        </Alert>
      )}

      {/* --- THE GRID --- */}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          // Desktop: the hours run across, like the table the brief asked for.
          // Mobile: they stack, because seven columns on a phone is a joke.
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, 1fr)',
            lg: 'repeat(3, 1fr)',
            xl: 'repeat(4, 1fr)',
          },
        }}
      >
        {(grid.cells ?? []).map((cell) =>
          cell.timeSlot.isBreak ? (
            <Box
              key={cell.timeSlot.id}
              sx={{
                display: { xs: 'none', md: 'flex' },
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                border: 1,
                borderStyle: 'dashed',
                borderColor: 'divider',
                borderRadius: 2,
                minHeight: 120,
                color: 'text.disabled',
              }}
            >
              <RestaurantIcon sx={{ fontSize: 18 }} />
              <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.05em' }}>
                {cell.timeSlot.label.toUpperCase()}
              </Typography>
            </Box>
          ) : (
            <TaskCellEditor
              key={cell.timeSlot.id}
              cell={cell}
              fieldDefinitions={configQuery.data?.data?.fieldDefinitions ?? []}
              projects={projectsQuery.data?.data ?? []}
              readOnly={!permissions.canEdit || isFuture}
              onSave={async (body) => {
                const result = await saveEntry.mutateAsync(body);
                return result.data;
              }}
              onViewHistory={setHistoryEntry}
              autoExpand={isMobile ? false : cell.isCurrentHour}
              // Employees must name a project; a Tech Lead's sheet does not ask.
              projectRequired={grid.projectRequired ?? true}
              // The employee's open assigned tasks. When they have any, each hour
              // must name one (or "Other work") — the "required only if assigned"
              // rule. Picking a task auto-fills its project.
              assignments={grid.assignments ?? []}
              // An extra hour is undoable while it is still empty — the mirror of
              // the "+" that added it. Not offered for real working hours, nor
              // once something has been logged (the server would refuse anyway).
              onRemoveOvertime={
                cell.timeSlot.isOvertime && !cell.entry && permissions.canEdit && !isFuture
                  ? () => removeOvertime.mutate(cell.timeSlot.id)
                  : undefined
              }
              removingOvertime={removeOvertime.isPending}
            />
          ),
        )}
      </Box>

      {/* ── THE "+" — an extra hour for anyone still working ──────────────────
        *
        * The department's grid ends at a fixed time. People do not. Without this,
        * an engineer who fixes a production incident from 18:00 to 19:00 has
        * literally nowhere to record it — so it goes unrecorded, and the company
        * never learns the incident cost an hour of somebody's evening.
        *
        * The appended column is OVERTIME: it does not count toward the required
        * hours. Filling it does not inflate a compliance score, and — the part
        * that matters — NOT filling it does not damage one. An overtime column
        * that counted toward the requirement would silently make overtime
        * mandatory for the whole department.
        */}
      {grid.canAddOvertime && permissions.canEdit && (
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
          <Tooltip title="Still working? Add the next hour to your sheet.">
            <span>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => addOvertime.mutate()}
                disabled={addOvertime.isPending}
                sx={{
                  borderStyle: 'dashed',
                  borderWidth: 1.5,
                  px: 3,
                  '&:hover': { borderStyle: 'dashed', borderWidth: 1.5 },
                }}
              >
                {addOvertime.isPending ? 'Adding…' : 'Add an extra hour'}
              </Button>
            </span>
          </Tooltip>
        </Box>
      )}

      {summary.overtimeSlots > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', textAlign: 'center', mt: 1 }}
        >
          {summary.overtimeSlots} overtime hour{summary.overtimeSlots === 1 ? '' : 's'} logged. These
          are recorded but are not counted toward your required hours.
        </Typography>
      )}

      {workCells.length === 0 && (
        <Alert severity="error" sx={{ mt: 2 }}>
          No working hours are configured for {grid.employee.department?.name}. Contact your
          administrator.
        </Alert>
      )}

      <Divider sx={{ my: 3 }} />

      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', textAlign: 'center' }}>
        Entries auto-save as you type. Every change is recorded with who made it and when.
      </Typography>

      <TaskHistoryDrawer entry={historyEntry} onClose={() => setHistoryEntry(null)} />
    </Box>
  );
}
