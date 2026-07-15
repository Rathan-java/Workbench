import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useLocation, useNavigate, Link as RouterLink } from 'react-router-dom';
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
import { useAuth } from '../../context/AuthContext.jsx';

/**
 * Deliberately NOT the full password policy — see the note on `loginSchema` in
 * the backend DTO. Applying the composition rules to a sign-in form tells an
 * attacker which passwords cannot exist, and locks out any account whose
 * password predates the current policy.
 */
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

/**
 * Maps the API's error codes onto what the user actually sees.
 *
 * INVALID_CREDENTIALS gets a fixed client-side string; the other two render the
 * server's message verbatim, because only the server knows how many minutes are
 * left on a lockout or why an account is inactive.
 */
const errorPresentation = (error) => {
  if (!error) return null;

  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return { severity: 'error', message: 'Invalid email or password' };
    case 'ACCOUNT_LOCKED':
      return { severity: 'warning', message: error.message };
    case 'ACCOUNT_INACTIVE':
      return { severity: 'warning', message: error.message };
    default:
      return { severity: 'error', message: error.message || 'Unable to sign in. Please try again.' };
  }
};

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const mutation = useMutation({
    mutationFn: (values) => login(values),
    onSuccess: () => {
      // Where they were headed before the auth gate bounced them (AppRouter puts
      // it in `state.from`), falling back to the role-aware home redirect.
      const target = location.state?.from?.pathname ?? '/';
      navigate(target, { replace: true });
    },
  });

  const alert = errorPresentation(mutation.error);

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Welcome back. Enter your credentials to continue."
      footer={
        <Typography variant="caption" color="text.secondary">
          Need an account? Your administrator creates it for you.
        </Typography>
      }
    >
      <Box component="form" onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <Stack spacing={2.5}>
          {alert && (
            <Alert severity={alert.severity} sx={{ alignItems: 'center' }}>
              {alert.message}
            </Alert>
          )}

          <TextField
            {...register('email')}
            label="Email"
            type="email"
            autoComplete="username"
            autoFocus
            error={Boolean(errors.email)}
            helperText={errors.email?.message}
            disabled={mutation.isPending}
          />

          <Box>
            <TextField
              {...register('password')}
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              error={Boolean(errors.password)}
              helperText={errors.password?.message}
              disabled={mutation.isPending}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        onClick={() => setShowPassword((visible) => !visible)}
                        edge="end"
                        size="small"
                        tabIndex={-1}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
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

            {/* No "remember me": the refresh token is an httpOnly cookie and is
                already persistent across restarts. A checkbox here could only
                lie, or tempt someone into putting a token in localStorage. */}
            <Box sx={{ mt: 1, textAlign: 'right' }}>
              <Link
                component={RouterLink}
                to="/forgot-password"
                variant="caption"
                underline="hover"
              >
                Forgot password?
              </Link>
            </Box>
          </Box>

          <Button
            type="submit"
            variant="contained"
            size="large"
            fullWidth
            disabled={mutation.isPending}
            startIcon={
              mutation.isPending ? <CircularProgress size={16} color="inherit" thickness={5} /> : null
            }
          >
            {mutation.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </Stack>
      </Box>
    </AuthLayout>
  );
}
