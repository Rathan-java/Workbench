import { useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useSnackbar } from 'notistack';
import { z } from 'zod';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid2';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

import ComputerRoundedIcon from '@mui/icons-material/ComputerRounded';
import PhoneIphoneRoundedIcon from '@mui/icons-material/PhoneIphoneRounded';
import TabletMacRoundedIcon from '@mui/icons-material/TabletMacRounded';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import DevicesRoundedIcon from '@mui/icons-material/DevicesRounded';

import PageHeader from '../../components/common/PageHeader.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import ErrorState from '../../components/common/ErrorState.jsx';
import PasswordPolicy from '../auth/PasswordPolicy.jsx';
import { passwordSchema, withPasswordConfirmation } from '../auth/passwordSchema.js';
import { auth } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDateTime, formatRelative, initials, fullName, humanizeEnum } from '../../utils/format.js';

const TABS = ['profile', 'security', 'sessions'];

const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // Backend: MAX_AVATAR_SIZE_MB = 2
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Mirrors updateProfileSchema in the backend DTO. */
const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(80),
  lastName: z.string().trim().min(1, 'Last name is required').max(80),
  phone: z
    .string()
    .trim()
    .max(32, 'Phone number is too long')
    .regex(/^[+\d\s()-]*$/, 'Enter a valid phone number')
    .or(z.literal('')),
  designation: z.string().trim().max(120, 'Designation is too long').or(z.literal('')),
  timezone: z.string().trim().max(64),
});

const changePasswordSchema = withPasswordConfirmation(
  z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  }),
).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'Your new password must be different from your current password',
  path: ['newPassword'],
});

/** The browser knows every IANA zone; no reason to ship a hand-maintained list. */
const TIMEZONES =
  typeof Intl.supportedValuesOf === 'function'
    ? Intl.supportedValuesOf('timeZone')
    : ['UTC', 'Asia/Kolkata', 'Europe/London', 'America/New_York'];

/* ------------------------------------------------------------------ *
 * User-agent → something a human recognises
 *
 * Not a full UA parser and doesn't try to be: the goal is "is this me?", so
 * browser + OS is enough to tell your laptop from a stranger's. Order matters —
 * Edge and Chrome both claim "Chrome", Chrome claims "Safari".
 * ------------------------------------------------------------------ */
const BROWSERS = [
  { name: 'Edge', match: /Edg[A-Z]?\//i },
  { name: 'Opera', match: /OPR\/|Opera/i },
  { name: 'Samsung Internet', match: /SamsungBrowser/i },
  { name: 'Firefox', match: /Firefox\//i },
  { name: 'Chrome', match: /Chrome\/|CriOS/i },
  { name: 'Safari', match: /Safari\//i },
];

const PLATFORMS = [
  { name: 'Windows', match: /Windows NT/i, device: 'desktop' },
  { name: 'Android', match: /Android/i, device: 'mobile' },
  { name: 'iPhone', match: /iPhone/i, device: 'mobile' },
  { name: 'iPad', match: /iPad/i, device: 'tablet' },
  { name: 'macOS', match: /Macintosh|Mac OS X/i, device: 'desktop' },
  { name: 'Linux', match: /Linux/i, device: 'desktop' },
];

const describeDevice = (userAgent) => {
  if (!userAgent) return { label: 'Unknown device', device: 'desktop' };

  const browser = BROWSERS.find((entry) => entry.match.test(userAgent));
  const platform = PLATFORMS.find((entry) => entry.match.test(userAgent));

  if (!browser && !platform) return { label: 'Unknown device', device: 'desktop' };

  const label = browser && platform
    ? `${browser.name} on ${platform.name}`
    : (browser?.name ?? platform?.name);

  return { label, device: platform?.device ?? 'desktop' };
};

const DEVICE_ICONS = {
  desktop: ComputerRoundedIcon,
  mobile: PhoneIphoneRoundedIcon,
  tablet: TabletMacRoundedIcon,
};

/** Small labelled read-only fact. Used for the admin-controlled fields. */
function ReadOnlyFact({ label, children }) {
  return (
    <Stack spacing={0.75}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Box>{children}</Box>
    </Stack>
  );
}

/** A password field with a show/hide toggle — repeated three times otherwise. */
function PasswordField({ visible, onToggleVisibility, ...props }) {
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={onToggleVisibility}
                edge="end"
                size="small"
                tabIndex={-1}
                aria-label={visible ? 'Hide password' : 'Show password'}
              >
                {visible ? (
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
  );
}

/* ================================================================== *
 * Profile tab
 * ================================================================== */
function ProfileTab({ user, setUser }) {
  const { enqueueSnackbar } = useSnackbar();
  const fileInputRef = useRef(null);
  const [preview, setPreview] = useState(null);
  const [avatarError, setAvatarError] = useState(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isDirty },
  } = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      phone: user.phone ?? '',
      designation: user.designation ?? '',
      timezone: user.timezone ?? 'UTC',
    },
  });

  const updateProfile = useMutation({
    mutationFn: (values) => auth.updateProfile(values),
    onSuccess: (response) => {
      setUser(response.data.user);
      // Re-baseline the form so `isDirty` goes false and the saved values stick.
      reset({
        firstName: response.data.user.firstName ?? '',
        lastName: response.data.user.lastName ?? '',
        phone: response.data.user.phone ?? '',
        designation: response.data.user.designation ?? '',
        timezone: response.data.user.timezone ?? 'UTC',
      });
      enqueueSnackbar('Profile updated', { variant: 'success' });
    },
    onError: (error) => enqueueSnackbar(error.message, { variant: 'error' }),
  });

  const uploadAvatar = useMutation({
    // endpoints.uploadAvatar builds the FormData itself (field name `avatar`),
    // so it takes the raw File — not a FormData we assemble here.
    mutationFn: (file) => auth.uploadAvatar(file),
    onSuccess: (response) => {
      setUser(response.data.user);
      setPreview(null);
      enqueueSnackbar('Profile picture updated', { variant: 'success' });
    },
    onError: (error) => {
      setPreview(null);
      setAvatarError(error.message);
    },
  });

  const handleFileSelected = (event) => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = '';
    if (!file) return;

    setAvatarError(null);

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setAvatarError('Choose a PNG, JPEG or WebP image.');
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('That image is larger than 2 MB. Choose a smaller one.');
      return;
    }

    setPreview(URL.createObjectURL(file));
    uploadAvatar.mutate(file);
  };

  const avatarSrc = preview ?? (user.avatarPath ? `/uploads/${user.avatarPath}` : undefined);

  return (
    <Grid container spacing={3}>
      {/* ---- avatar + admin-controlled facts ---- */}
      <Grid size={{ xs: 12, md: 4 }}>
        <Card>
          <CardContent>
            <Stack spacing={2.5} alignItems="center">
              <Tooltip title="Change profile picture">
                <Box
                  component="button"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadAvatar.isPending}
                  sx={{
                    position: 'relative',
                    p: 0,
                    border: 0,
                    borderRadius: '50%',
                    bgcolor: 'transparent',
                    cursor: uploadAvatar.isPending ? 'default' : 'pointer',
                    '&:hover .avatar-overlay': { opacity: 1 },
                    '&:focus-visible': (theme) => ({
                      outline: `2px solid ${theme.palette.primary.main}`,
                      outlineOffset: 3,
                    }),
                  }}
                  aria-label="Change profile picture"
                >
                  <Avatar
                    src={avatarSrc}
                    sx={{ width: 96, height: 96, fontSize: '1.75rem', fontWeight: 600 }}
                  >
                    {initials(user)}
                  </Avatar>

                  <Box
                    className="avatar-overlay"
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: alpha('#0F172A', 0.55),
                      opacity: uploadAvatar.isPending ? 1 : 0,
                      transition: 'opacity 150ms ease',
                    }}
                  >
                    {uploadAvatar.isPending ? (
                      <CircularProgress size={22} sx={{ color: '#FFFFFF' }} thickness={5} />
                    ) : (
                      <PhotoCameraRoundedIcon sx={{ color: '#FFFFFF', fontSize: 22 }} />
                    )}
                  </Box>
                </Box>
              </Tooltip>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleFileSelected}
                hidden
              />

              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h5">{fullName(user)}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {user.designation || humanizeEnum(user.role)}
                </Typography>
              </Box>

              {avatarError && (
                <Alert severity="error" sx={{ width: '100%' }} onClose={() => setAvatarError(null)}>
                  {avatarError}
                </Alert>
              )}

              <Typography variant="caption" color="text.secondary" align="center">
                PNG, JPEG or WebP. Up to 2 MB.
              </Typography>

              <Divider flexItem />

              {/* These come from HR/admin, not from the user. Rendering them as
                  disabled inputs would look like a bug ("why can't I type?");
                  as facts with an explanation, the boundary is obvious. */}
              <Stack spacing={2} sx={{ width: '100%' }}>
                <ReadOnlyFact label="Email">
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {user.email}
                  </Typography>
                </ReadOnlyFact>

                <ReadOnlyFact label="Employee code">
                  <Chip label={user.employeeCode} variant="outlined" />
                </ReadOnlyFact>

                <ReadOnlyFact label="Role">
                  <Chip label={humanizeEnum(user.role)} color="primary" variant="outlined" />
                </ReadOnlyFact>

                <ReadOnlyFact label="Department">
                  {user.department ? (
                    <Chip
                      label={user.department.name}
                      variant="outlined"
                      sx={
                        user.department.colorHex
                          ? {
                              color: user.department.colorHex,
                              borderColor: alpha(user.department.colorHex, 0.4),
                              bgcolor: alpha(user.department.colorHex, 0.08),
                            }
                          : undefined
                      }
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Not assigned
                    </Typography>
                  )}
                </ReadOnlyFact>

                <ReadOnlyFact label="Team">
                  {user.team ? (
                    <Chip label={user.team.name} variant="outlined" />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Not assigned
                    </Typography>
                  )}
                </ReadOnlyFact>
              </Stack>

              <Typography variant="caption" color="text.secondary" align="center">
                Email, employee code, role, department and team are managed by your administrator.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      {/* ---- editable details ---- */}
      <Grid size={{ xs: 12, md: 8 }}>
        <Card>
          <CardHeader
            title="Your details"
            subheader="This is how your name appears on task sheets and approvals."
          />
          <CardContent>
            <Box
              component="form"
              noValidate
              onSubmit={handleSubmit((values) => updateProfile.mutate(values))}
            >
              <Grid container spacing={2.5}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register('firstName')}
                    label="First name"
                    error={Boolean(errors.firstName)}
                    helperText={errors.firstName?.message}
                    disabled={updateProfile.isPending}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register('lastName')}
                    label="Last name"
                    error={Boolean(errors.lastName)}
                    helperText={errors.lastName?.message}
                    disabled={updateProfile.isPending}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register('phone')}
                    label="Phone"
                    placeholder="+91 98765 43210"
                    error={Boolean(errors.phone)}
                    helperText={errors.phone?.message}
                    disabled={updateProfile.isPending}
                  />
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    {...register('designation')}
                    label="Designation"
                    placeholder="Senior Engineer"
                    error={Boolean(errors.designation)}
                    helperText={errors.designation?.message}
                    disabled={updateProfile.isPending}
                  />
                </Grid>

                <Grid size={12}>
                  <Controller
                    name="timezone"
                    control={control}
                    render={({ field }) => (
                      <Autocomplete
                        options={TIMEZONES}
                        value={field.value || null}
                        onChange={(_, value) => field.onChange(value ?? '')}
                        disabled={updateProfile.isPending}
                        disableClearable
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            label="Timezone"
                            error={Boolean(errors.timezone)}
                            helperText={
                              errors.timezone?.message ??
                              'Task dates and deadlines are shown in this timezone.'
                            }
                          />
                        )}
                      />
                    )}
                  />
                </Grid>
              </Grid>

              <Stack direction="row" justifyContent="flex-end" sx={{ mt: 3 }}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={updateProfile.isPending || !isDirty}
                  startIcon={
                    updateProfile.isPending ? (
                      <CircularProgress size={16} color="inherit" thickness={5} />
                    ) : null
                  }
                >
                  {updateProfile.isPending ? 'Saving…' : 'Save changes'}
                </Button>
              </Stack>
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

/* ================================================================== *
 * Security tab
 * ================================================================== */
function SecurityTab() {
  const { logout } = useAuth();
  const { enqueueSnackbar } = useSnackbar();
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword') ?? '';

  const changePassword = useMutation({
    mutationFn: (values) => auth.changePassword(values),
    onSuccess: async () => {
      // Same as the forced-change flow: the server revoked every session,
      // including this one. Staying "signed in" is not an option the API leaves
      // open, so end the session cleanly rather than letting it rot.
      enqueueSnackbar('Password changed. Please sign in again.', { variant: 'success' });
      await logout();
    },
  });

  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }}>
        <Card>
          <CardHeader
            title="Change password"
            subheader="Use a password you don't use anywhere else."
          />
          <CardContent>
            <Box
              component="form"
              noValidate
              onSubmit={handleSubmit((values) => changePassword.mutate(values))}
            >
              <Stack spacing={2.5}>
                {/* Stated BEFORE the button, not in a toast after the fact. */}
                <Alert severity="warning">
                  <AlertTitle sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
                    You will be signed out everywhere
                  </AlertTitle>
                  Changing your password ends every active session, including this one. You&apos;ll
                  need to sign in again with your new password.
                </Alert>

                {changePassword.error && (
                  <Alert severity="error">{changePassword.error.message}</Alert>
                )}

                <PasswordField
                  {...register('currentPassword')}
                  label="Current password"
                  autoComplete="current-password"
                  visible={showCurrent}
                  onToggleVisibility={() => setShowCurrent((visible) => !visible)}
                  error={Boolean(errors.currentPassword)}
                  helperText={errors.currentPassword?.message}
                  disabled={changePassword.isPending}
                />

                <PasswordField
                  {...register('newPassword')}
                  label="New password"
                  autoComplete="new-password"
                  visible={showNew}
                  onToggleVisibility={() => setShowNew((visible) => !visible)}
                  error={Boolean(errors.newPassword)}
                  helperText={errors.newPassword?.message}
                  disabled={changePassword.isPending}
                />

                <PasswordPolicy value={newPassword} />

                <TextField
                  {...register('confirmPassword')}
                  label="Confirm new password"
                  type={showNew ? 'text' : 'password'}
                  autoComplete="new-password"
                  error={Boolean(errors.confirmPassword)}
                  helperText={errors.confirmPassword?.message}
                  disabled={changePassword.isPending}
                />

                <Stack direction="row" justifyContent="flex-end">
                  <Button
                    type="submit"
                    variant="contained"
                    disabled={changePassword.isPending}
                    startIcon={
                      changePassword.isPending ? (
                        <CircularProgress size={16} color="inherit" thickness={5} />
                      ) : null
                    }
                  >
                    {changePassword.isPending ? 'Updating…' : 'Change password'}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  );
}

/* ================================================================== *
 * Sessions tab
 * ================================================================== */
function SessionRow({ session }) {
  const { label, device } = describeDevice(session.userAgent);
  const Icon = DEVICE_ICONS[device] ?? ComputerRoundedIcon;

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      sx={{
        p: 2,
        borderRadius: 2,
        border: (theme) => `1px solid ${theme.palette.divider}`,
        bgcolor: (theme) =>
          session.isCurrent ? alpha(theme.palette.primary.main, 0.04) : 'transparent',
        borderColor: (theme) =>
          session.isCurrent ? alpha(theme.palette.primary.main, 0.3) : theme.palette.divider,
      }}
    >
      <Box
        sx={{
          width: 38,
          height: 38,
          borderRadius: 2,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          bgcolor: (theme) => alpha(theme.palette.text.primary, 0.05),
        }}
      >
        <Icon sx={{ fontSize: 19, color: 'text.secondary' }} />
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="subtitle2">{label}</Typography>
          {session.isCurrent && <Chip label="This device" color="primary" size="small" />}
        </Stack>

        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
          {session.ip ? `IP ${session.ip}` : 'IP unknown'} · Signed in{' '}
          {formatRelative(session.createdAt)}
        </Typography>
      </Box>

      <Stack spacing={0.25} sx={{ textAlign: { xs: 'left', sm: 'right' }, flexShrink: 0 }}>
        <Typography variant="caption" color="text.secondary">
          Started {formatDateTime(session.createdAt)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Expires {formatDateTime(session.expiresAt)}
        </Typography>
      </Stack>
    </Stack>
  );
}

function SessionsTab() {
  const {
    data: sessions,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: async () => {
      const response = await auth.sessions();
      return response.data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader
        title="Active sessions"
        subheader="Devices with a valid session for your account. Changing your password signs all of them out."
      />
      <CardContent>
        {isLoading && (
          <Stack spacing={1.5}>
            {[0, 1, 2].map((key) => (
              <Skeleton key={key} variant="rounded" height={78} />
            ))}
          </Stack>
        )}

        {/* Pass the ApiError itself, not a flattened string — ErrorState surfaces
            the correlationId, which is what support traces back to a request. */}
        {isError && (
          <ErrorState
            error={error}
            title="Could not load your sessions"
            onRetry={() => refetch()}
          />
        )}

        {!isLoading && !isError && sessions.length === 0 && (
          <EmptyState
            icon={DevicesRoundedIcon}
            title="No active sessions"
            message="There are no other devices signed in to your account right now."
          />
        )}

        {!isLoading && !isError && sessions.length > 0 && (
          <Stack spacing={1.5}>
            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/* ================================================================== *
 * Page
 * ================================================================== */
export default function ProfilePage() {
  const { user, setUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is the source of truth for the tab, so a link to ?tab=sessions works
  // and the browser's back button steps between tabs.
  const requested = searchParams.get('tab');
  const tab = useMemo(() => (TABS.includes(requested) ? requested : 'profile'), [requested]);

  const handleTabChange = (_, value) => {
    // `replace` — flipping tabs is not a navigation worth a history entry each.
    setSearchParams({ tab: value }, { replace: true });
  };

  if (!user) return null;

  return (
    <Box>
      <PageHeader
        title="Your profile"
        subtitle="Manage your details, password and active sessions."
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Profile' }]}
      />

      <Tabs value={tab} onChange={handleTabChange} sx={{ mb: 3 }}>
        <Tab value="profile" label="Profile" />
        <Tab value="security" label="Security" />
        <Tab value="sessions" label="Sessions" />
      </Tabs>

      {tab === 'profile' && <ProfileTab user={user} setUser={setUser} />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'sessions' && <SessionsTab />}
    </Box>
  );
}
