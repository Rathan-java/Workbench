import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import CancelIcon from '@mui/icons-material/HighlightOffRounded';
import PlayIcon from '@mui/icons-material/PlayArrowRounded';
import LockIcon from '@mui/icons-material/LockOutlined';
import SaveIcon from '@mui/icons-material/SaveOutlined';
import SendIcon from '@mui/icons-material/SendOutlined';
import UndoIcon from '@mui/icons-material/UndoRounded';

import PageHeader from '../../components/common/PageHeader.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { settings as settingsApi, system as systemApi } from '../../api/endpoints.js';
import { PERMISSIONS } from '../../utils/constants.js';
import { formatDateTime, formatRelative, humanizeEnum } from '../../utils/format.js';
import { errorMessage } from './components/apiError.js';

const CATEGORY_LABELS = {
  notifications: 'Notifications & reminders',
  tasks: 'Task entry',
  ai: 'AI analysis',
};

export default function SettingsPage() {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.SETTINGS_MANAGE);

  return (
    <Box>
      <PageHeader
        title="Settings"
        subtitle="Runtime configuration an administrator can change without a redeploy. Secrets and infrastructure (database URL, JWT keys, SMTP host) deliberately do not live here."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Settings' }]}
      />

      {!canManage && (
        <Alert severity="info" icon={<LockIcon fontSize="small" />} sx={{ mb: 3 }}>
          You can view this configuration but not change it. Changing a setting or running a job
          requires the <code>settings:manage</code> permission.
        </Alert>
      )}

      <SystemSettingsSection canManage={canManage} />

      {/* Mail sits above the jobs: a broken SMTP config is USER-facing (nobody can
          reset a password), while a stalled job is internal. */}
      <Box sx={{ mt: 4 }}>
        <MailSection canManage={canManage} />
      </Box>

      <Box sx={{ mt: 4 }}>
        <ScheduledJobsSection canManage={canManage} />
      </Box>
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 * System settings
 * ------------------------------------------------------------------ */

function SystemSettingsSection({ canManage }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  /** Edits live here until saved, so a row can show an explicit unsaved state. */
  const [drafts, setDrafts] = useState({});

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.list().then((res) => res.data),
  });

  const mutation = useMutation({
    mutationFn: ({ key, value }) => settingsApi.update(key, value),
    onSuccess: (_res, { key }) => {
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      enqueueSnackbar('Setting saved', { variant: 'success' });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const grouped = useMemo(() => {
    const map = new Map();
    for (const setting of settingsQuery.data ?? []) {
      if (!map.has(setting.category)) map.set(setting.category, []);
      map.get(setting.category).push(setting);
    }
    return [...map.entries()];
  }, [settingsQuery.data]);

  const setDraft = (key, value) => setDrafts((current) => ({ ...current, [key]: value }));

  const discard = (key) =>
    setDrafts((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });

  if (settingsQuery.isLoading) {
    return (
      <Stack spacing={2}>
        <Skeleton variant="rounded" height={220} />
        <Skeleton variant="rounded" height={220} />
      </Stack>
    );
  }

  if (settingsQuery.isError) {
    return (
      <Alert severity="error">{errorMessage(settingsQuery.error, 'Could not load settings.')}</Alert>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h5">System settings</Typography>

      {grouped.map(([category, items]) => (
        <Card key={category}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              {CATEGORY_LABELS[category] ?? humanizeEnum(category)}
            </Typography>

            <Stack divider={<Divider />} sx={{ mt: 1 }}>
              {items.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  draft={drafts[setting.key]}
                  isDirty={Object.hasOwn(drafts, setting.key)}
                  canManage={canManage}
                  saving={mutation.isPending && mutation.variables?.key === setting.key}
                  onChange={(value) => setDraft(setting.key, value)}
                  onDiscard={() => discard(setting.key)}
                  onSave={(value) => mutation.mutate({ key: setting.key, value })}
                />
              ))}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function SettingRow({ setting, draft, isDirty, canManage, saving, onChange, onDiscard, onSave }) {
  const value = isDirty ? draft : setting.value;
  const type = typeof setting.value;

  const control = (() => {
    if (type === 'boolean') {
      return (
        <Switch
          checked={Boolean(value)}
          onChange={(event) => onChange(event.target.checked)}
          disabled={!canManage || saving}
          size="small"
        />
      );
    }

    if (type === 'number') {
      return (
        <TextField
          type="number"
          value={value ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            // Keep '' out of the payload as NaN: an empty box is not a number, and
            // the API's union would take the string.
            onChange(next === '' ? '' : Number(next));
          }}
          disabled={!canManage || saving}
          size="small"
          sx={{ width: 120 }}
          slotProps={{ htmlInput: { inputMode: 'numeric' } }}
        />
      );
    }

    return (
      <TextField
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        disabled={!canManage || saving}
        size="small"
        sx={{ width: { xs: '100%', sm: 240 } }}
      />
    );
  })();

  const invalid = type === 'number' && (value === '' || !Number.isFinite(Number(value)));

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      alignItems={{ xs: 'flex-start', md: 'center' }}
      justifyContent="space-between"
      sx={{ py: 1.75 }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="subtitle2">{humanizeEnum(setting.key.split('.').pop())}</Typography>

          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.disabled' }}>
            {setting.key}
          </Typography>

          {setting.isDefault && (
            <Tooltip title="Never changed — this is the shipped default.">
              <Chip label="default" size="small" variant="outlined" sx={{ color: 'text.secondary' }} />
            </Tooltip>
          )}

          {isDirty && <Chip label="Unsaved" size="small" color="warning" />}
        </Stack>

        {setting.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 560 }}>
            {setting.description}
          </Typography>
        )}

        <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
          {setting.updatedAt
            ? `Last changed ${formatRelative(setting.updatedAt)}${
                setting.updatedBy ? ` by ${setting.updatedBy.fullName}` : ''
              }`
            : 'Never changed'}
        </Typography>
      </Box>

      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
        {control}

        {isDirty && (
          <>
            <Tooltip title="Discard">
              <span>
                <Button
                  size="small"
                  color="inherit"
                  onClick={onDiscard}
                  disabled={saving}
                  sx={{ minWidth: 0, px: 1 }}
                >
                  <UndoIcon fontSize="small" />
                </Button>
              </span>
            </Tooltip>

            <Button
              size="small"
              variant="contained"
              startIcon={saving ? <CircularProgress size={14} color="inherit" /> : <SaveIcon fontSize="small" />}
              onClick={() => onSave(value)}
              disabled={saving || invalid}
            >
              Save
            </Button>
          </>
        )}
      </Stack>
    </Stack>
  );
}

/* ------------------------------------------------------------------ *
 * Mail
 * ------------------------------------------------------------------ */

/**
 * `secure` and `requireTLS` are two different questions and the pair is the
 * single most common way an SMTP config is wrong:
 *   secure: true      → implicit TLS from the first byte (port 465)
 *   requireTLS: true  → plaintext connect, then STARTTLS (port 587)
 * Naming the derived mode here is worth more to an admin than echoing two
 * booleans they then have to interpret.
 */
const tlsMode = (mail) => {
  if (mail.secure) return 'Implicit TLS (465)';
  if (mail.requireTLS) return 'STARTTLS';
  return 'None';
};

const isEmailish = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

function ConfigRow({ label, children }) {
  return (
    <TableRow>
      <TableCell sx={{ width: 200, color: 'text.secondary', border: 0, py: 1 }}>{label}</TableCell>
      <TableCell sx={{ border: 0, py: 1 }}>{children}</TableCell>
    </TableRow>
  );
}

function MailSection({ canManage }) {
  const { user } = useAuth();
  const { enqueueSnackbar } = useSnackbar();

  const mailQuery = useQuery({
    queryKey: ['system-mail'],
    queryFn: () => systemApi.mail().then((res) => res.data),
  });

  // Defaulting to the signed-in admin's own address: the one inbox they can
  // definitely check, and the one they will not typo.
  const [to, setTo] = useState(user?.email ?? '');

  const testMutation = useMutation({
    mutationFn: (address) => systemApi.testMail(address),
    onSuccess: (_res, address) =>
      enqueueSnackbar(`Test email sent to ${address} — check the inbox.`, { variant: 'success' }),
    // Deliberately NOT a snackbar: the API's 400 names the likely cause ("port
    // 587 needs SMTP_SECURE=false", "Gmail requires an App Password"). That is
    // the actionable part, and it must not vanish after four seconds.
  });

  if (mailQuery.isLoading) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">Mail</Typography>
        <Skeleton variant="rounded" height={96} />
        <Skeleton variant="rounded" height={220} />
      </Stack>
    );
  }

  if (mailQuery.isError) {
    return (
      <Stack spacing={2}>
        <Typography variant="h5">Mail</Typography>
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => mailQuery.refetch()}>
              Retry
            </Button>
          }
        >
          {errorMessage(mailQuery.error, 'Could not load the mail configuration.')}
        </Alert>
      </Stack>
    );
  }

  const mail = mailQuery.data ?? {};
  const working = mail.verified === true;
  const isMailhog =
    (mail.host === 'localhost' || mail.host === '127.0.0.1') && Number(mail.port) === 1025;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Mail</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 720 }}>
          The failure mode of a broken mail config is <strong>silence</strong>. A user clicks &ldquo;forgot
          password&rdquo;, the API answers &ldquo;a code has been sent&rdquo;, and nothing ever arrives —
          no error, no bounce, nobody to tell. This section is how you find out before they do.
        </Typography>
      </Box>

      <Alert
        severity={working ? 'success' : 'error'}
        icon={working ? <CheckCircleIcon /> : <CancelIcon />}
        sx={{ '& .MuiAlert-message': { width: '100%' } }}
      >
        <AlertTitle sx={{ fontWeight: 700 }}>
          {working
            ? 'Mail is working — password reset codes will be delivered'
            : 'Mail is NOT working — password reset codes will NOT be delivered'}
        </AlertTitle>

        {!working && mail.error && (
          <Box
            component="pre"
            sx={{
              m: 0,
              mb: 1,
              p: 1,
              borderRadius: 1,
              overflowX: 'auto',
              fontFamily: 'monospace',
              fontSize: '0.8125rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              backgroundColor: 'action.hover',
            }}
          >
            {mail.error}
          </Box>
        )}

        {mail.enabled === false && (
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            Mail is switched off on this deployment (<code>MAIL_ENABLED=false</code>). Messages are written
            to the server log instead of being sent.
          </Typography>
        )}

        <Typography variant="caption" color="text.secondary" component="div">
          {mail.checkedAt
            ? `SMTP connection last verified ${formatRelative(mail.checkedAt)} (${formatDateTime(mail.checkedAt)}) — the check runs at boot.`
            : 'The SMTP connection has never been verified on this instance.'}
        </Typography>
      </Alert>

      {isMailhog && (
        <Alert severity="info">
          You&rsquo;re using MailHog (local dev). Open{' '}
          <Link href="http://localhost:8025" target="_blank" rel="noopener noreferrer">
            http://localhost:8025
          </Link>{' '}
          to read captured emails.
        </Alert>
      )}

      <Paper sx={{ overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableBody>
              <ConfigRow label="Host">
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {mail.host || '—'}
                </Typography>
              </ConfigRow>

              <ConfigRow label="Port">
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {mail.port ?? '—'}
                </Typography>
              </ConfigRow>

              <ConfigRow label="TLS mode">
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2">{tlsMode(mail)}</Typography>
                  {tlsMode(mail) === 'None' && !isMailhog && (
                    <Chip label="unencrypted" size="small" color="warning" variant="outlined" />
                  )}
                </Stack>
              </ConfigRow>

              <ConfigRow label="Authentication">
                <Typography variant="body2">
                  {mail.authenticated ? `Yes — ${mail.user ?? 'user hidden'}` : 'No — anonymous relay'}
                </Typography>
              </ConfigRow>

              <ConfigRow label="From address">
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {mail.from || '—'}
                </Typography>
              </ConfigRow>
            </TableBody>
          </Table>
        </TableContainer>

        <Divider />

        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle2">Send test email</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 1.5, maxWidth: 560 }}>
            Proves the SMTP setup end to end, without triggering a real password reset on somebody&rsquo;s
            account and hoping. The password is configured in the environment and is never shown here.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
            <TextField
              type="email"
              label="Send to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              disabled={!canManage || testMutation.isPending}
              size="small"
              sx={{ width: { xs: '100%', sm: 320 } }}
              error={to.length > 0 && !isEmailish(to)}
              helperText={to.length > 0 && !isEmailish(to) ? 'That is not a valid email address.' : ' '}
            />

            {canManage && (
              <Button
                variant="contained"
                startIcon={
                  testMutation.isPending ? <CircularProgress size={14} color="inherit" /> : <SendIcon fontSize="small" />
                }
                disabled={testMutation.isPending || !isEmailish(to)}
                onClick={() => testMutation.mutate(to.trim())}
                sx={{ mt: { xs: 0, sm: 0.25 } }}
              >
                Send test email
              </Button>
            )}
          </Stack>

          {testMutation.isError && (
            <Alert severity="error" sx={{ mt: 1 }}>
              <AlertTitle>SMTP rejected the test email</AlertTitle>
              {errorMessage(testMutation.error, 'The test email could not be sent.')}
            </Alert>
          )}
        </Box>
      </Paper>
    </Stack>
  );
}

/* ------------------------------------------------------------------ *
 * Scheduled jobs
 * ------------------------------------------------------------------ */

function ScheduledJobsSection({ canManage }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  const jobsQuery = useQuery({
    queryKey: ['system-jobs'],
    queryFn: () => systemApi.jobs().then((res) => res.data),
    refetchInterval: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: (name) => systemApi.runJob(name),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['system-jobs'] });

      const result = res.data ?? {};

      // withLock() reports three distinct outcomes and they mean very different
      // things: "another instance holds the lock" is not a failure.
      if (result.skipped) {
        enqueueSnackbar('Skipped — the job is already running (another instance holds the lock).', {
          variant: 'warning',
        });
        return;
      }

      if (result.ok === false) {
        enqueueSnackbar(`Job failed: ${result.error ?? 'unknown error'}`, { variant: 'error' });
        return;
      }

      enqueueSnackbar(
        res.message
          ? `${res.message}${result.durationMs != null ? ` in ${result.durationMs} ms` : ''}`
          : 'Job finished',
        { variant: 'success' },
      );
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const jobs = jobsQuery.data ?? [];
  const schedulerOff = jobs.length > 0 && jobs.every((job) => job.enabled === false);

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5">Scheduled jobs</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Every job takes a distributed lock before it runs, so a manual trigger cannot collide with
          the scheduled run — or with the same job on another instance. If the lock is held, the run
          is skipped rather than duplicated.
        </Typography>
      </Box>

      {schedulerOff && (
        <Alert severity="warning">
          The scheduler is disabled on this deployment (<code>SCHEDULER_ENABLED=false</code>). Nothing
          runs on a schedule; a manual trigger still works.
        </Alert>
      )}

      {jobsQuery.isError && (
        <Alert severity="error">
          {errorMessage(jobsQuery.error, 'Could not load the scheduled jobs.')}
        </Alert>
      )}

      <Paper sx={{ overflow: 'hidden' }}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Job</TableCell>
                <TableCell>Schedule</TableCell>
                <TableCell>Last run</TableCell>
                <TableCell align="center">Result</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>

            <TableBody>
              {jobsQuery.isLoading &&
                Array.from({ length: 6 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell colSpan={5}>
                      <Skeleton variant="text" />
                    </TableCell>
                  </TableRow>
                ))}

              {jobs.map((job) => {
                const running = job.isRunning || (runMutation.isPending && runMutation.variables === job.name);

                return (
                  <TableRow key={job.name}>
                    <TableCell sx={{ maxWidth: 300 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                          {job.name}
                        </Typography>
                        {job.isRunning && <Chip label="Running" size="small" color="info" />}
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {job.description}
                      </Typography>
                    </TableCell>

                    <TableCell>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                        {job.schedule}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {job.timezone}
                      </Typography>
                    </TableCell>

                    <TableCell>
                      {job.lastRunAt ? (
                        <Tooltip title={formatDateTime(job.lastRunAt)}>
                          <Typography variant="body2" color="text.secondary">
                            {formatRelative(job.lastRunAt)}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.disabled">
                          Never
                        </Typography>
                      )}

                      {job.lastRunNote && (
                        <Typography
                          variant="caption"
                          color="text.disabled"
                          display="block"
                          sx={{ maxWidth: 260 }}
                        >
                          {job.lastRunNote}
                        </Typography>
                      )}
                    </TableCell>

                    <TableCell align="center">
                      {job.lastRunOk === null || job.lastRunOk === undefined ? (
                        <Typography variant="caption" color="text.disabled">
                          —
                        </Typography>
                      ) : job.lastRunOk ? (
                        <Tooltip title="Last run succeeded">
                          <CheckCircleIcon fontSize="small" color="success" />
                        </Tooltip>
                      ) : (
                        <Tooltip title={job.lastRunNote || 'Last run failed'}>
                          <CancelIcon fontSize="small" color="error" />
                        </Tooltip>
                      )}
                    </TableCell>

                    <TableCell align="right">
                      {canManage && (
                        <Tooltip
                          title={
                            running
                              ? 'Already running — the lock is held.'
                              : 'Run now (still takes the distributed lock)'
                          }
                        >
                          <span>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<PlayIcon fontSize="small" />}
                              disabled={running || runMutation.isPending}
                              onClick={() => runMutation.mutate(job.name)}
                            >
                              Run now
                            </Button>
                          </span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}

              {!jobsQuery.isLoading && jobs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 3 }}>
                      No jobs are registered.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Stack>
  );
}
