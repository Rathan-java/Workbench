import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import GridOnOutlinedIcon from '@mui/icons-material/GridOnOutlined';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';

import dayjs from 'dayjs';

import PageHeader from '../../components/common/PageHeader.jsx';
import DateRangeFilter from '../../components/common/DateRangeFilter.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { useAuth } from '../../context/AuthContext.jsx';

import {
  departments as departmentsApi,
  projects as projectsApi,
  reports as reportsApi,
  tasks as tasksApi,
  // teams as teamsApi,   // Team filter removed
  users as usersApi,
} from '../../api/endpoints.js';

import { PERMISSIONS } from '../../utils/constants.js';
import { formatNumber } from '../../utils/format.js';
import {
  DEFAULT_PRESET,
  MONTH_OPTIONS,
  describeRange,
  resolveRange,
  yearOptions,
} from '../../utils/dateRange.js';

/** The API caps a PDF at 2,000 rows and says so on the cover page. */
const PDF_MAX_ROWS = 2000;

/** exportLimiter: 10 requests per 5 minutes, keyed on the user. */
const EXPORT_LIMIT_HINT = 'Exports are limited to 10 every 5 minutes.';

const FORMATS = [
  { value: 'EXCEL', label: 'Excel', hint: '.xlsx · every column', icon: GridOnOutlinedIcon },
  { value: 'CSV', label: 'CSV', hint: '.csv · for pivots', icon: DescriptionOutlinedIcon },
  { value: 'PDF', label: 'PDF', hint: '.pdf · for circulation', icon: PictureAsPdfOutlinedIcon },
];

const DEFAULT_FORM = {
  departmentId: '',
  teamId: '',
  userId: '',
  projectId: '',
  periodMode: 'range',
  preset: DEFAULT_PRESET,
  dateFrom: '',
  dateTo: '',
  month: dayjs().month() + 1,
  year: dayjs().year(),
  lateOnly: false,
};

const describeExportError = (error) => {
  if (error?.status === 429) {
    return `${error.message || 'Too many export requests.'} ${EXPORT_LIMIT_HINT}`;
  }
  if (error?.status === 403) {
    return 'You do not have permission to export this data.';
  }
  if (error?.status === 0) {
    // Network/timeout — a big export can outrun the 30s client timeout.
    return `${error.message} A very large export can take a while; try narrowing the date range.`;
  }
  return error?.message ?? 'The export failed. Please try again.';
};

export default function ReportsPage() {
  const theme = useTheme();
  const { can } = useAuth();
  const { enqueueSnackbar } = useSnackbar();

  const [form, setForm] = useState(DEFAULT_FORM);
  const patch = (next) => setForm((current) => ({ ...current, ...next }));

  const canGlobal = can(PERMISSIONS.DASHBOARD_GLOBAL);
  const canReadUsers = can(PERMISSIONS.USER_READ);

  /* ---------------------------------------------------------------- *
   * Dependent option lists. Every one of these is scoped server-side,
   * so passing departmentId narrows the list rather than "filters" it —
   * a Tech Lead's copy never contained anyone else's staff to begin with.
   * ---------------------------------------------------------------- */
  const unwrap = (response) => response.data;

  const departmentsQuery = useQuery({
    queryKey: ['departments', 'list'],
    queryFn: () => departmentsApi.list(),
    select: unwrap,
    staleTime: 5 * 60_000,
  });

  // The Team filter was removed, so the teams list is no longer fetched. Restore
  // this query alongside the commented-out <TextField label="Team"> below.
  //
  // const teamsQuery = useQuery({
  //   queryKey: ['teams', 'options', form.departmentId],
  //   queryFn: () => teamsApi.options({ departmentId: form.departmentId || undefined }),
  //   select: unwrap,
  //   staleTime: 5 * 60_000,
  // });

  const usersQuery = useQuery({
    queryKey: ['users', 'options', form.departmentId],
    queryFn: () => usersApi.options({ departmentId: form.departmentId || undefined }),
    select: unwrap,
    staleTime: 60_000,
    enabled: canReadUsers,
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', 'options', form.departmentId],
    queryFn: () => projectsApi.options({ departmentId: form.departmentId || undefined }),
    select: unwrap,
    staleTime: 5 * 60_000,
  });

  const departments = departmentsQuery.data ?? [];
  // const teams = teamsQuery.data ?? [];   // Team filter removed
  const employees = usersQuery.data ?? [];
  const projects = projectsQuery.data ?? [];
  const ownDepartment = departments.length === 1 ? departments[0] : null;

  // A person belongs to a department: narrowing the parent can only invalidate
  // the children, so clear them rather than send an impossible combination the
  // API would answer with zero rows.
  const handleDepartment = (event) =>
    patch({ departmentId: event.target.value, userId: '', projectId: '' });

  // const handleTeam = (event) => patch({ teamId: event.target.value, userId: '' });

  /* ---------------------------------------------------------------- *
   * The filter set, in the exact shape both the preview and the export
   * endpoints take — one object, so the count can never describe a
   * different report from the one that downloads.
   * ---------------------------------------------------------------- */
  const range = useMemo(
    () => resolveRange({ preset: form.preset, dateFrom: form.dateFrom, dateTo: form.dateTo }),
    [form.preset, form.dateFrom, form.dateTo],
  );

  const filters = useMemo(() => {
    const period =
      form.periodMode === 'month'
        ? { month: form.month, year: form.year }
        : { dateFrom: range.dateFrom, dateTo: range.dateTo };

    return {
      departmentId: form.departmentId || undefined,
      userId: form.userId || undefined,
      // Project is the sharpest slice this report has left: an entry has no
      // status and no priority to filter on, so "what went into this project"
      // is the question the export is actually asked.
      projectId: form.projectId || undefined,
      // teamId intentionally omitted — that filter was removed from the UI.
      // The API still accepts it.
      ...period,
      /**
       * `isLate` is validated with `z.coerce.boolean()`, and Boolean('false')
       * is TRUE. Sending isLate=false would silently turn "all entries" into
       * "late entries only" — so when the toggle is off the key must be absent,
       * not false.
       */
      ...(form.lateOnly ? { isLate: true } : {}),
    };
  }, [form, range]);

  /* ---------------------------------------------------------------- *
   * Live row count. pageSize=1 — we want `meta.pagination.total`, not the rows;
   * asking for a page of data to count it would be a full read of the report
   * on every keystroke.
   * ---------------------------------------------------------------- */
  const debouncedFilters = useDebounce(filters, 350);

  const previewQuery = useQuery({
    queryKey: ['reports', 'preview', debouncedFilters],
    queryFn: () => tasksApi.listEntries({ ...debouncedFilters, page: 1, pageSize: 1 }),
    select: (response) => response.meta?.pagination?.total ?? 0,
    // Hold the previous count while a new one loads: a number that blinks to a
    // skeleton on every filter tweak is a number nobody can read.
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });

  const total = previewQuery.data ?? 0;
  const isCounting = previewQuery.isPending;
  const isStale = previewQuery.isPlaceholderData || previewQuery.isFetching;
  const pdfTruncated = total > PDF_MAX_ROWS;

  const exportMutation = useMutation({
    mutationFn: (format) => reportsApi.download({ ...filters, format }),
    onSuccess: ({ filename }) =>
      enqueueSnackbar(`Downloaded ${filename}`, { variant: 'success' }),
    onError: (error) =>
      enqueueSnackbar(describeExportError(error), { variant: 'error', autoHideDuration: 8000 }),
  });

  const pendingFormat = exportMutation.isPending ? exportMutation.variables : null;
  const nothingToExport = !isCounting && total === 0;

  const periodSummary =
    form.periodMode === 'month'
      ? dayjs()
          .year(form.year)
          .month(form.month - 1)
          .format('MMMM YYYY')
      : describeRange(range);

  return (
    <Box>
      <PageHeader
        title="Reports"
        subtitle="Build a filtered task report and export it as Excel, CSV or PDF."
      />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 340px' },
          gap: 2.5,
          alignItems: 'start',
        }}
      >
        {/* ---------------------------------------------------------- *
         * The builder
         * ---------------------------------------------------------- */}
        <Paper sx={{ p: 3, borderRadius: 2 }}>
          <Typography variant="h6" component="h2">
            Filters
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Every filter is applied on the server, inside your access scope.
          </Typography>

          <Divider sx={{ my: 2.5 }} />

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
              gap: 2,
            }}
          >
            {canGlobal ? (
              <TextField
                select
                label="Department"
                value={form.departmentId}
                onChange={handleDepartment}
              >
                <MenuItem value="">All departments</MenuItem>
                {departments.map((department) => (
                  <MenuItem key={department.id} value={department.id}>
                    {department.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              // One department means no choice to make. Say what the scope is.
              <Stack spacing={0.5}>
                <Typography variant="caption" color="text.secondary">
                  Department
                </Typography>
                <Chip
                  label={ownDepartment?.name ?? 'Your department'}
                  sx={{
                    alignSelf: 'flex-start',
                    height: 32,
                    color: ownDepartment?.colorHex ?? undefined,
                    backgroundColor: ownDepartment?.colorHex
                      ? alpha(ownDepartment.colorHex, theme.palette.mode === 'light' ? 0.1 : 0.16)
                      : undefined,
                  }}
                />
              </Stack>
            )}

            {/* ───────────────────────────────────────────────────────────────
             * TEAM filter — REMOVED per requirement. Department + Employee is
             * enough to reach any person, and Team was a redundant middle step.
             *
             * Left commented rather than deleted: the API still accepts `teamId`,
             * so restoring this is uncommenting, not rebuilding.
             *
             * <TextField
             *   select
             *   label="Team"
             *   value={form.teamId}
             *   onChange={handleTeam}
             *   disabled={teamsQuery.isPending}
             * >
             *   <MenuItem value="">All teams</MenuItem>
             *   {teams.map((team) => (
             *     <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>
             *   ))}
             * </TextField>
             * ─────────────────────────────────────────────────────────────── */}

            {canReadUsers && (
              <TextField
                select
                label="Employee"
                value={form.userId}
                onChange={(event) => patch({ userId: event.target.value })}
                disabled={usersQuery.isPending}
                helperText={form.departmentId ? `${employees.length} in this selection` : undefined}
              >
                <MenuItem value="">All employees</MenuItem>
                {employees.map((employee) => (
                  <MenuItem key={employee.id} value={employee.id}>
                    {employee.fullName}
                    <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                      {employee.employeeCode}
                    </Typography>
                  </MenuItem>
                ))}
              </TextField>
            )}

            {/* Project replaces the old Status and Priority selects. Every entry
                belongs to a project and none of them has a work-status, so this
                is the only slice of the report that still asks a real question:
                "what did this project cost us in hours". Scoped by the selected
                department — the options endpoint narrows server-side. */}
            <TextField
              select
              label="Project"
              value={form.projectId}
              onChange={(event) => patch({ projectId: event.target.value })}
              disabled={projectsQuery.isPending}
              helperText={form.departmentId ? `${projects.length} in this selection` : undefined}
            >
              <MenuItem value="">All projects</MenuItem>
              {projects.map((project) => (
                <MenuItem key={project.id} value={project.id}>
                  {project.name}
                  <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                    {project.code}
                  </Typography>
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <Divider sx={{ my: 2.5 }} />

          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
              <Typography variant="subtitle2" sx={{ minWidth: 64 }}>
                Period
              </Typography>

              <ToggleButtonGroup
                exclusive
                size="small"
                value={form.periodMode}
                onChange={(_event, value) => value && patch({ periodMode: value })}
              >
                <ToggleButton value="range" sx={{ px: 1.5, textTransform: 'none' }}>
                  Date range
                </ToggleButton>
                <ToggleButton value="month" sx={{ px: 1.5, textTransform: 'none' }}>
                  Month
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            {form.periodMode === 'range' ? (
              <DateRangeFilter
                value={{ preset: form.preset, dateFrom: form.dateFrom, dateTo: form.dateTo }}
                onChange={(next) =>
                  patch({ preset: next.preset, dateFrom: next.dateFrom, dateTo: next.dateTo })
                }
              />
            ) : (
              <Stack direction="row" spacing={2}>
                <TextField
                  select
                  label="Month"
                  value={form.month}
                  onChange={(event) => patch({ month: Number(event.target.value) })}
                  sx={{ maxWidth: 180 }}
                >
                  {MONTH_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>

                <TextField
                  select
                  label="Year"
                  value={form.year}
                  onChange={(event) => patch({ year: Number(event.target.value) })}
                  sx={{ maxWidth: 140 }}
                >
                  {yearOptions().map((year) => (
                    <MenuItem key={year} value={year}>
                      {year}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>
            )}

            <FormControlLabel
              control={
                <Switch
                  checked={form.lateOnly}
                  onChange={(event) => patch({ lateOnly: event.target.checked })}
                />
              }
              label={
                <Stack>
                  <Typography variant="body2">Late updates only</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Entries logged after the slot&apos;s cut-off.
                  </Typography>
                </Stack>
              }
            />
          </Stack>

          <Divider sx={{ my: 2.5 }} />

          <Button size="small" onClick={() => setForm(DEFAULT_FORM)}>
            Reset filters
          </Button>
        </Paper>

        {/* ---------------------------------------------------------- *
         * Export — the count, then the commitment
         * ---------------------------------------------------------- */}
        <Paper sx={{ p: 3, borderRadius: 2, position: { lg: 'sticky' }, top: { lg: 88 } }}>
          <Typography variant="h6" component="h2">
            Export
          </Typography>

          <Box sx={{ mt: 2, mb: 2.5 }}>
            {isCounting ? (
              <Stack spacing={0.75}>
                <Skeleton variant="text" width="55%" height={38} />
                <Skeleton variant="text" width="80%" height={16} />
              </Stack>
            ) : previewQuery.isError ? (
              <Alert severity="warning" sx={{ py: 0.5 }}>
                Couldn&apos;t count the rows — the export will still run.
              </Alert>
            ) : (
              <>
                <Typography variant="h3" component="div" sx={{ opacity: isStale ? 0.55 : 1 }}>
                  {formatNumber(total)}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {total === 1 ? 'entry' : 'entries'} · {periodSummary}
                </Typography>
              </>
            )}
          </Box>

          {nothingToExport && (
            <Alert severity="info" sx={{ mb: 2 }}>
              Nothing matches these filters. Widen the range or clear a filter.
            </Alert>
          )}

          {pdfTruncated && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <AlertTitle sx={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                Too big for PDF
              </AlertTitle>
              The PDF is capped at {formatNumber(PDF_MAX_ROWS)} rows, so it would contain the first{' '}
              {formatNumber(PDF_MAX_ROWS)} of {formatNumber(total)} and say so on the cover. Export as
              Excel for the full set.
            </Alert>
          )}

          <Stack spacing={1.25}>
            {FORMATS.map((format) => {
              const Icon = format.icon;
              const isPending = pendingFormat === format.value;
              const isPrimary = format.value === 'EXCEL';

              return (
                <Button
                  key={format.value}
                  fullWidth
                  size="large"
                  variant={isPrimary ? 'contained' : 'outlined'}
                  disabled={exportMutation.isPending || nothingToExport || isCounting}
                  onClick={() => exportMutation.mutate(format.value)}
                  startIcon={
                    isPending ? (
                      <CircularProgress size={16} color="inherit" thickness={5} />
                    ) : (
                      <Icon sx={{ fontSize: 18 }} />
                    )
                  }
                  sx={{ justifyContent: 'flex-start', px: 2 }}
                >
                  <Stack alignItems="flex-start" sx={{ lineHeight: 1.2 }}>
                    <span>{isPending ? `Preparing ${format.label}…` : `Export ${format.label}`}</span>
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 400, opacity: 0.72, textTransform: 'none' }}
                    >
                      {format.hint}
                    </Typography>
                  </Stack>
                </Button>
              );
            })}
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            {EXPORT_LIMIT_HINT} Large exports stream, so the download can take a few seconds to start.
            Every export is recorded in the audit log.
          </Typography>
        </Paper>
      </Box>
    </Box>
  );
}
