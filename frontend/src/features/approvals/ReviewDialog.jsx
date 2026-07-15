/**
 * Approve / return / reopen a task sheet.
 *
 * A rejection REQUIRES a note, and the API enforces that with a 422. The dialog
 * makes it a required field rather than letting the user write nothing, hit
 * submit and eat a validation error — "returned, no reason given" is how an
 * approval workflow loses the trust of the people subject to it, and a UI that
 * lets you try is a UI that has not thought about them.
 */
import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Stack,
  Avatar,
  Alert,
  Box,
  Chip,
} from '@mui/material';
import { tasks as tasksApi } from '../../api/endpoints.js';
import { initials, formatDate } from '../../utils/format.js';

const DECISION_META = {
  APPROVE: {
    title: 'Approve task sheet',
    verb: 'Approve',
    color: 'success',
    noteRequired: false,
    notePlaceholder: 'Optional: anything you want to say about this sheet.',
    blurb: 'The sheet will be locked and the employee notified.',
  },
  REJECT: {
    title: 'Return for changes',
    verb: 'Return',
    color: 'warning',
    noteRequired: true,
    notePlaceholder: 'What needs to change? Be specific — this is what they will act on.',
    blurb: 'The sheet reopens for editing and the employee is notified with your note.',
  },
  REOPEN: {
    title: 'Reopen approved sheet',
    verb: 'Reopen',
    color: 'warning',
    noteRequired: false,
    notePlaceholder: 'Optional: why are you reopening this?',
    blurb:
      'This unlocks an already-approved sheet. The override is recorded in the audit log.',
  },
};

export default function ReviewDialog({ open, day, employee, decision, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);
  const { enqueueSnackbar } = useSnackbar();

  const meta = DECISION_META[decision] ?? DECISION_META.APPROVE;

  useEffect(() => {
    if (open) {
      setNote('');
      setError(null);
    }
  }, [open, decision]);

  const review = useMutation({
    mutationFn: () => tasksApi.reviewDay(day.id, { decision, note: note.trim() || undefined }),
    onSuccess: () => {
      enqueueSnackbar(
        decision === 'APPROVE'
          ? 'Task sheet approved'
          : decision === 'REJECT'
            ? 'Sheet returned to the employee'
            : 'Sheet reopened',
        { variant: 'success' },
      );
      onDone();
    },
    onError: (e) => setError(e.message ?? 'Could not complete the review.'),
  });

  const noteMissing = meta.noteRequired && !note.trim();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{meta.title}</DialogTitle>

      <DialogContent>
        {employee && (
          <Stack
            direction="row"
            spacing={1.5}
            alignItems="center"
            sx={{ mb: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1.5 }}
          >
            <Avatar sx={{ width: 34, height: 34 }}>{initials(employee.fullName)}</Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
                {employee.fullName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {formatDate(day?.workDate)} · {day?.filledSlots}/{day?.expectedSlots} hours logged
              </Typography>
            </Box>
            <Chip
              size="small"
              label={`${day?.completionRate ?? 0}%`}
              color={day?.completionRate >= 100 ? 'success' : 'warning'}
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          </Stack>
        )}

        <Alert severity={decision === 'REOPEN' ? 'warning' : 'info'} sx={{ mb: 2, py: 0.5 }}>
          {meta.blurb}
        </Alert>

        <TextField
          fullWidth
          multiline
          minRows={3}
          label={meta.noteRequired ? 'Reason (required)' : 'Note (optional)'}
          placeholder={meta.notePlaceholder}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required={meta.noteRequired}
          error={Boolean(error) && noteMissing}
          inputProps={{ maxLength: 1000 }}
          helperText={`${note.length}/1000`}
          autoFocus
        />

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          color={meta.color}
          onClick={() => review.mutate()}
          disabled={noteMissing || review.isPending}
        >
          {review.isPending ? 'Working…' : meta.verb}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
