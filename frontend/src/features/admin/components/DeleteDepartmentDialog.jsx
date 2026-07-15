import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import BlockIcon from '@mui/icons-material/BlockOutlined';

import { departments as departmentsApi } from '../../../api/endpoints.js';
import { errorMessage, isActionable, isConflict } from './apiError.js';

/**
 * Deleting a department that still holds people or work is refused by the API
 * (409 DEPARTMENT_NOT_EMPTY) — and its message names exactly what is in the way
 * ("still contains 4 employee(s), 2 team(s)…"). A red toast would throw that away
 * and leave the admin guessing, so it is rendered in the dialog itself, next to
 * the thing they should almost certainly do instead: deactivate.
 */
export default function DeleteDepartmentDialog({ department, onClose, onDeleted, onDeactivated }) {
  const [error, setError] = useState(null);

  const conflict = isConflict(error);

  const deleteMutation = useMutation({
    mutationFn: () => departmentsApi.remove(department.id),
    onSuccess: () => onDeleted(department),
    onError: (nextError) => setError(nextError),
  });

  const deactivateMutation = useMutation({
    // The API's update schema is not a partial — send the department back whole,
    // with isActive flipped. `description` and `icon` are nullable in the database
    // but the schema will not take a null, so an absent one becomes ''.
    mutationFn: () =>
      departmentsApi.update(department.id, {
        name: department.name,
        description: department.description ?? '',
        colorHex: department.colorHex,
        icon: department.icon ?? '',
        isActive: false,
        sortOrder: department.sortOrder ?? 0,
        requiredSlotsPerDay: department.requiredSlotsPerDay,
        workingWeekdays: department.workingWeekdays,
      }),
    onSuccess: () => onDeactivated(department),
    onError: (nextError) => setError(nextError),
  });

  const pending = deleteMutation.isPending || deactivateMutation.isPending;

  return (
    <Dialog open onClose={pending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Delete {department.name}?</DialogTitle>

      <DialogContent>
        <Stack spacing={2}>
          {error && isActionable(error) && (
            <Alert severity={conflict ? 'warning' : 'error'}>
              {conflict && <AlertTitle sx={{ fontSize: 14 }}>This department is not empty</AlertTitle>}
              {errorMessage(error)}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary">
            Deleting a department removes its working hours and its custom task fields with it. It
            is only possible while the department is completely empty — no employees, no teams, no
            projects and no logged work.
          </Typography>

          <Alert severity="info" icon={false}>
            <strong>Deactivating</strong> is the usual answer. The department vanishes from every
            dropdown and no new work can be logged against it, while every timesheet, report and
            audit row that references it stays intact.
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={pending}>
          Cancel
        </Button>

        <Button
          onClick={() => deactivateMutation.mutate()}
          disabled={pending || !department.isActive}
          startIcon={<BlockIcon fontSize="small" />}
        >
          {department.isActive ? 'Deactivate instead' : 'Already inactive'}
        </Button>

        <Button
          onClick={() => {
            setError(null);
            deleteMutation.mutate();
          }}
          variant="contained"
          color="error"
          disabled={pending || conflict}
        >
          Delete permanently
        </Button>
      </DialogActions>
    </Dialog>
  );
}
