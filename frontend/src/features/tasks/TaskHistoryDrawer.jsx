/**
 * The change history of one hourly entry.
 *
 * The brief asked that editing an entry stores the previous value. This renders
 * what the server actually stores: a full, append-only revision list with a
 * precomputed field-level diff, the actor, and the timestamp.
 *
 * The diff is rendered as "old → new" per field rather than as two JSON blobs.
 * A Tech Lead asking "what did they change at 4pm?" wants an answer, not a
 * document to read.
 */
import { useQuery } from '@tanstack/react-query';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  Stack,
  Chip,
  Avatar,
  Divider,
  Skeleton,
  Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { tasks as tasksApi } from '../../api/endpoints.js';
import { formatDateTime, initials, humanizeEnum } from '../../utils/format.js';
import EmptyState from '../../components/common/EmptyState.jsx';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';

const ACTION_META = {
  CREATE: { label: 'Created', color: 'success' },
  UPDATE: { label: 'Updated', color: 'info' },
  DELETE: { label: 'Deleted', color: 'error' },
  LEAD_EDIT: { label: 'Edited by Tech Lead', color: 'warning' },
  APPROVE: { label: 'Approved', color: 'success' },
  REJECT: { label: 'Rejected', color: 'error' },
  REOPEN: { label: 'Reopened', color: 'default' },
};

/**
 * Field keys renamed for humans — nobody wants to read "projectId".
 *
 * `status` and `priority` are absent because an entry no longer has either: it
 * records an hour already worked. Historic diffs that still mention them fall
 * through to the raw key, which is the honest thing to show for a field that no
 * longer exists.
 */
const FIELD_LABELS = {
  description: 'Work done',
  projectId: 'Project',
  remarks: 'Remarks',
  attributes: 'Department fields',
};

const renderValue = (value) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
      .join(' · ');
  }
  if (typeof value === 'string' && /^[A-Z_]+$/.test(value)) return humanizeEnum(value);
  return String(value);
};

function DiffRow({ field, change }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, color: 'text.secondary', fontSize: 10.5, letterSpacing: '0.04em' }}
      >
        {(FIELD_LABELS[field] ?? field).toUpperCase()}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', mt: 0.25 }}>
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            fontSize: 12.5,
            color: 'error.main',
            textDecoration: 'line-through',
            textDecorationColor: (t) => `${t.palette.error.main}66`,
            bgcolor: (t) => `${t.palette.error.main}0f`,
            px: 0.75,
            py: 0.35,
            borderRadius: 0.75,
            wordBreak: 'break-word',
          }}
        >
          {renderValue(change.from)}
        </Typography>

        <Typography
          variant="body2"
          sx={{
            flex: 1,
            fontSize: 12.5,
            color: 'success.main',
            bgcolor: (t) => `${t.palette.success.main}0f`,
            px: 0.75,
            py: 0.35,
            borderRadius: 0.75,
            wordBreak: 'break-word',
          }}
        >
          {renderValue(change.to)}
        </Typography>
      </Box>
    </Box>
  );
}

export default function TaskHistoryDrawer({ entry, onClose }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tasks', 'history', entry?.id],
    queryFn: () => tasksApi.getHistory(entry.id),
    enabled: Boolean(entry?.id),
  });

  const revisions = data?.data?.revisions ?? [];

  return (
    <Drawer
      anchor="right"
      open={Boolean(entry)}
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 460 } } } }}
    >
      <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: 16 }}>
              Change history
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {entry?.timeSlot?.label} · {entry?.workDate}
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      </Box>

      <Box sx={{ p: 2.5, overflowY: 'auto', flex: 1 }}>
        {isLoading && (
          <Stack spacing={2}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="rounded" height={90} />
            ))}
          </Stack>
        )}

        {isError && <Alert severity="error">{error?.message ?? 'Could not load the history.'}</Alert>}

        {!isLoading && !isError && revisions.length === 0 && (
          <EmptyState
            icon={HistoryIcon}
            title="No changes yet"
            message="This entry has not been edited since it was created."
            dense
          />
        )}

        {revisions.map((revision, index) => {
          const meta = ACTION_META[revision.action] ?? { label: revision.action, color: 'default' };
          const changed = revision.changedFields ?? {};

          return (
            <Box key={revision.id}>
              <Stack direction="row" spacing={1.5}>
                {/* The timeline rail. */}
                <Stack alignItems="center" sx={{ pt: 0.5 }}>
                  <Box
                    sx={{
                      width: 9,
                      height: 9,
                      borderRadius: '50%',
                      bgcolor: `${meta.color}.main`,
                      flexShrink: 0,
                    }}
                  />
                  {index < revisions.length - 1 && (
                    <Box sx={{ width: 1, flex: 1, bgcolor: 'divider', my: 0.5, minHeight: 30 }} />
                  )}
                </Stack>

                <Box sx={{ flex: 1, pb: 2.5, minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.75 }}>
                    <Chip
                      size="small"
                      label={meta.label}
                      color={meta.color}
                      variant="outlined"
                      sx={{ height: 19, fontSize: 10, fontWeight: 700 }}
                    />
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10.5 }}>
                      v{revision.revision}
                    </Typography>
                  </Stack>

                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
                    <Avatar sx={{ width: 20, height: 20, fontSize: 9 }}>
                      {initials(revision.actor?.fullName)}
                    </Avatar>
                    <Typography variant="body2" sx={{ fontSize: 12.5, fontWeight: 600 }}>
                      {revision.actor?.fullName ?? 'Unknown'}
                    </Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
                      {formatDateTime(revision.createdAt)}
                    </Typography>
                  </Stack>

                  {revision.reason && (
                    <Alert severity="info" sx={{ py: 0, mb: 1, fontSize: 12 }}>
                      {revision.reason}
                    </Alert>
                  )}

                  {Object.keys(changed).length > 0 ? (
                    <Box
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1.5,
                        p: 1.25,
                        bgcolor: 'action.hover',
                      }}
                    >
                      {Object.entries(changed).map(([field, change]) => (
                        <DiffRow key={field} field={field} change={change} />
                      ))}
                    </Box>
                  ) : (
                    <Box
                      sx={{
                        border: 1,
                        borderColor: 'divider',
                        borderRadius: 1.5,
                        p: 1.25,
                        bgcolor: 'action.hover',
                      }}
                    >
                      <Typography variant="body2" sx={{ fontSize: 12.5 }}>
                        “{revision.snapshot?.description}”
                      </Typography>
                    </Box>
                  )}
                </Box>
              </Stack>
            </Box>
          );
        })}
      </Box>

      <Divider />
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.disabled">
          History is append-only and is written in the same transaction as the change itself, so it can
          never drift from the live entry.
        </Typography>
      </Box>
    </Drawer>
  );
}
