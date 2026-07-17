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
import { useState } from 'react';
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
  users as usersApi,
  projects as projectsApi,
} from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSIONS, ASSIGNMENT_PRIORITIES } from '../../utils/constants.js';
import { formatDate } from '../../utils/format.js';
import { statusMeta, priorityMeta, personLabel } from './meta.js';

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
  const [form, setForm] = useState({
    assigneeId: '',
    projectId: '',
    title: '',
    description: '',
    priority: 'NORMAL',
    dueDate: '',
    estimatedHours: '',
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const usersQuery = useQuery({
    queryKey: ['assignment-assignee-options'],
    queryFn: () => usersApi.options().then((r) => r.data),
  });
  const projectsQuery = useQuery({
    queryKey: ['assignment-project-options'],
    queryFn: () => projectsApi.options().then((r) => r.data),
  });

  const assignees = (usersQuery.data ?? []).filter((u) => u.role !== 'MANAGEMENT');
  // An assignment lives in the ASSIGNEE's department, so the project must too.
  // Management sees everyone and every project, so filter the project list down to
  // the chosen assignee's department rather than letting the backend reject a
  // cross-department pick after the fact.
  const selectedAssignee = assignees.find((u) => u.id === form.assigneeId);
  const projects = selectedAssignee
    ? (projectsQuery.data ?? []).filter((p) => p.departmentId === selectedAssignee.departmentId)
    : [];

  const create = useMutation({
    mutationFn: () =>
      assignmentsApi.create({
        assigneeId: form.assigneeId,
        projectId: form.projectId,
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
          <TextField
            select
            label="Assign to"
            value={form.assigneeId}
            // Changing the assignee can change the department, so a project picked
            // for the old one no longer applies — clear it rather than carry a
            // cross-department mismatch into the submit.
            onChange={(e) => set({ assigneeId: e.target.value, projectId: '' })}
            required
            fullWidth
            helperText={usersQuery.isLoading ? 'Loading people…' : undefined}
          >
            {assignees.map((u) => (
              <MenuItem key={u.id} value={u.id}>
                {personLabel(u)}
                {u.employeeCode ? ` · ${u.employeeCode}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Project"
            value={form.projectId}
            onChange={(e) => set({ projectId: e.target.value })}
            required
            fullWidth
            disabled={!form.assigneeId}
            helperText={
              !form.assigneeId
                ? 'Pick who this is for first — the projects shown are theirs.'
                : projects.length === 0
                  ? 'This person’s department has no active projects to assign against.'
                  : 'Only projects in this person’s department are shown.'
            }
          >
            {projects.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.code} · {p.name}
              </MenuItem>
            ))}
          </TextField>
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
        <Button variant="contained" onClick={() => create.mutate()} disabled={!valid || create.isPending}>
          {create.isPending ? 'Assigning…' : 'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
