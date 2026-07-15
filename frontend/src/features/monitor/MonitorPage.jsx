/**
 * THE MONITORING SCREEN.
 *
 * This is the screen the brief was really about: "the management login must be
 * able to see all the employee tasks with a dropdown for every department and
 * every date and every individual employee."
 *
 * So: three dropdowns — DEPARTMENT, DATE, EMPLOYEE — and the selected person's
 * hourly sheet rendered read-only beside them.
 *
 * THE SAME SCREEN SERVES A TECH LEAD, and this is the part that matters:
 * the dropdowns are populated from scoped endpoints. Management's department
 * dropdown returns four options; a Tech Lead's returns exactly one, and their
 * employee dropdown can only ever contain their own department's staff. There is
 * no `if (role === 'MANAGEMENT')` anywhere in this file — the API simply does not
 * hand a lead the other departments, so there is nothing to hide.
 *
 * Filter state lives in the URL, so a manager can send "look at this" as a link.
 */
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Box,
  Paper,
  Grid,
  TextField,
  MenuItem,
  Typography,
  Stack,
  Chip,
  Avatar,
  Button,
  Alert,
  LinearProgress,
  Divider,
  Skeleton,
  ToggleButtonGroup,
  ToggleButton,
  Tooltip,
  useTheme,
} from '@mui/material';
import PersonSearchIcon from '@mui/icons-material/PersonSearchOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';
import ViewListIcon from '@mui/icons-material/ViewListOutlined';
import GridViewIcon from '@mui/icons-material/GridViewOutlined';

import PageHeader from '../../components/common/PageHeader.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import TaskCellEditor from '../tasks/TaskCellEditor.jsx';
import TaskHistoryDrawer from '../tasks/TaskHistoryDrawer.jsx';
import ReviewDialog from '../approvals/ReviewDialog.jsx';
import {
  tasks as tasksApi,
  users as usersApi,
  departments as departmentsApi,
  projects as projectsApi,
} from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSIONS } from '../../utils/constants.js';
import { formatApiDate, formatDate, initials } from '../../utils/format.js';

const DAY_STATUS_COLOR = {
  DRAFT: 'default',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REJECTED: 'warning',
};

export default function MonitorPage() {
  const [params, setParams] = useSearchParams();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { can } = useAuth();

  const date = params.get('date') ?? formatApiDate(new Date());
  const departmentId = params.get('departmentId') ?? '';
  const userId = params.get('userId') ?? '';
  const [view, setView] = useState('grid');
  const [historyEntry, setHistoryEntry] = useState(null);
  const [reviewDay, setReviewDay] = useState(null);

  const patch = (updates) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: true });
  };

  // --- the three dropdowns, all fed by SCOPED endpoints -------------------

  const departmentsQuery = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.list(),
    staleTime: 30 * 60 * 1000,
  });

  const departments = departmentsQuery.data?.data ?? [];

  // A Tech Lead gets exactly one department back, so preselect it. They should
  // never have to pick from a dropdown of one.
  useEffect(() => {
    if (!departmentId && departments.length === 1) {
      patch({ departmentId: departments[0].id });
    }
  }, [departments, departmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const employeesQuery = useQuery({
    queryKey: ['users', 'options', departmentId],
    queryFn: () => usersApi.options({ departmentId: departmentId || undefined }),
    enabled: departments.length > 0,
  });

  const employees = useMemo(
    () => (employeesQuery.data?.data ?? []).filter((u) => u.role !== 'MANAGEMENT'),
    [employeesQuery.data],
  );

  // --- the compliance roster (who has / hasn't logged) --------------------

  const complianceQuery = useQuery({
    queryKey: ['dashboard', 'compliance', date, departmentId],
    queryFn: () =>
      import('../../api/endpoints.js').then(({ dashboard }) =>
        dashboard.compliance({ date, departmentId: departmentId || undefined }),
      ),
    enabled: can(PERMISSIONS.DASHBOARD_TEAM),
  });

  const roster = complianceQuery.data?.data;

  // --- the selected person's sheet ----------------------------------------

  const gridQuery = useQuery({
    queryKey: ['tasks', 'grid', date, userId],
    queryFn: () => tasksApi.getGrid({ date, userId }),
    enabled: Boolean(userId),
  });

  const grid = gridQuery.data?.data;
  const targetDepartmentId = grid?.employee?.departmentId;

  const configQuery = useQuery({
    queryKey: ['departments', targetDepartmentId, 'config'],
    queryFn: () => departmentsApi.config(targetDepartmentId),
    enabled: Boolean(targetDepartmentId),
    staleTime: 30 * 60 * 1000,
  });

  const projectsQuery = useQuery({
    queryKey: ['projects', 'options', targetDepartmentId],
    queryFn: () => projectsApi.options({ departmentId: targetDepartmentId }),
    enabled: Boolean(targetDepartmentId),
    staleTime: 10 * 60 * 1000,
  });

  // --- a lead correcting an employee's entry ------------------------------

  const saveEntry = useMutation({
    mutationFn: (body) => tasksApi.saveEntry({ date, userId, ...body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', 'grid', date, userId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'compliance'] });
      // The employee is notified server-side that their sheet was edited — say so,
      // so the lead is never surprised by an awkward conversation later.
      enqueueSnackbar('Entry updated. The employee has been notified.', { variant: 'info' });
    },
  });

  const canEditOthers = grid?.permissions?.canEdit && can(PERMISSIONS.TASK_WRITE_ANY);

  return (
    <Box>
      <PageHeader
        title="Monitor"
        subtitle="Every employee's hourly work, by department, date and person."
      />

      {/* ─── THE THREE DROPDOWNS ─────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2.5, borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6} md={3}>
            <TextField
              select
              fullWidth
              size="small"
              label="Department"
              value={departmentId}
              onChange={(e) => patch({ departmentId: e.target.value, userId: '' })}
              // A lead's list has one entry; locking it makes the boundary explicit
              // rather than dangling a dropdown that cannot do anything.
              disabled={departments.length <= 1}
              helperText={
                departments.length === 1 ? 'You can only view your own department' : ' '
              }
            >
              {departments.length > 1 && <MenuItem value="">All departments</MenuItem>}
              {departments.map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box
                      sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: d.colorHex }}
                    />
                    <span>{d.name}</span>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={12} sm={6} md={3}>
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Date"
              value={date}
              onChange={(e) => e.target.value && patch({ date: e.target.value })}
              inputProps={{ max: formatApiDate(new Date()) }}
              InputLabelProps={{ shrink: true }}
              sx={{ '& input': { colorScheme: theme.palette.mode } }}
              helperText=" "
            />
          </Grid>

          <Grid item xs={12} sm={8} md={4}>
            <TextField
              select
              fullWidth
              size="small"
              label="Employee"
              value={userId}
              onChange={(e) => patch({ userId: e.target.value })}
              helperText={
                employees.length === 0 && !employeesQuery.isLoading
                  ? 'No employees in this department'
                  : `${employees.length} employee(s)`
              }
            >
              <MenuItem value="">
                <em>Select an employee…</em>
              </MenuItem>
              {employees.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Avatar sx={{ width: 20, height: 20, fontSize: 9 }}>
                      {initials(u.fullName)}
                    </Avatar>
                    <span>{u.fullName}</span>
                    <Typography variant="caption" color="text.disabled">
                      {u.employeeCode}
                    </Typography>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid item xs={12} sm={4} md={2}>
            <ToggleButtonGroup
              size="small"
              exclusive
              fullWidth
              value={view}
              onChange={(_e, v) => v && setView(v)}
            >
              <ToggleButton value="grid">
                <Tooltip title="Hourly grid">
                  <GridViewIcon sx={{ fontSize: 17 }} />
                </Tooltip>
              </ToggleButton>
              <ToggleButton value="list">
                <Tooltip title="Compact list">
                  <ViewListIcon sx={{ fontSize: 17 }} />
                </Tooltip>
              </ToggleButton>
            </ToggleButtonGroup>
          </Grid>
        </Grid>
      </Paper>

      <Grid container spacing={2.5}>
        {/* ─── who has / hasn't logged, this date ────────────────────────── */}
        <Grid item xs={12} lg={4}>
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {formatDate(date)}
              </Typography>
              {roster && (
                <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                  <Chip
                    size="small"
                    label={`${roster.summary.compliant} complete`}
                    color="success"
                    variant="outlined"
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }}
                  />
                  <Chip
                    size="small"
                    label={`${roster.summary.partial} partial`}
                    color="warning"
                    variant="outlined"
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }}
                  />
                  <Chip
                    size="small"
                    label={`${roster.summary.missing} missing`}
                    color="warning"
                    variant={roster.summary.missing > 0 ? 'filled' : 'outlined'}
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700 }}
                  />
                </Stack>
              )}
            </Box>

            <Box sx={{ maxHeight: 640, overflowY: 'auto' }}>
              {complianceQuery.isLoading &&
                [0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="rectangular" height={58} sx={{ m: 1, borderRadius: 1 }} />
                ))}

              {roster?.employees?.length === 0 && (
                <EmptyState
                  icon={PersonSearchIcon}
                  title="No employees"
                  message="No one is assigned to this department yet."
                  dense
                />
              )}

              {(roster?.employees ?? []).map((e) => (
                <Box
                  key={e.userId}
                  onClick={() => patch({ userId: e.userId })}
                  sx={{
                    px: 2,
                    py: 1.25,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    cursor: 'pointer',
                    borderBottom: 1,
                    borderColor: 'divider',
                    borderLeft: 3,
                    borderLeftColor:
                      e.userId === userId
                        ? 'primary.main'
                        : e.missingSlots === 0
                          ? 'success.main'
                          : e.hasLogged
                            ? 'warning.main'
                            : 'warning.main',
                    bgcolor: e.userId === userId ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Avatar
                    src={e.avatarPath ? `/uploads/${e.avatarPath}` : undefined}
                    sx={{ width: 30, height: 30, fontSize: 11 }}
                  >
                    {initials(e.fullName)}
                  </Avatar>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13 }} noWrap>
                      {e.fullName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                      {e.filledSlots}/{e.expectedSlots} hours
                      {e.missingSlots > 0 && ` · ${e.missingSlots} missing`}
                    </Typography>
                  </Box>

                  <Chip
                    size="small"
                    label={`${e.complianceRate}%`}
                    color={
                      e.complianceRate >= 100 ? 'success' : e.complianceRate > 0 ? 'warning' : 'error'
                    }
                    variant="outlined"
                    sx={{ height: 20, fontSize: 10.5, fontWeight: 700, minWidth: 44 }}
                  />
                </Box>
              ))}
            </Box>
          </Paper>
        </Grid>

        {/* ─── the selected employee's sheet ─────────────────────────────── */}
        <Grid item xs={12} lg={8}>
          {!userId && (
            <Paper variant="outlined" sx={{ borderRadius: 2 }}>
              <EmptyState
                icon={PersonSearchIcon}
                title="Select an employee"
                message="Choose someone from the list to see exactly what they logged, hour by hour."
              />
            </Paper>
          )}

          {userId && gridQuery.isLoading && (
            <Stack spacing={1.5}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} variant="rounded" height={160} />
              ))}
            </Stack>
          )}

          {userId && gridQuery.isError && (
            <Alert severity="error">{gridQuery.error?.message ?? 'Could not load that sheet.'}</Alert>
          )}

          {userId && grid && (
            <>
              <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={2}
                  alignItems={{ sm: 'center' }}
                >
                  <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                    <Avatar sx={{ width: 40, height: 40 }}>
                      {initials(grid.employee.fullName)}
                    </Avatar>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }} noWrap>
                        {grid.employee.fullName}
                      </Typography>
                      <Stack direction="row" spacing={0.75} alignItems="center">
                        <Typography variant="caption" color="text.secondary">
                          {grid.employee.employeeCode}
                        </Typography>
                        <Chip
                          size="small"
                          label={grid.employee.department?.name}
                          sx={{
                            height: 17,
                            fontSize: 10,
                            fontWeight: 700,
                            bgcolor: `${grid.employee.department?.colorHex ?? '#2563EB'}1a`,
                            color: grid.employee.department?.colorHex ?? '#2563EB',
                          }}
                        />
                      </Stack>
                    </Box>
                  </Stack>

                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip
                      size="small"
                      label={grid.day.status}
                      color={DAY_STATUS_COLOR[grid.day.status]}
                      sx={{ fontWeight: 700, height: 22 }}
                    />
                    <Box sx={{ minWidth: 100 }}>
                      <Typography variant="caption" color="text.secondary">
                        {grid.summary.filledSlots}/{grid.summary.requiredSlots} hours
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(grid.summary.completionRate, 100)}
                        color={grid.summary.completionRate >= 100 ? 'success' : 'warning'}
                        sx={{ height: 5, borderRadius: 3, mt: 0.25 }}
                      />
                    </Box>
                  </Stack>
                </Stack>

                {grid.day.status === 'SUBMITTED' && grid.permissions.canReview && (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="contained"
                        color="success"
                        startIcon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
                        onClick={() => setReviewDay({ day: grid.day, decision: 'APPROVE', employee: grid.employee })}
                      >
                        Approve
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="warning"
                        startIcon={<CancelIcon sx={{ fontSize: 16 }} />}
                        onClick={() => setReviewDay({ day: grid.day, decision: 'REJECT', employee: grid.employee })}
                      >
                        Return for changes
                      </Button>
                    </Stack>
                  </>
                )}

                {grid.day.status === 'APPROVED' && grid.permissions.canReview && (
                  <>
                    <Divider sx={{ my: 1.5 }} />
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                        Approved by {grid.day.reviewedBy?.fullName ?? '—'}
                        {grid.day.reviewNote && ` · “${grid.day.reviewNote}”`}
                      </Typography>
                      <Button
                        size="small"
                        variant="text"
                        startIcon={<ReplayIcon sx={{ fontSize: 15 }} />}
                        onClick={() => setReviewDay({ day: grid.day, decision: 'REOPEN', employee: grid.employee })}
                      >
                        Reopen
                      </Button>
                    </Stack>
                  </>
                )}
              </Paper>

              {canEditOthers && (
                <Alert severity="info" sx={{ mb: 2, py: 0.5 }}>
                  You can correct this sheet. Every edit is flagged and the employee is notified.
                </Alert>
              )}

              {view === 'grid' ? (
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.5,
                    gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
                  }}
                >
                  {(grid.cells ?? [])
                    .filter((c) => !c.timeSlot.isBreak)
                    .map((cell) => (
                      <TaskCellEditor
                        key={cell.timeSlot.id}
                        cell={cell}
                        fieldDefinitions={configQuery.data?.data?.fieldDefinitions ?? []}
                        projects={projectsQuery.data?.data ?? []}
                        readOnly={!canEditOthers}
                        onSave={async (body) => {
                          const result = await saveEntry.mutateAsync(body);
                          return result.data;
                        }}
                        onViewHistory={setHistoryEntry}
                        // Depends on whose sheet is open: required for an employee,
                        // optional for a Tech Lead being viewed.
                        projectRequired={grid.projectRequired ?? true}
                      />
                    ))}
                </Box>
              ) : (
                <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                  {(grid.cells ?? [])
                    .filter((c) => !c.timeSlot.isBreak)
                    .map((cell) => (
                      <Box
                        key={cell.timeSlot.id}
                        sx={{
                          display: 'flex',
                          gap: 2,
                          px: 2,
                          py: 1.5,
                          borderBottom: 1,
                          borderColor: 'divider',
                          bgcolor: cell.entry ? 'transparent' : 'action.hover',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, minWidth: 92, color: 'text.secondary', pt: 0.25 }}
                        >
                          {cell.timeSlot.label}
                        </Typography>

                        {cell.entry ? (
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" sx={{ fontSize: 13.5, mb: 0.75 }}>
                              {cell.entry.description}
                            </Typography>
                            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                              {/* No status, no priority: the hour is already worked, so it
                                  has no work-state left to be in and nothing left to
                                  prioritise. The PROJECT is what management slices this
                                  list by, so it is what the row leads with. */}
                              {cell.entry.project ? (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  color="primary"
                                  label={`${cell.entry.project.code} · ${cell.entry.project.name}`}
                                  sx={{ height: 19, fontSize: 10, maxWidth: '100%' }}
                                />
                              ) : (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label="No project"
                                  sx={{ height: 19, fontSize: 10, color: 'text.disabled' }}
                                />
                              )}
                              {cell.entry.isLate && (
                                <Chip
                                  size="small"
                                  color="warning"
                                  label="LATE"
                                  sx={{ height: 19, fontSize: 9.5, fontWeight: 800 }}
                                />
                              )}
                            </Stack>
                          </Box>
                        ) : (
                          <Typography
                            variant="body2"
                            sx={{ flex: 1, fontSize: 13, color: 'text.disabled', fontStyle: 'italic' }}
                          >
                            Not logged
                          </Typography>
                        )}
                      </Box>
                    ))}
                </Paper>
              )}
            </>
          )}
        </Grid>
      </Grid>

      <TaskHistoryDrawer entry={historyEntry} onClose={() => setHistoryEntry(null)} />

      <ReviewDialog
        open={Boolean(reviewDay)}
        day={reviewDay?.day}
        employee={reviewDay?.employee}
        decision={reviewDay?.decision}
        onClose={() => setReviewDay(null)}
        onDone={() => {
          setReviewDay(null);
          queryClient.invalidateQueries({ queryKey: ['tasks'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        }}
      />
    </Box>
  );
}
