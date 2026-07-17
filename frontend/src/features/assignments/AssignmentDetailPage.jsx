/**
 * ONE ASSIGNMENT — the brief, the progress thread, and the handshake.
 *
 * THE THREAD is the point of this screen: the hourly updates the employee logged
 * against this task, in order, read as the story of the work. It is the "assigned
 * task and its descriptive completion updates, in a path together" — no separate
 * status report, because the hours they already wrote ARE the report.
 *
 * The actions enforce the handshake:
 *   · the assignee marks it done (SUBMIT);
 *   · the lead confirms (DONE) or sends it back (REOPEN); the lead can also cancel.
 */
import { useNavigate, useParams } from 'react-router-dom';
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
  Divider,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBackOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import DoneIcon from '@mui/icons-material/CheckCircleOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';
import ReplayIcon from '@mui/icons-material/ReplayOutlined';

import LoadingScreen from '../../components/common/LoadingScreen.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import { assignments as assignmentsApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSIONS } from '../../utils/constants.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { statusMeta, priorityMeta } from './meta.js';

export default function AssignmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, can } = useAuth();
  const { enqueueSnackbar } = useSnackbar();

  const query = useQuery({
    queryKey: ['assignment', id],
    queryFn: () => assignmentsApi.get(id).then((r) => r.data),
  });

  const a = query.data;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['assignment', id] });
    qc.invalidateQueries({ queryKey: ['assignments'] });
    qc.invalidateQueries({ queryKey: ['dashboard', 'delivery'] });
  };

  const act = useMutation({
    mutationFn: ({ kind, body }) => {
      if (kind === 'submit') return assignmentsApi.submit(id, body);
      if (kind === 'review') return assignmentsApi.review(id, body);
      if (kind === 'cancel') return assignmentsApi.cancel(id, body);
      throw new Error('unknown action');
    },
    onSuccess: (_res, vars) => {
      enqueueSnackbar(
        { submit: 'Submitted for review', review: 'Updated', cancel: 'Assignment cancelled' }[vars.kind],
        { variant: 'success' },
      );
      invalidate();
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (e) => enqueueSnackbar(e.message ?? 'Could not complete that action', { variant: 'error' }),
  });

  if (query.isLoading) return <LoadingScreen message="Loading assignment…" />;
  if (query.isError) return <ErrorState title="Could not load this assignment" message={query.error?.message} onRetry={() => query.refetch()} />;

  const sm = statusMeta(a.status);
  const pm = priorityMeta(a.priority);
  const isAssignee = a.assignee?.id === user?.id;

  // The handshake, expressed as buttons.
  const canSubmit = isAssignee && can(PERMISSIONS.ASSIGNMENT_SUBMIT) && (a.status === 'ASSIGNED' || a.status === 'IN_PROGRESS');
  // A reviewer confirms or reopens — but NEVER their own work. An assignee who
  // also holds review permission (a Tech Lead) still cannot sign off their own
  // task; someone else does. The server enforces this too.
  const canConfirm = can(PERMISSIONS.ASSIGNMENT_REVIEW) && a.status === 'SUBMITTED' && !isAssignee;
  const canReopen = can(PERMISSIONS.ASSIGNMENT_REVIEW) && a.status === 'DONE' && !isAssignee;
  // Shown to the assignee after they submit, so they know it is now on someone else.
  const awaitingOtherReview = isAssignee && a.status === 'SUBMITTED';
  // Cancel is only possible BEFORE work starts. Once the first hour is logged the
  // task moves to In Progress and can no longer be cancelled — real effort has
  // been recorded against it. (The server enforces this too.)
  const canCancel = can(PERMISSIONS.ASSIGNMENT_CANCEL) && a.status === 'ASSIGNED';

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/assignments')} sx={{ mb: 1.5, textTransform: 'none' }}>
        All assignments
      </Button>

      <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2, mb: 2.5 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'flex-start' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
              <Chip size="small" label={sm.label} color={sm.color} sx={{ fontWeight: 650 }} />
              {a.priority !== 'NORMAL' && (
                <Chip size="small" variant="outlined" label={pm.label} color={pm.color} />
              )}
              {a.isOverdue && <Chip size="small" label="OVERDUE" color="warning" sx={{ fontWeight: 700 }} />}
            </Stack>

            <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
              {a.title}
            </Typography>
            {a.description && (
              <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap', mb: 1.5 }}>
                {a.description}
              </Typography>
            )}

            <Stack direction="row" spacing={2} alignItems="center" sx={{ flexWrap: 'wrap', gap: 1, color: 'text.secondary' }}>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Avatar sx={{ width: 22, height: 22, fontSize: 11 }}>{(a.assignee?.fullName ?? '?').charAt(0)}</Avatar>
                <Typography variant="caption">{a.assignee?.fullName}</Typography>
              </Stack>
              {a.project && <Chip size="small" variant="outlined" label={`${a.project.code} · ${a.project.name}`} sx={{ height: 20 }} />}
              {a.dueDate && (
                <Stack direction="row" spacing={0.3} alignItems="center">
                  <ScheduleIcon sx={{ fontSize: 14 }} />
                  <Typography variant="caption">Due {formatDate(a.dueDate)}</Typography>
                </Stack>
              )}
              <Typography variant="caption">Assigned by {a.assignedBy?.fullName}</Typography>
            </Stack>
          </Box>

          <Box sx={{ minWidth: 180 }}>
            {a.percentComplete != null ? (
              <>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">
                    {a.hoursLogged}h of {a.estimatedHours}h
                  </Typography>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {a.percentComplete}%
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(a.percentComplete, 100)}
                  color={a.status === 'DONE' ? 'success' : 'primary'}
                  sx={{ height: 6, borderRadius: 3 }}
                />
              </>
            ) : (
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {a.hoursLogged}h logged
              </Typography>
            )}
          </Box>
        </Stack>

        {(canSubmit || canConfirm || canReopen || canCancel) && (
          <>
            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {canSubmit && (
                <Button variant="contained" startIcon={<SendIcon />} onClick={() => act.mutate({ kind: 'submit', body: {} })} disabled={act.isPending}>
                  Mark as done
                </Button>
              )}
              {canConfirm && (
                <Button variant="contained" color="success" startIcon={<DoneIcon />} onClick={() => act.mutate({ kind: 'review', body: { decision: 'DONE' } })} disabled={act.isPending}>
                  Confirm done
                </Button>
              )}
              {canConfirm && (
                <Button variant="outlined" startIcon={<ReplayIcon />} onClick={() => act.mutate({ kind: 'review', body: { decision: 'REOPEN' } })} disabled={act.isPending}>
                  Send back
                </Button>
              )}
              {canReopen && (
                <Button variant="outlined" startIcon={<ReplayIcon />} onClick={() => act.mutate({ kind: 'review', body: { decision: 'REOPEN' } })} disabled={act.isPending}>
                  Reopen
                </Button>
              )}
              {canCancel && (
                <Button color="inherit" onClick={() => act.mutate({ kind: 'cancel', body: {} })} disabled={act.isPending} sx={{ ml: 'auto', color: 'text.secondary' }}>
                  Cancel task
                </Button>
              )}
            </Stack>
          </>
        )}

        {awaitingOtherReview && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="body2" color="text.secondary">
              Submitted — waiting for a lead or manager to confirm it done. You can’t review your own task.
            </Typography>
          </>
        )}
      </Paper>

      {/* THE PROGRESS THREAD — the hourly updates logged against this task. */}
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Progress ({a.thread.length} {a.thread.length === 1 ? 'update' : 'updates'})
      </Typography>

      {a.thread.length === 0 ? (
        <EmptyState
          icon={ScheduleIcon}
          title="No hours logged yet"
          message="When the assignee logs an hour against this task from their sheet, it appears here as the running progress."
        />
      ) : (
        <Stack spacing={1.25} sx={{ mb: 3 }}>
          {a.thread.map((t) => (
            <Paper key={t.id} variant="outlined" sx={{ p: 1.75, borderRadius: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, color: 'text.secondary' }}>
                <Chip size="small" variant="outlined" label={`${formatDate(t.workDate)} · ${t.hour}`} sx={{ height: 20, fontSize: 10.5 }} />
                {t.isLate && <Chip size="small" label="LATE" color="warning" sx={{ height: 18, fontSize: 10 }} />}
                {t.author && (
                  <Typography variant="caption" sx={{ ml: 'auto' }}>
                    {t.author.fullName}
                  </Typography>
                )}
              </Stack>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {t.description}
              </Typography>
            </Paper>
          ))}
        </Stack>
      )}

      {/* The handshake trail — who moved this task, and when. */}
      {a.history?.length > 0 && (
        <>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
            History
          </Typography>
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Stack spacing={1}>
              {a.history.map((h, i) => (
                <Stack key={i} direction="row" spacing={1.5} alignItems="center">
                  <Tooltip title={formatDateTime(h.at)}>
                    <Chip size="small" label={statusMeta(h.to).label} color={statusMeta(h.to).color} sx={{ height: 20, fontSize: 10.5, minWidth: 84 }} />
                  </Tooltip>
                  <Typography variant="caption" color="text.secondary">
                    {h.actor}
                    {h.note ? ` — “${h.note}”` : ''}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </Paper>
        </>
      )}
    </Box>
  );
}
