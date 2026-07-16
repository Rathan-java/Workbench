import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import EditIcon from '@mui/icons-material/EditOutlined';
import DeleteIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useConfirm } from '../../components/common/ConfirmDialog.jsx';

import DataTable from '../../components/common/DataTable.jsx';
import PageHeader from '../../components/common/PageHeader.jsx';
import Guard from '../../components/common/Guard.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { dashboard as dashboardApi, projects as projectsApi } from '../../api/endpoints.js';
import { DEFAULT_PAGE_SIZE, PERMISSIONS, PROJECT_STATUS, PROJECT_STATUSES } from '../../utils/constants.js';
import { formatApiDate, formatDate, formatNumber } from '../../utils/format.js';

import DepartmentChip from './components/DepartmentChip.jsx';
import ToneChip from './components/ToneChip.jsx';
import { PROJECT_STATUS_TONE } from './components/tones.js';
import FilterBar, { SearchField, SelectFilter } from './components/FilterBar.jsx';
import { useDepartments } from './components/useDepartments.js';
import { errorMessage, isActionable } from './components/apiError.js';

const SEARCH_DEBOUNCE_MS = 400;

/**
 * A project with no hours for two months is a different animal from one that
 * moved yesterday, so "quiet for a while" earns an amber caption rather than a
 * silent dash. It is a signal to look, not a failure — nothing here is red.
 */
const STALE_AFTER_DAYS = 30;

/**
 * /dashboard/productivity/project defaults to a 30-day window, which would
 * report a two-year project as zero hours the moment it went quiet. The column
 * is about lifetime effort and true last activity, so we ask for everything from
 * the earliest date the analytics API accepts.
 */
const HOURS_SINCE = '2020-01-01';

const projectSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(2, 'At least 2 characters')
      .max(48)
      .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and hyphens only'),
    name: z.string().trim().min(2, 'At least 2 characters').max(160),
    description: z.string().trim().max(2000).or(z.literal('')),
    clientName: z.string().trim().max(160).or(z.literal('')),
    status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED']),
    startDate: z.string().or(z.literal('')),
    endDate: z.string().or(z.literal('')),
    departmentId: z.string().min(1, 'Choose a department'),
  })
  .superRefine((data, ctx) => {
    if (data.startDate && data.endDate && data.endDate < data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'The end date cannot be before the start date',
      });
    }
  });

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { options: departmentOptions, getById: getDepartment } = useDepartments();

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');

  const [formProject, setFormProject] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy,
      sortOrder,
      search: search || undefined,
      departmentId: departmentId || undefined,
      status: status || undefined,
    }),
    [page, pageSize, sortBy, sortOrder, search, departmentId, status],
  );

  const projectsQuery = useQuery({
    queryKey: ['projects', params],
    queryFn: () => projectsApi.list(params),
    placeholderData: (previous) => previous,
  });

  const hoursRange = useMemo(
    () => ({ dateFrom: HOURS_SINCE, dateTo: formatApiDate(new Date()) }),
    [],
  );

  /**
   * One unpaginated request for the whole scope, joined by projectId below —
   * cheaper and far less chatty than a per-row fetch, and it is the only source
   * that knows when a project last moved. Its numbers are scoped by the API, so
   * a Tech Lead sees their own department's hours and nobody else's.
   */
  const productivityQuery = useQuery({
    queryKey: ['project-productivity', hoursRange],
    queryFn: () => dashboardApi.projectProductivity(hoursRange),
    staleTime: 5 * 60 * 1000,
  });

  const statsByProject = useMemo(
    () => new Map((productivityQuery.data?.data ?? []).map((row) => [row.projectId, row])),
    [productivityQuery.data],
  );

  const rows = projectsQuery.data?.data ?? [];
  const total = projectsQuery.data?.meta?.pagination?.total ?? 0;

  const hasFilters = Boolean(searchInput || departmentId || status);

  const resetFilters = () => {
    setSearchInput('');
    setDepartmentId('');
    setStatus('');
    setPage(1);
  };

  const withPageReset = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const openForm = (project) => {
    setFormProject(project);
    setFormOpen(true);
  };

  const columns = useMemo(
    () => [
      {
        id: 'code',
        label: 'Code',
        sortable: true,
        render: (row) => (
          <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }} noWrap>
            {row.code}
          </Typography>
        ),
      },
      {
        id: 'name',
        label: 'Project',
        sortable: true,
        render: (row) => (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={500} noWrap sx={{ maxWidth: 260 }}>
              {row.name}
            </Typography>
            {/* The department's catch-all bucket ships with the department. Badged
                so nobody reads it as a project somebody created by mistake. */}
            {row.isInternal && <ToneChip tone="primary" label="Built-in" variant="outlined" />}
          </Stack>
        ),
      },
      {
        id: 'department',
        label: 'Department',
        render: (row) => <DepartmentChip department={row.department} />,
      },
      {
        id: 'clientName',
        label: 'Client',
        render: (row) =>
          row.clientName ? (
            <Typography variant="body2" noWrap>
              {row.clientName}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.disabled">
              Internal
            </Typography>
          ),
      },
      {
        id: 'status',
        label: 'Status',
        sortable: true,
        render: (row) => (
          <ToneChip
            tone={PROJECT_STATUS_TONE[row.status]}
            label={PROJECT_STATUS[row.status] ?? row.status}
          />
        ),
      },
      {
        /**
         * One task entry is one hour slot, so the old "Entries" count and this
         * are the same number — printing both would have been the same fact
         * twice. What the analytics join actually adds is recency: a project
         * with 200 hours and nothing since March is in more trouble than one
         * with 20 hours logged yesterday.
         */
        id: 'hoursLogged',
        label: 'Hours logged',
        align: 'right',
        render: (row) => {
          const stats = statsByProject.get(row.id);
          // A project nobody has logged against is simply absent from the
          // analytics rows — that is a zero, not missing data.
          const hours = stats?.hoursLogged ?? row.entryCount ?? 0;
          const stale = stats?.daysSinceActivity >= STALE_AFTER_DAYS;

          return (
            <Box>
              <Typography variant="body2" color={hours ? 'text.primary' : 'text.disabled'}>
                {formatNumber(hours)}
              </Typography>
              <Typography
                variant="caption"
                color={stale ? 'warning.main' : 'text.disabled'}
                noWrap
              >
                {stats?.lastActivity ? `Last ${formatDate(stats.lastActivity)}` : 'No hours yet'}
              </Typography>
            </Box>
          );
        },
      },
      {
        id: 'startDate',
        label: 'Dates',
        sortable: true,
        render: (row) =>
          row.startDate || row.endDate ? (
            <Typography variant="body2" color="text.secondary" noWrap>
              {row.startDate ? formatDate(row.startDate) : '—'} → {row.endDate ? formatDate(row.endDate) : '—'}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.disabled">
              Open-ended
            </Typography>
          ),
      },
    ],
    [statsByProject],
  );

  return (
    <Box>
      <PageHeader
        title="Projects"
        subtitle="Projects are the vocabulary every task is tagged with — one project belongs to exactly one department, and every logged hour names exactly one project."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Projects' }]}
        actions={
          <Guard permission={PERMISSIONS.PROJECT_MANAGE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openForm(null)}>
              Create project
            </Button>
          </Guard>
        }
      />

      <FilterBar onReset={resetFilters} canReset={hasFilters}>
        <SearchField
          value={searchInput}
          onChange={withPageReset(setSearchInput)}
          placeholder="Name, code, client…"
        />
        <SelectFilter
          label="Department"
          value={departmentId}
          onChange={withPageReset(setDepartmentId)}
          options={departmentOptions}
          allLabel="All departments"
          width={190}
        />
        <SelectFilter
          label="Status"
          value={status}
          onChange={withPageReset(setStatus)}
          options={PROJECT_STATUSES}
          allLabel="All statuses"
          width={160}
        />
      </FilterBar>

      {projectsQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(projectsQuery.error, 'Could not load projects.')}
        </Alert>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={projectsQuery.isLoading}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(nextSortBy, nextOrder) => {
          setSortBy(nextSortBy);
          setSortOrder(nextOrder);
        }}
        onRowClick={(row) => setDetailId(row.id)}
        emptyTitle="No projects found"
        emptyMessage={
          hasFilters
            ? 'No project matches these filters.'
            : 'Create a project so employees have something to tag their tasks against.'
        }
      />

      {formOpen && (
        <ProjectFormDialog
          project={formProject}
          departmentOptions={departmentOptions}
          getDepartment={getDepartment}
          onClose={() => setFormOpen(false)}
          onSaved={(isEdit) => {
            setFormOpen(false);
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            queryClient.invalidateQueries({ queryKey: ['project-options'] });
            enqueueSnackbar(isEdit ? 'Project updated' : 'Project created', { variant: 'success' });
          }}
        />
      )}

      {detailId && (
        <ProjectDrawer
          projectId={detailId}
          onClose={() => setDetailId(null)}
          onEdit={(project) => {
            setDetailId(null);
            openForm(project);
          }}
        />
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 * Detail drawer
 * ------------------------------------------------------------------ */

function ProjectDrawer({ projectId, onClose, onEdit }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId).then((res) => res.data),
  });

  const project = projectQuery.data;
  const loggedHours = project?.entryCount ?? 0;
  // Deletable only if it is a real, empty, non-built-in project. Anything with
  // logged hours is archived instead (the server enforces this too); the button
  // is disabled with an explanation rather than failing on click.
  const canDelete = project && !project.isInternal && loggedHours === 0;

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.remove(project.id),
    onSuccess: () => {
      enqueueSnackbar(`Project "${project.name}" deleted`, { variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Delete "${project.name}"?`,
      message:
        'This project has no logged hours, so it can be removed entirely. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (confirmed) deleteMutation.mutate();
  };

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 460 } } } }}
    >
      {projectQuery.isFetching && <LinearProgress />}

      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" noWrap>
              {project?.name ?? 'Project'}
            </Typography>
            {project && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {project.code}
              </Typography>
            )}
          </Box>

          <Stack direction="row" spacing={0.5}>
            {project && (
              <Guard permission={PERMISSIONS.PROJECT_MANAGE}>
                <Tooltip title="Edit project">
                  <IconButton size="small" onClick={() => onEdit(project)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                {!project.isInternal && (
                  <Tooltip
                    title={
                      canDelete
                        ? 'Delete this project'
                        : 'This project has logged hours — archive it instead (edit → status Archived)'
                    }
                  >
                    {/* span so the tooltip still shows while the button is disabled */}
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        disabled={!canDelete || deleteMutation.isPending}
                        onClick={handleDelete}
                        aria-label="Delete project"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
              </Guard>
            )}
            <IconButton size="small" onClick={onClose} aria-label="Close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        {projectQuery.isError && (
          <Alert severity="error">
            {errorMessage(projectQuery.error, 'Could not load this project.')}
          </Alert>
        )}

        {project && (
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <DepartmentChip department={project.department} />
              <ToneChip
                tone={PROJECT_STATUS_TONE[project.status]}
                label={PROJECT_STATUS[project.status] ?? project.status}
              />
              {project.isInternal && <ToneChip tone="primary" label="Built-in" variant="outlined" />}
              <Chip
                size="small"
                variant="outlined"
                label={`${formatNumber(project.entryCount ?? 0)} hours logged`}
              />
            </Stack>

            {project.description && (
              <Typography variant="body2" color="text.secondary">
                {project.description}
              </Typography>
            )}

            <Stack direction="row" spacing={3}>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Client
                </Typography>
                <Typography variant="body2">{project.clientName || 'Internal'}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Dates
                </Typography>
                <Typography variant="body2">
                  {project.startDate ? formatDate(project.startDate) : '—'} →{' '}
                  {project.endDate ? formatDate(project.endDate) : '—'}
                </Typography>
              </Box>
            </Stack>

            {project.isInternal && (
              <>
                <Divider />

                <Alert severity="info">
                  This is the department&apos;s <strong>catch-all</strong>, created with the
                  department itself. Every logged hour must name a project, so meetings, admin,
                  training and interviews need somewhere honest to go — which is why it stays
                  ACTIVE and keeps its code. Its name and description are yours to reword.
                </Alert>
              </>
            )}

            {/* Projects are never deleted — they are ARCHIVED, which keeps every hour
                ever logged against them. There is no delete endpoint to offer. */}
            {!project.isInternal && (
              <Typography variant="caption" color="text.disabled">
                Finished with this project? Set its status to Archived — it leaves the task-entry
                picker and every hour logged against it is preserved.
              </Typography>
            )}
          </Stack>
        )}
      </Box>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ *
 * Create / edit
 * ------------------------------------------------------------------ */

function ProjectFormDialog({ project, departmentOptions, getDepartment, onClose, onSaved }) {
  const isEdit = Boolean(project);
  // The catch-all is infrastructure: the API refuses to rename its code or move it
  // off ACTIVE (400 INTERNAL_PROJECT_MUST_STAY_ACTIVE), so the form must not offer.
  const isInternal = Boolean(project?.isInternal);
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      code: project?.code ?? '',
      name: project?.name ?? '',
      description: project?.description ?? '',
      clientName: project?.clientName ?? '',
      status: project?.status ?? 'ACTIVE',
      startDate: toDateInput(project?.startDate),
      endDate: toDateInput(project?.endDate),
      departmentId: project?.departmentId ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values) => {
      const body = {
        code: values.code,
        name: values.name,
        description: values.description,
        clientName: values.clientName,
        status: values.status,
        // The API takes plain calendar dates (`z.string().date()`); null clears them.
        startDate: values.startDate || null,
        endDate: values.endDate || null,
      };

      // A project's department is immutable (PROJECT_DEPARTMENT_IMMUTABLE) — never
      // sent on an update.
      if (isEdit) return projectsApi.update(project.id, body);

      return projectsApi.create({ ...body, departmentId: values.departmentId });
    },
    onSuccess: () => onSaved(isEdit),
    onError: (error) => setServerError(error),
  });

  const department = isEdit ? (project.department ?? getDepartment(project.departmentId)) : null;

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <DialogTitle>{isEdit ? `Edit ${project.name}` : 'Create project'}</DialogTitle>

        <DialogContent>
          {serverError && isActionable(serverError) && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServerError(null)}>
              {errorMessage(serverError)}
            </Alert>
          )}

          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {isInternal ? (
                <Box sx={{ minWidth: { sm: 200 } }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    Code
                  </Typography>
                  <Chip
                    size="small"
                    label={project.code}
                    sx={{ fontFamily: 'monospace', fontWeight: 600 }}
                  />
                  <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
                    Immutable — the seed and every new department find this project by its code.
                  </Typography>
                </Box>
              ) : (
                <Controller
                  name="code"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Code"
                      onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                      error={Boolean(errors.code)}
                      helperText={errors.code?.message ?? 'e.g. PAY-PLAT'}
                      autoFocus
                      sx={{ maxWidth: { sm: 200 } }}
                    />
                  )}
                />
              )}
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Project name"
                    error={Boolean(errors.name)}
                    helperText={errors.name?.message}
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

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="clientName"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Client (optional)"
                    error={Boolean(errors.clientName)}
                    helperText={errors.clientName?.message}
                  />
                )}
              />
              {isInternal ? (
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                    Status
                  </Typography>
                  <ToneChip tone={PROJECT_STATUS_TONE.ACTIVE} label={PROJECT_STATUS.ACTIVE} />
                  <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
                    Locked to Active — logging an hour requires a project, so every department needs
                    a non-project bucket. Archive this one and meetings, admin and training have
                    nowhere honest to go.
                  </Typography>
                </Box>
              ) : (
                <Controller
                  name="status"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Status"
                      error={Boolean(errors.status)}
                      helperText={errors.status?.message}
                    >
                      {PROJECT_STATUSES.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              )}
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="startDate"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Start date"
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={Boolean(errors.startDate)}
                    helperText={errors.startDate?.message}
                  />
                )}
              />
              <Controller
                name="endDate"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="End date"
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    error={Boolean(errors.endDate)}
                    helperText={errors.endDate?.message}
                  />
                )}
              />
            </Stack>

            {isEdit ? (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  Department
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <DepartmentChip department={department} />
                  <Typography variant="caption" color="text.disabled">
                    Immutable — its logged tasks would end up on the wrong side of the boundary.
                  </Typography>
                </Stack>
              </Box>
            ) : (
              <Controller
                name="departmentId"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    select
                    label="Department"
                    error={Boolean(errors.departmentId)}
                    helperText={
                      errors.departmentId?.message ?? 'Cannot be changed once the project exists.'
                    }
                  >
                    {departmentOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            )}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create project'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** <input type="date"> only accepts YYYY-MM-DD; the API sends an ISO timestamp. */
function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}
