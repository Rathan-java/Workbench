/**
 * The Tech Lead's approval queue.
 *
 * Submitted sheets, oldest first — because the thing that has been waiting
 * longest is the thing that is blocking someone. Sorting newest-first would be
 * the natural instinct and exactly the wrong one: it buries the person who has
 * been waiting three days under the person who submitted five minutes ago.
 *
 * Scoped automatically. A Tech Lead's queue contains their department; nothing
 * in this file filters by department, because the API never hands them anything
 * else.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Stack,
  Avatar,
  Chip,
  Button,
  LinearProgress,
  Skeleton,
  Alert,
  Divider,
  Tooltip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlined';
import CancelIcon from '@mui/icons-material/CancelOutlined';
import VisibilityIcon from '@mui/icons-material/VisibilityOutlined';
import InboxIcon from '@mui/icons-material/InboxOutlined';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';

import PageHeader from '../../components/common/PageHeader.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import ReviewDialog from './ReviewDialog.jsx';
import { tasks as tasksApi } from '../../api/endpoints.js';
import { formatDate, formatRelative, initials } from '../../utils/format.js';

export default function ApprovalsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [review, setReview] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tasks', 'pending-approvals'],
    queryFn: () => tasksApi.listPending({ pageSize: 100 }),
    // A lead leaves this tab open. Poll so a sheet submitted while they are
    // looking at it actually appears, rather than requiring a manual refresh.
    refetchInterval: 60_000,
  });

  const days = data?.data ?? [];

  const done = () => {
    setReview(null);
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  return (
    <Box>
      <PageHeader
        title="Approvals"
        subtitle={
          days.length
            ? `${days.length} task sheet${days.length === 1 ? '' : 's'} waiting for your review — oldest first`
            : 'Task sheets submitted by your team'
        }
      />

      {isLoading && (
        <Stack spacing={1.5}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rounded" height={96} />
          ))}
        </Stack>
      )}

      {isError && (
        <ErrorState
          title="Could not load the approval queue"
          message={error?.message}
          onRetry={refetch}
        />
      )}

      {!isLoading && !isError && days.length === 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <EmptyState
            icon={InboxIcon}
            title="Nothing to review"
            message="No task sheets are waiting for your approval. Your team is up to date."
          />
        </Paper>
      )}

      <Stack spacing={1.5}>
        {days.map((day) => {
          const complete = day.completionRate >= 100;

          return (
            <Paper key={day.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={2}
                alignItems={{ md: 'center' }}
              >
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flex: 1, minWidth: 0 }}>
                  <Avatar
                    src={day.user?.avatarPath ? `/uploads/${day.user.avatarPath}` : undefined}
                    sx={{ width: 40, height: 40 }}
                  >
                    {initials(day.user?.fullName)}
                  </Avatar>

                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }} noWrap>
                      {day.user?.fullName}
                    </Typography>
                    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="caption" color="text.secondary">
                        {day.user?.employeeCode}
                      </Typography>
                      {day.department && (
                        <Chip
                          size="small"
                          label={day.department.name}
                          sx={{
                            height: 17,
                            fontSize: 10,
                            fontWeight: 700,
                            bgcolor: `${day.department.colorHex}1a`,
                            color: day.department.colorHex,
                          }}
                        />
                      )}
                      {day.team && (
                        <Typography variant="caption" color="text.disabled">
                          {day.team.name}
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                </Stack>

                <Box sx={{ minWidth: 150 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="body2" sx={{ fontWeight: 650, fontSize: 13 }}>
                      {formatDate(day.workDate)}
                    </Typography>
                    {!complete && (
                      <Tooltip title="This sheet is not fully filled in">
                        <Chip
                          size="small"
                          label="INCOMPLETE"
                          color="warning"
                          sx={{ height: 17, fontSize: 9, fontWeight: 800 }}
                        />
                      </Tooltip>
                    )}
                  </Stack>

                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
                    {day.filledSlots}/{day.expectedSlots} hours
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={Math.min(day.completionRate, 100)}
                    color={complete ? 'success' : 'warning'}
                    sx={{ height: 5, borderRadius: 3, mt: 0.25 }}
                  />
                </Box>

                <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 130 }}>
                  <ScheduleIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                  <Typography variant="caption" color="text.secondary">
                    Submitted {formatRelative(day.submittedAt)}
                  </Typography>
                </Stack>

                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />

                <Stack direction="row" spacing={0.75}>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<VisibilityIcon sx={{ fontSize: 16 }} />}
                    onClick={() =>
                      navigate(`/monitor?userId=${day.userId}&date=${day.workDate}`)
                    }
                  >
                    Review
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="warning"
                    startIcon={<CancelIcon sx={{ fontSize: 16 }} />}
                    onClick={() => setReview({ day, decision: 'REJECT', employee: day.user })}
                  >
                    Return
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    startIcon={<CheckCircleIcon sx={{ fontSize: 16 }} />}
                    onClick={() => setReview({ day, decision: 'APPROVE', employee: day.user })}
                  >
                    Approve
                  </Button>
                </Stack>
              </Stack>

              {!complete && (
                <Alert severity="warning" sx={{ mt: 1.5, py: 0.25 }}>
                  <Typography variant="caption">
                    This sheet was submitted with {day.expectedSlots - day.filledSlots} hour(s)
                    unlogged. Open it before approving.
                  </Typography>
                </Alert>
              )}
            </Paper>
          );
        })}
      </Stack>

      <ReviewDialog
        open={Boolean(review)}
        day={review?.day}
        employee={review?.employee}
        decision={review?.decision}
        onClose={() => setReview(null)}
        onDone={done}
      />
    </Box>
  );
}
