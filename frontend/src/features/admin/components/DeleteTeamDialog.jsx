import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { teams as teamsApi } from '../../../api/endpoints.js';
import { errorMessage } from './apiError.js';

/**
 * Deleting a team.
 *
 * The dialog does two things a plain "Are you sure?" cannot:
 *
 * 1. It shows the REAL numbers, fetched before it opens — how many members are in
 *    the way, and how many logged task entries would stop being attributable to a
 *    team. An admin deciding on a generic confirmation is deciding blind.
 *
 * 2. It offers DEACTIVATE as an equal-weight alternative, because for a team that
 *    has any history that is almost always the right answer. Deleting does not
 *    destroy the work (a task entry belongs to the employee, not the team) — but
 *    it does quietly break every historical per-team report, and "why doesn't last
 *    quarter's team breakdown add up?" is a horrible thing to debug six months on.
 */
export default function DeleteTeamDialog({ team, onClose, onDeleted }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [error, setError] = useState(null);

  const previewQuery = useQuery({
    queryKey: ['teams', team?.id, 'delete-preview'],
    queryFn: () => teamsApi.deletePreview(team.id),
    select: (response) => response.data,
    enabled: Boolean(team?.id),
  });

  const preview = previewQuery.data;

  const deleteMutation = useMutation({
    mutationFn: () => teamsApi.remove(team.id),
    onSuccess: (response) => {
      enqueueSnackbar(response.message ?? 'Team deleted', { variant: 'success' });
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onDeleted?.();
      onClose();
    },
    // The 409 message names exactly what is blocking. Render it, don't replace it.
    onError: (e) => setError(errorMessage(e, 'Could not delete this team.')),
  });

  const deactivateMutation = useMutation({
    mutationFn: () =>
      teamsApi.update(team.id, {
        name: team.name,
        code: team.code,
        description: team.description ?? '',
        isActive: false,
      }),
    onSuccess: () => {
      enqueueSnackbar(
        `"${team.name}" has been deactivated. It is hidden everywhere, and its reports are intact.`,
        { variant: 'success' },
      );
      queryClient.invalidateQueries({ queryKey: ['teams'] });
      onDeleted?.();
      onClose();
    },
    onError: (e) => setError(errorMessage(e, 'Could not deactivate this team.')),
  });

  const busy = deleteMutation.isPending || deactivateMutation.isPending;
  const blocked = (preview?.blockers?.length ?? 0) > 0;

  return (
    <Dialog open={Boolean(team)} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Delete “{team?.name}”?</DialogTitle>

      <DialogContent>
        {previewQuery.isPending && <Skeleton variant="rounded" height={140} />}

        {previewQuery.isError && (
          <Alert severity="error">
            {errorMessage(previewQuery.error, 'Could not check this team.')}
          </Alert>
        )}

        {preview && (
          <Stack spacing={2}>
            {blocked ? (
              <Alert severity="warning">
                <AlertTitle sx={{ fontWeight: 700 }}>This team cannot be deleted yet</AlertTitle>
                {preview.blockers.map((b) => (
                  <Typography key={b} variant="body2">
                    · {b}
                  </Typography>
                ))}
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Deleting a team out from under its members would silently orphan them — they would
                  vanish from every team view with nothing to explain why. Move them to another team,
                  or remove them, first.
                </Typography>
              </Alert>
            ) : (
              <Alert severity="error">
                <AlertTitle sx={{ fontWeight: 700 }}>This cannot be undone</AlertTitle>
                <Typography variant="body2">
                  The team record will be permanently removed.
                </Typography>
              </Alert>
            )}

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 1,
                p: 1.5,
                borderRadius: 1.5,
                bgcolor: 'action.hover',
              }}
            >
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  {preview.members}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  members assigned
                </Typography>
              </Box>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                  {preview.taskEntries.toLocaleString()}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  task entries logged
                </Typography>
              </Box>
            </Box>

            <Alert severity={preview.taskEntries > 0 ? 'warning' : 'info'}>
              {preview.recommendation}
            </Alert>

            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
        <Button onClick={onClose} color="inherit" disabled={busy}>
          Cancel
        </Button>

        {/* The safe option gets equal visual weight, because for any team with
            history it is the correct one. */}
        <Button
          onClick={() => deactivateMutation.mutate()}
          variant="outlined"
          disabled={busy || !team?.isActive}
        >
          {deactivateMutation.isPending ? 'Deactivating…' : 'Deactivate instead'}
        </Button>

        <Button
          onClick={() => deleteMutation.mutate()}
          variant="contained"
          color="error"
          disabled={busy || blocked || previewQuery.isPending}
        >
          {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
