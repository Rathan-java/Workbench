import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { z } from 'zod';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';

import AuthLayout from './AuthLayout.jsx';
import PasswordPolicy from './PasswordPolicy.jsx';
import LoadingScreen from '../../components/common/LoadingScreen.jsx';
import { auth } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { passwordSchema, withPasswordConfirmation } from './passwordSchema.js';

const schema = withPasswordConfirmation(
  z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  }),
)
  // Mirrors the backend's second refinement — catch it here so the user isn't
  // told "same password" only after a round trip.
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'Your new password must be different from your current password',
    path: ['newPassword'],
  });

export default function ForceChangePasswordPage() {
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const { isAuthenticated, isLoading, mustChangePassword, logout } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') ?? '';

  const mutation = useMutation({
    mutationFn: (values) =>
      auth.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      }),
    onSuccess: async () => {
      // The API revokes EVERY session on success — including the one that made
      // this call — and clears the refresh cookie. There is no logged-in state
      // left to keep, so tear the client down and send them back to sign in.
      // Trying to stay "logged in" here would just fire doomed refresh calls.
      enqueueSnackbar('Password changed. Please sign in again.', { variant: 'success' });
      await logout();
      navigate('/login', { replace: true });
    },
  });

  // This route sits outside RequireAuth (see AppRouter), so it guards itself.
  if (isLoading) return <LoadingScreen message="Restoring your session…" />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  // Already changed it, or never had to — nothing to do here.
  if (!mustChangePassword) return <Navigate to="/" replace />;

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Your account was created with a temporary password. Choose a new one to continue."
      footer={
        <Link
          component="button"
          type="button"
          variant="caption"
          underline="hover"
          onClick={() => logout()}
        >
          Sign in as someone else
        </Link>
      }
    >
      <Box component="form" noValidate onSubmit={handleSubmit((values) => mutation.mutate(values))}>
        <Stack spacing={2.5}>
          <Alert severity="info">
            For your security, changing your password signs you out of all devices. You&apos;ll be
            asked to sign in again with your new password.
          </Alert>

          {mutation.error && <Alert severity="error">{mutation.error.message}</Alert>}

          <TextField
            {...register('currentPassword')}
            label="Temporary password"
            type={showCurrent ? 'text' : 'password'}
            autoComplete="current-password"
            autoFocus
            error={Boolean(errors.currentPassword)}
            helperText={errors.currentPassword?.message}
            disabled={mutation.isPending}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowCurrent((visible) => !visible)}
                      edge="end"
                      size="small"
                      tabIndex={-1}
                      aria-label={showCurrent ? 'Hide password' : 'Show password'}
                    >
                      {showCurrent ? (
                        <VisibilityOffRoundedIcon sx={{ fontSize: 18 }} />
                      ) : (
                        <VisibilityRoundedIcon sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <TextField
            {...register('newPassword')}
            label="New password"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            error={Boolean(errors.newPassword)}
            helperText={errors.newPassword?.message}
            disabled={mutation.isPending}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowNew((visible) => !visible)}
                      edge="end"
                      size="small"
                      tabIndex={-1}
                      aria-label={showNew ? 'Hide password' : 'Show password'}
                    >
                      {showNew ? (
                        <VisibilityOffRoundedIcon sx={{ fontSize: 18 }} />
                      ) : (
                        <VisibilityRoundedIcon sx={{ fontSize: 18 }} />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />

          <PasswordPolicy value={newPassword} />

          <TextField
            {...register('confirmPassword')}
            label="Confirm new password"
            type={showNew ? 'text' : 'password'}
            autoComplete="new-password"
            error={Boolean(errors.confirmPassword)}
            helperText={errors.confirmPassword?.message}
            disabled={mutation.isPending}
          />

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={mutation.isPending}
            startIcon={
              mutation.isPending ? (
                <CircularProgress size={16} color="inherit" thickness={5} />
              ) : null
            }
          >
            {mutation.isPending ? 'Updating password…' : 'Set new password and continue'}
          </Button>

          <Typography variant="caption" color="text.secondary" align="center">
            Passwords are never stored in plain text and cannot be recovered by an administrator.
          </Typography>
        </Stack>
      </Box>
    </AuthLayout>
  );
}
