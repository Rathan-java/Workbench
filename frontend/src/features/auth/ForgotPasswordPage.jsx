import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
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
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';

import AuthLayout from './AuthLayout.jsx';
import PasswordPolicy from './PasswordPolicy.jsx';
import { auth } from '../../api/endpoints.js';
import { passwordSchema, withPasswordConfirmation } from './passwordSchema.js';

const OTP_LENGTH = 6;
const STEPS = ['Your email', 'Verification code', 'New password'];

const emailSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
});

const resetSchema = withPasswordConfirmation(
  z.object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  }),
);

const formatCountdown = (totalSeconds) => {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/* ------------------------------------------------------------------ *
 * Step 2's OTP field
 *
 * Six single-character boxes rather than one text input. It is the pattern users
 * now expect from a mailed code, and it makes the "6 digits, digits only"
 * constraint visible instead of a validation message they hit after the fact.
 * ------------------------------------------------------------------ */
function OtpInput({ value, onChange, disabled, hasError, onComplete }) {
  const inputsRef = useRef([]);

  const setDigit = (index, digit) => {
    const next = value.split('');
    next[index] = digit;
    // Pad so a write at index 3 of an empty value doesn't produce holes.
    const joined = Array.from({ length: OTP_LENGTH }, (_, i) => next[i] ?? '').join('');
    onChange(joined);
    return joined;
  };

  const focusInput = (index) => {
    const clamped = Math.max(0, Math.min(OTP_LENGTH - 1, index));
    inputsRef.current[clamped]?.focus();
    inputsRef.current[clamped]?.select();
  };

  const handleChange = (index) => (event) => {
    // A phone keyboard can deliver several characters in one event; take the
    // last digit typed so the field never silently swallows input.
    const digits = event.target.value.replace(/\D/g, '');
    if (!digits) return;

    const digit = digits[digits.length - 1];
    const joined = setDigit(index, digit);

    if (index < OTP_LENGTH - 1) {
      focusInput(index + 1);
    }

    if (joined.length === OTP_LENGTH && !joined.includes('')) {
      onComplete?.(joined);
    }
  };

  const handleKeyDown = (index) => (event) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index]) {
        // Clear this box first; a second Backspace then steps back.
        setDigit(index, '');
      } else {
        setDigit(index - 1 >= 0 ? index - 1 : 0, '');
        focusInput(index - 1);
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusInput(index - 1);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusInput(index + 1);
    }
  };

  const handlePaste = (event) => {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH);
    if (!pasted) return;

    const joined = pasted.padEnd(OTP_LENGTH, '').slice(0, OTP_LENGTH);
    onChange(joined);
    focusInput(pasted.length >= OTP_LENGTH ? OTP_LENGTH - 1 : pasted.length);

    if (pasted.length === OTP_LENGTH) {
      onComplete?.(pasted);
    }
  };

  return (
    <Stack direction="row" spacing={1} justifyContent="center" onPaste={handlePaste}>
      {Array.from({ length: OTP_LENGTH }).map((_, index) => (
        <TextField
          key={index}
          inputRef={(element) => {
            inputsRef.current[index] = element;
          }}
          value={value[index] ?? ''}
          onChange={handleChange(index)}
          onKeyDown={handleKeyDown(index)}
          onFocus={(event) => event.target.select()}
          disabled={disabled}
          error={hasError}
          autoFocus={index === 0}
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${index + 1} of ${OTP_LENGTH}`}
          slotProps={{
            htmlInput: {
              inputMode: 'numeric',
              pattern: '[0-9]*',
              maxLength: 1,
              style: {
                textAlign: 'center',
                fontSize: '1.25rem',
                fontWeight: 600,
                padding: '12px 0',
              },
            },
          }}
          sx={{ width: 48, '& .MuiOutlinedInput-root': { borderRadius: 2 } }}
        />
      ))}
    </Stack>
  );
}

export default function ForgotPasswordPage() {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [notice, setNotice] = useState(null); // { severity, message } — carried across steps
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const navigate = useNavigate();
  const { enqueueSnackbar } = useSnackbar();

  const emailForm = useForm({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });

  const passwordForm = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const newPassword = passwordForm.watch('newPassword') ?? '';

  /* --- countdown ------------------------------------------------------ */
  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const codeExpired = step === 1 && secondsLeft === 0;

  /* --- step 1: request a code ----------------------------------------- */
  const requestCode = useMutation({
    mutationFn: (values) => auth.forgotPassword({ email: values.email }),
    onSuccess: (response, values) => {
      setEmail(values.email);
      setOtp('');
      setResetToken('');
      // The API is deliberately blind to whether the account exists, so this is
      // the strongest thing we can honestly say.
      setNotice({
        severity: 'info',
        message: `If an account exists for ${values.email}, we've sent a 6-digit code.`,
      });
      setSecondsLeft((response.data?.expiresInMinutes ?? 5) * 60);
      setStep(1);
    },
    onError: (error) => {
      setNotice({ severity: 'error', message: error.message });
    },
  });

  /** Resend re-runs step 1's call with the email we already captured. */
  const resendCode = useCallback(() => {
    requestCode.mutate({ email });
  }, [email, requestCode]);

  /* --- step 2: verify the code ---------------------------------------- */
  const verifyOtp = useMutation({
    mutationFn: (code) => auth.verifyOtp({ email, otp: code }),
    onSuccess: (response) => {
      setResetToken(response.data.resetToken);
      setNotice(null);
      setStep(2);
    },
    onError: (error) => {
      // Expiry and a burnt attempt budget are both terminal for this code — the
      // only way forward is a new one, so send them back rather than leaving
      // them poking at a field that can no longer succeed.
      if (error.code === 'OTP_EXPIRED' || error.code === 'OTP_ATTEMPTS_EXCEEDED') {
        setOtp('');
        setSecondsLeft(0);
        setStep(0);
        setNotice({
          severity: 'warning',
          message:
            error.code === 'OTP_EXPIRED'
              ? 'That code expired. Request a new one to continue.'
              : 'Too many incorrect attempts. Request a new code to continue.',
        });
      }
    },
  });

  const otpErrorMessage = useMemo(() => {
    const error = verifyOtp.error;
    if (!error) return null;
    if (error.code === 'OTP_EXPIRED' || error.code === 'OTP_ATTEMPTS_EXCEEDED') return null;

    const remaining = error.details?.attemptsRemaining;
    if (error.code === 'OTP_INCORRECT' && typeof remaining === 'number') {
      return `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`;
    }
    return error.message;
  }, [verifyOtp.error]);

  /* --- step 3: set the new password ----------------------------------- */
  const resetPassword = useMutation({
    mutationFn: (values) =>
      auth.resetPassword({
        email,
        resetToken,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      }),
    onSuccess: () => {
      enqueueSnackbar('Password reset. You can now sign in.', { variant: 'success' });
      setDone(true);
    },
    onError: (error) => {
      // The reset token is single-use and short-lived; if it died, the whole
      // flow has to start over.
      if (error.code === 'RESET_TOKEN_INVALID') {
        setStep(0);
        setOtp('');
        setResetToken('');
        setNotice({
          severity: 'warning',
          message: 'Your reset session expired. Please request a new code.',
        });
      }
    },
  });

  const backToEmail = () => {
    setStep(0);
    setOtp('');
    setSecondsLeft(0);
    setNotice(null);
    verifyOtp.reset();
  };

  /* --- success state --------------------------------------------------- */
  if (done) {
    return (
      <AuthLayout
        title="Password reset"
        subtitle="Your password has been changed and every other session was signed out."
      >
        <Stack spacing={3} alignItems="center" sx={{ py: 1 }}>
          <CheckCircleRoundedIcon sx={{ fontSize: 48, color: 'success.main' }} />
          <Typography variant="body2" color="text.secondary" align="center">
            You can now sign in to Ara Workbench with your new password.
          </Typography>
          <Button variant="contained" size="large" fullWidth onClick={() => navigate('/login')}>
            Sign in
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a verification code to confirm it's really you."
      footer={
        <Link component={RouterLink} to="/login" variant="caption" underline="hover">
          Back to sign in
        </Link>
      }
    >
      <Stepper activeStep={step} alternativeLabel sx={{ mb: 3.5 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel
              slotProps={{ label: { style: { fontSize: '0.75rem', marginTop: 6 } } }}
            >
              {label}
            </StepLabel>
          </Step>
        ))}
      </Stepper>

      {notice && (
        <Alert severity={notice.severity} sx={{ mb: 2.5 }} onClose={() => setNotice(null)}>
          {notice.message}
        </Alert>
      )}

      {/* ---------------- Step 1: email ---------------- */}
      {step === 0 && (
        <Box
          component="form"
          noValidate
          onSubmit={emailForm.handleSubmit((values) => requestCode.mutate(values))}
        >
          <Stack spacing={2.5}>
            <TextField
              {...emailForm.register('email')}
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              error={Boolean(emailForm.formState.errors.email)}
              helperText={emailForm.formState.errors.email?.message}
              disabled={requestCode.isPending}
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={requestCode.isPending}
              startIcon={
                requestCode.isPending ? (
                  <CircularProgress size={16} color="inherit" thickness={5} />
                ) : null
              }
            >
              {requestCode.isPending ? 'Sending code…' : 'Send verification code'}
            </Button>
          </Stack>
        </Box>
      )}

      {/* ---------------- Step 2: OTP ---------------- */}
      {step === 1 && (
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary" align="center">
            Enter the 6-digit code sent to{' '}
            <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
              {email}
            </Box>
          </Typography>

          <OtpInput
            value={otp}
            onChange={setOtp}
            disabled={verifyOtp.isPending || codeExpired}
            hasError={Boolean(otpErrorMessage)}
            onComplete={(code) => verifyOtp.mutate(code)}
          />

          {otpErrorMessage && (
            <Alert severity="error" sx={{ py: 0.25 }}>
              {otpErrorMessage}
            </Alert>
          )}

          <Box sx={{ textAlign: 'center' }}>
            {codeExpired ? (
              <Stack spacing={1} alignItems="center">
                <Typography variant="caption" color="text.secondary">
                  Your code has expired.
                </Typography>
                <Button
                  size="small"
                  onClick={resendCode}
                  disabled={requestCode.isPending}
                  startIcon={
                    requestCode.isPending ? (
                      <CircularProgress size={14} color="inherit" thickness={5} />
                    ) : null
                  }
                >
                  Resend code
                </Button>
              </Stack>
            ) : (
              <Typography variant="caption" color="text.secondary">
                Code expires in{' '}
                <Box
                  component="span"
                  sx={{
                    fontVariantNumeric: 'tabular-nums',
                    fontWeight: 600,
                    color: secondsLeft <= 30 ? 'warning.main' : 'text.primary',
                  }}
                >
                  {formatCountdown(secondsLeft)}
                </Box>
              </Typography>
            )}
          </Box>

          <Button
            variant="contained"
            size="large"
            fullWidth
            onClick={() => verifyOtp.mutate(otp)}
            disabled={otp.replace(/\D/g, '').length < OTP_LENGTH || verifyOtp.isPending || codeExpired}
            startIcon={
              verifyOtp.isPending ? (
                <CircularProgress size={16} color="inherit" thickness={5} />
              ) : null
            }
          >
            {verifyOtp.isPending ? 'Verifying…' : 'Verify code'}
          </Button>

          <Button
            size="small"
            startIcon={<ArrowBackRoundedIcon sx={{ fontSize: 16 }} />}
            onClick={backToEmail}
            sx={{ alignSelf: 'center' }}
          >
            Use a different email
          </Button>
        </Stack>
      )}

      {/* ---------------- Step 3: new password ---------------- */}
      {step === 2 && (
        <Box
          component="form"
          noValidate
          onSubmit={passwordForm.handleSubmit((values) => resetPassword.mutate(values))}
        >
          <Stack spacing={2.5}>
            {resetPassword.error && resetPassword.error.code !== 'RESET_TOKEN_INVALID' && (
              <Alert severity="error">{resetPassword.error.message}</Alert>
            )}

            <TextField
              {...passwordForm.register('newPassword')}
              label="New password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
              error={Boolean(passwordForm.formState.errors.newPassword)}
              helperText={passwordForm.formState.errors.newPassword?.message}
              disabled={resetPassword.isPending}
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

            <PasswordPolicy value={newPassword} />

            <TextField
              {...passwordForm.register('confirmPassword')}
              label="Confirm new password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              error={Boolean(passwordForm.formState.errors.confirmPassword)}
              helperText={passwordForm.formState.errors.confirmPassword?.message}
              disabled={resetPassword.isPending}
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              fullWidth
              disabled={resetPassword.isPending}
              startIcon={
                resetPassword.isPending ? (
                  <CircularProgress size={16} color="inherit" thickness={5} />
                ) : null
              }
            >
              {resetPassword.isPending ? 'Resetting password…' : 'Reset password'}
            </Button>
          </Stack>
        </Box>
      )}
    </AuthLayout>
  );
}
