/**
 * DELIVERY — the assigned-work block on the dashboard.
 *
 * The rest of the dashboard is about COMPLIANCE (did people log their hours). This
 * is about DELIVERY (is the assigned work getting done). It holds itself to the
 * three questions the delivery endpoint answers — on track, at risk, needs review
 * — so it stays a glance, not a second dashboard.
 *
 * It hides itself entirely when there is no assigned work in scope, so teams that
 * have not started using assignments never see an empty box.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Paper,
  Grid,
  Stack,
  Typography,
  Chip,
  Button,
  Divider,
  Avatar,
} from '@mui/material';
import AssignmentIcon from '@mui/icons-material/AssignmentOutlined';

import { dashboard } from '../../../api/endpoints.js';
import { formatDate } from '../../../utils/format.js';

const COUNTS = [
  { key: 'open', label: 'Open', tone: 'text.primary' },
  { key: 'dueSoon', label: 'Due soon', tone: 'text.primary' },
  { key: 'overdue', label: 'Overdue', tone: 'warning.main' },
  { key: 'awaitingReview', label: 'In review', tone: 'text.primary' },
  { key: 'doneThisWeek', label: 'Done · 7d', tone: 'success.main' },
];

export default function DeliveryPanel() {
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ['dashboard', 'delivery'],
    queryFn: () => dashboard.delivery({}),
    select: (r) => r.data,
    refetchInterval: 60_000,
  });

  const d = query.data;
  if (!d) return null;

  const c = d.counts ?? {};
  const totalActivity =
    (c.open ?? 0) + (c.overdue ?? 0) + (c.awaitingReview ?? 0) + (c.doneThisWeek ?? 0);
  // Nothing assigned anywhere in scope — don't render an empty section.
  if (totalActivity === 0 && d.atRisk.length === 0 && d.needsReview.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontWeight: 700, letterSpacing: '0.08em' }}>
          Assigned work
        </Typography>
        <Button size="small" onClick={() => navigate('/assignments')} sx={{ textTransform: 'none' }}>
          View all
        </Button>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, mb: 2 }}>
        <Grid container spacing={1}>
          {COUNTS.map((k) => (
            <Grid key={k.key} item xs={6} sm={2.4}>
              <Box sx={{ textAlign: 'center', py: 0.5 }}>
                <Typography variant="h5" sx={{ fontWeight: 700, color: k.tone, fontVariantNumeric: 'tabular-nums' }}>
                  {c[k.key] ?? 0}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {k.label}
                </Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Paper>

      <Grid container spacing={2} alignItems="flex-start">
        <Grid item xs={12} md={6}>
          <MiniList
            title="At risk"
            emptyText="Nothing overdue. "
            items={d.atRisk}
            onOpen={(id) => navigate(`/assignments/${id}`)}
            render={(a) => (
              <>
                {a.daysOverdue > 0 && (
                  <Chip size="small" label={`${a.daysOverdue}d late`} color="warning" sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                )}
                {a.dueDate && (
                  <Typography variant="caption" color="text.secondary">
                    due {formatDate(a.dueDate)}
                  </Typography>
                )}
              </>
            )}
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <MiniList
            title="Needs review"
            emptyText="Nothing waiting on review. "
            items={d.needsReview}
            onOpen={(id) => navigate(`/assignments/${id}`)}
            render={() => <Chip size="small" label="In review" color="secondary" sx={{ height: 18, fontSize: 10 }} />}
          />
        </Grid>
      </Grid>
    </Box>
  );
}

function MiniList({ title, items, emptyText, onOpen, render }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, height: '100%' }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <AssignmentIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        <Chip size="small" label={items.length} sx={{ height: 18, fontSize: 10 }} />
      </Stack>

      {items.length === 0 ? (
        <Typography variant="caption" color="text.secondary">
          {emptyText}
        </Typography>
      ) : (
        <Stack divider={<Divider flexItem />} spacing={0}>
          {items.map((a) => (
            <Box
              key={a.id}
              onClick={() => onOpen(a.id)}
              sx={{ py: 1, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, borderRadius: 1, px: 0.5 }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                    {a.title}
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25 }}>
                    <Avatar sx={{ width: 16, height: 16, fontSize: 9 }}>{(a.assignee?.fullName ?? '?').charAt(0)}</Avatar>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {a.assignee?.fullName ?? '—'}
                    </Typography>
                  </Stack>
                </Box>
                <Stack direction="row" spacing={0.75} alignItems="center">
                  {render(a)}
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}
