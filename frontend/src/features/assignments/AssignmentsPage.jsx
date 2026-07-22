/**
 * ASSIGNMENTS — the list of assigned work.
 *
 * This is the counterpart to the task sheet: the task sheet is what an employee
 * DID, hour by hour; this is what they have been asked to DO. A lead assigns from
 * here; everyone tracks progress from here. Clicking an assignment opens its
 * thread — the hourly updates logged against it, read top to bottom.
 *
 * Scope is the server's job: an employee sees only their own assignments, a lead
 * their department's, management all of it. This component just renders what came
 * back.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Box,
  Paper,
  Stack,
  Typography,
  Button,
  Chip,
  LinearProgress,
  Avatar,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  ListSubheader,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AssignmentIcon from '@mui/icons-material/AssignmentOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';

import PageHeader from '../../components/common/PageHeader.jsx';
import LoadingScreen from '../../components/common/LoadingScreen.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import {
  assignments as assignmentsApi,
  projects as projectsApi,
  departments as departmentsApi,
} from '../../api/endpoints.js';
import { useConfirm } from '../../components/common/ConfirmDialog.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSIONS, ASSIGNMENT_PRIORITIES } from '../../utils/constants.js';
import { formatDate, humanizeEnum } from '../../utils/format.js';
import { statusMeta, priorityMeta } from './meta.js';

const FILTERS = [
  { key: 'open', label: 'Open', params: { open: true } },
  { key: 'overdue', label: 'Overdue', params: { overdue: true } },
  { key: 'review', label: 'In review', params: { status: 'SUBMITTED' } },
  { key: 'done', label: 'Done', params: { status: 'DONE' } },
  { key: 'all', label: 'All', params: {} },
];

export default function AssignmentsPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [filter, setFilter] = useState('open');
  const [mine, setMine] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const canAssign = can(PERMISSIONS.ASSIGNMENT_CREATE);
  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  const listQuery = useQuery({
    queryKey: ['assignments', filter, mine],
    queryFn: () =>
      assignmentsApi.list({ ...activeFilter.params, mine: mine || undefined, pageSize: 100 }).then((r) => r),
  });

  const items = listQuery.data?.data ?? [];

  return (
    <Box>
      <PageHeader
        title="Assignments"
        subtitle="Assigned work and its progress"
        actions={
          canAssign ? (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              Assign task
            </Button>
          ) : null
        }
      />

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2.5, flexWrap: 'wrap', gap: 1 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={filter}
          onChange={(_, v) => v && setFilter(v)}
        >
          {FILTERS.map((f) => (
            <ToggleButton key={f.key} value={f.key} sx={{ textTransform: 'none', px: 1.5 }}>
              {f.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {can(PERMISSIONS.ASSIGNMENT_CREATE) && (
          <ToggleButton
            size="small"
            value="mine"
            selected={mine}
            onChange={() => setMine((m) => !m)}
            sx={{ textTransform: 'none', px: 1.5 }}
          >
            Assigned to me
          </ToggleButton>
        )}
      </Stack>

      {listQuery.isLoading ? (
        <LoadingScreen message="Loading assignments…" />
      ) : listQuery.isError ? (
        <ErrorState title="Could not load assignments" message={listQuery.error?.message} onRetry={() => listQuery.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={AssignmentIcon}
          title="Nothing here"
          message={
            filter === 'open'
              ? 'No open assigned work. When a task is assigned, it shows up here.'
              : 'No assignments match this filter.'
          }
        />
      ) : (
        <Stack spacing={1.5}>
          {items.map((a) => (
            <AssignmentRow key={a.id} a={a} onClick={() => navigate(`/assignments/${a.id}`)} />
          ))}
        </Stack>
      )}

      {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} />}
    </Box>
  );
}

function AssignmentRow({ a, onClick }) {
  const sm = statusMeta(a.status);
  const pm = priorityMeta(a.priority);

  return (
    <Paper
      variant="outlined"
      onClick={onClick}
      sx={{
        p: 2,
        borderRadius: 2,
        cursor: 'pointer',
        transition: 'border-color 120ms, background-color 120ms',
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
      }}
    >
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 650 }} noWrap>
              {a.title}
            </Typography>
            <Chip size="small" label={sm.label} color={sm.color} sx={{ height: 20, fontSize: 11, fontWeight: 600 }} />
            {a.priority !== 'NORMAL' && a.priority !== 'LOW' && (
              <Chip size="small" variant="outlined" label={pm.label} color={pm.color} sx={{ height: 20, fontSize: 11 }} />
            )}
            {a.isOverdue && (
              <Chip size="small" label="OVERDUE" color="warning" sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }} />
            )}
          </Stack>

          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.75, color: 'text.secondary' }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Avatar sx={{ width: 20, height: 20, fontSize: 10 }}>{(a.assignee?.fullName ?? '?').charAt(0)}</Avatar>
              <Typography variant="caption">{a.assignee?.fullName ?? '—'}</Typography>
            </Stack>
            {a.project && <Chip size="small" variant="outlined" label={a.project.code} sx={{ height: 18, fontSize: 10 }} />}
            {a.module && (
              <Tooltip title={`Module · ${humanizeEnum(a.module.status)}`}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={a.module.name}
                  sx={{ height: 18, fontSize: 10, maxWidth: 160 }}
                />
              </Tooltip>
            )}
            {a.dueDate && (
              <Tooltip title="Due date">
                <Stack direction="row" spacing={0.3} alignItems="center">
                  <ScheduleIcon sx={{ fontSize: 13 }} />
                  <Typography variant="caption">{formatDate(a.dueDate)}</Typography>
                </Stack>
              </Tooltip>
            )}
          </Stack>
        </Box>

        <Box sx={{ minWidth: 140 }}>
          {a.percentComplete != null ? (
            <>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                <Typography variant="caption" color="text.secondary">
                  {a.hoursLogged}h / {a.estimatedHours}h
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {a.percentComplete}%
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={Math.min(a.percentComplete, 100)}
                color={a.status === 'DONE' ? 'success' : 'primary'}
                sx={{ height: 5, borderRadius: 3 }}
              />
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {a.hoursLogged}h logged
            </Typography>
          )}
        </Box>
      </Stack>
    </Paper>
  );
}

/** Assign work to an employee. Only rendered for a lead/manager. */
function CreateDialog({ onClose }) {
  const qc = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const [form, setForm] = useState({
    departmentId: '',
    assigneeId: '',
    projectId: '',
    moduleId: '',
    title: '',
    description: '',
    priority: 'NORMAL',
    dueDate: '',
    estimatedHours: '',
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /**
   * DEPARTMENT → PROJECT → PERSON.
   *
   * The order matters. Management sees every employee in the company, so asking
   * for the person first means scrolling a flat list of everyone to find someone
   * who might not even work on the project in question. Narrowing by department
   * and then by project means that by the time the list of people appears, it is
   * already the right shortlist — and can say who is actually on the work.
   */
  const departmentsQuery = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.list().then((r) => r.data),
  });
  const departments = (departmentsQuery.data ?? []).filter((d) => d.isActive);

  const projectsQuery = useQuery({
    queryKey: ['assignment-project-options', form.departmentId],
    queryFn: () => projectsApi.options({ departmentId: form.departmentId }).then((r) => r.data),
    enabled: Boolean(form.departmentId),
  });
  const projects = projectsQuery.data ?? [];

  /**
   * Everyone in the project's department, members of it first, each carrying the
   * hours they have actually logged against it. NOT filtered to members only —
   * a new project has none, and a members-only list could never be given its
   * first person.
   */
  const assignableQuery = useQuery({
    queryKey: ['project-assignable', form.projectId],
    queryFn: () => projectsApi.assignable(form.projectId).then((r) => r.data),
    enabled: Boolean(form.projectId),
  });
  const assignable = assignableQuery.data ?? [];
  const members = assignable.filter((p) => p.isMember);
  const others = assignable.filter((p) => !p.isMember);
  const chosen = assignable.find((p) => p.id === form.assigneeId);

  // A single department is not a choice. A Tech Lead has exactly one, so the
  // dropdown would be a step that can only be completed one way.
  const onlyDepartmentId = departments.length === 1 ? departments[0].id : null;
  useEffect(() => {
    if (onlyDepartmentId) set({ departmentId: onlyDepartmentId });
  }, [onlyDepartmentId]);

  // The deliverables of the chosen project. Fetched only once a project is picked,
  // and only ACTIVE ones are offered — a retired module is kept for the history of
  // work already done against it, not for new work.
  const modulesQuery = useQuery({
    queryKey: ['project-modules', form.projectId],
    queryFn: () => projectsApi.listModules(form.projectId).then((r) => r.data),
    enabled: Boolean(form.projectId),
  });
  const modules = (modulesQuery.data ?? []).filter((m) => m.isActive);

  const create = useMutation({
    mutationFn: (addToProject = false) =>
      assignmentsApi.create({
        assigneeId: form.assigneeId,
        projectId: form.projectId,
        addToProject,
        moduleId: form.moduleId || undefined,
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        priority: form.priority,
        dueDate: form.dueDate || undefined,
        estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : undefined,
      }),
    onSuccess: () => {
      enqueueSnackbar('Task assigned', { variant: 'success' });
      qc.invalidateQueries({ queryKey: ['assignments'] });
      qc.invalidateQueries({ queryKey: ['dashboard', 'delivery'] });
      onClose();
    },
    onError: (e) => enqueueSnackbar(e.message ?? 'Could not assign the task', { variant: 'error' }),
  });

  const valid = form.assigneeId && form.projectId && form.title.trim().length >= 3;
  const projectName = projects.find((p) => p.id === form.projectId)?.name ?? 'this project';

  /**
   * Assigning work to somebody who is not on the project is a legitimate thing
   * to do — it is how people join projects. But it is a second decision, so it
   * is asked rather than assumed, and answering yes does both in one call.
   */
  const submit = async () => {
    if (chosen && !chosen.isMember) {
      const confirmed = await confirm({
        title: `${chosen.fullName} is not on ${projectName}`,
        message: `They are in the right department but have not been put on this project. Assign the task and add them to ${projectName}?`,
        confirmLabel: 'Assign and add',
      });
      if (!confirmed) return;
      create.mutate(true);
      return;
    }
    create.mutate(false);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Assign a task</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="Task"
            placeholder="What needs to be done?"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            required
            fullWidth
            autoFocus
          />
          <TextField
            label="Details (optional)"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            fullWidth
            multiline
            minRows={2}
          />
          {/* Hidden when there is only one — a Tech Lead has exactly one
              department, and a dropdown with a single option is a step that can
              only be completed one way. */}
          {departments.length > 1 && (
            <TextField
              select
              label="Department"
              value={form.departmentId}
              onChange={(e) =>
                set({ departmentId: e.target.value, projectId: '', assigneeId: '', moduleId: '' })
              }
              required
              fullWidth
            >
              {departments.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  {d.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            select
            label="Project"
            value={form.projectId}
            // A module belongs to one project, and the shortlist of people is
            // derived from it, so a project change invalidates both.
            onChange={(e) => set({ projectId: e.target.value, moduleId: '', assigneeId: '' })}
            required
            fullWidth
            disabled={!form.departmentId}
            helperText={
              !form.departmentId
                ? 'Pick the department first.'
                : projects.length === 0
                  ? 'This department has no active projects to assign against.'
                  : undefined
            }
          >
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.code} · {p.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Assign to"
            value={form.assigneeId}
            onChange={(e) => set({ assigneeId: e.target.value })}
            required
            fullWidth
            disabled={!form.projectId}
            helperText={
              !form.projectId
                ? 'Pick the project first — the people on it are listed at the top.'
                : chosen && !chosen.isMember
                  ? `${chosen.fullName} is not on this project yet. You will be asked to add them.`
                  : undefined
            }
          >
            {members.length > 0 && <ListSubheader>On this project</ListSubheader>}
            {members.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                <Box component="span" sx={{ color: 'text.primary' }}>
                  {u.fullName}
                </Box>
                <Box component="span" sx={{ ml: 1, color: 'text.secondary', fontSize: '0.8em' }}>
                  {u.hoursLogged > 0 ? `${u.hoursLogged}h logged` : 'no hours yet'}
                </Box>
              </MenuItem>
            ))}
            {others.length > 0 && <ListSubheader>Elsewhere in the department</ListSubheader>}
            {/* Deliberately muted, not hidden. Assigning to someone new is how
                people join a project; the colour says "this is a change", the
                confirmation asks whether you meant it. */}
            {others.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {u.fullName}
                  {u.role === 'TECH_LEAD' ? ' · lead' : ''}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          {/* Only rendered when the project actually has modules. A project with
              none is not incomplete — many are a single stream of work — and an
              empty dropdown would read as a missing step. */}
          {modules.length > 0 && (
            <TextField
              select
              label="Module (optional)"
              value={form.moduleId}
              onChange={(e) => set({ moduleId: e.target.value })}
              fullWidth
              helperText="Which deliverable this belongs to. Links the hours logged against it to the module's progress."
            >
              <MenuItem value="">
                <em>Not tied to a module</em>
              </MenuItem>
              {modules.map((m) => (
                <MenuItem key={m.id} value={m.id}>
                  {m.name} · {humanizeEnum(m.status)}
                </MenuItem>
              ))}
            </TextField>
          )}
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Priority"
              value={form.priority}
              onChange={(e) => set({ priority: e.target.value })}
              fullWidth
            >
              {ASSIGNMENT_PRIORITIES.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              type="date"
              label="Due date (optional)"
              value={form.dueDate}
              onChange={(e) => set({ dueDate: e.target.value })}
              fullWidth
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              type="number"
              label="Est. hours (optional)"
              value={form.estimatedHours}
              onChange={(e) => set({ estimatedHours: e.target.value })}
              fullWidth
              inputProps={{ min: 1, max: 2000 }}
              helperText="Enables a % complete"
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={!valid || create.isPending}>
          {create.isPending ? 'Assigning…' : 'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
