import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/AddRounded';
import EditIcon from '@mui/icons-material/EditOutlined';
import KeyIcon from '@mui/icons-material/VpnKeyOutlined';
import BlockIcon from '@mui/icons-material/BlockOutlined';
import DeleteForeverIcon from '@mui/icons-material/DeleteForeverOutlined';
import RestoreIcon from '@mui/icons-material/RestoreOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';

import DataTable from '../../components/common/DataTable.jsx';
import PageHeader from '../../components/common/PageHeader.jsx';
import Guard from '../../components/common/Guard.jsx';
import { useConfirm } from '../../components/common/ConfirmDialog.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { users as usersApi, teams as teamsApi } from '../../api/endpoints.js';
import {
  DEFAULT_PAGE_SIZE,
  PERMISSIONS,
  ROLE,
  ROLES,
  USER_STATUS,
  USER_STATUSES,
} from '../../utils/constants.js';
import { formatRelative } from '../../utils/format.js';

import DepartmentChip from './components/DepartmentChip.jsx';
import ToneChip from './components/ToneChip.jsx';
import { ROLE_TONE, USER_STATUS_TONE } from './components/tones.js';
import FilterBar, { SearchField, SelectFilter } from './components/FilterBar.jsx';
import UserCell from './components/UserCell.jsx';
import TemporaryPasswordDialog from './components/TemporaryPasswordDialog.jsx';
import { useDepartments } from './components/useDepartments.js';
import { errorMessage, isActionable } from './components/apiError.js';

const SEARCH_DEBOUNCE_MS = 400;

/**
 * The enum VALUE, not the label. `constants.ROLE` maps 'MANAGEMENT' -> 'Management'
 * for display; comparing a user's role against it would never match.
 */
const MANAGEMENT = 'MANAGEMENT';

/**
 * Mirrors backend/src/modules/auth/auth.dto.js `passwordField`. Only applied
 * when the admin types one — a blank field means "server, generate it".
 */
const passwordRules = z
  .string()
  .min(12, 'At least 12 characters')
  .max(128)
  .regex(/[a-z]/, 'Needs a lowercase letter')
  .regex(/[A-Z]/, 'Needs an uppercase letter')
  .regex(/[0-9]/, 'Needs a number')
  .regex(/[^A-Za-z0-9]/, 'Needs a special character');

const userSchema = z
  .object({
    firstName: z.string().trim().min(1, 'First name is required').max(80),
    // Optional — many people have a single legal name. Empty is stored as null.
    lastName: z.string().trim().max(80).optional(),
    email: z.string().trim().email('Enter a valid email address').max(190),
    employeeCode: z
      .string()
      .trim()
      .min(2, 'At least 2 characters')
      .max(32)
      .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and hyphens only'),
    phone: z.string().trim().max(32).or(z.literal('')),
    designation: z.string().trim().max(120).or(z.literal('')),
    role: z.enum(['MANAGEMENT', 'TECH_LEAD', 'EMPLOYEE']),
    departmentId: z.string().or(z.literal('')),
    teamId: z.string().or(z.literal('')),
    password: z.string().or(z.literal('')),
    sendWelcomeEmail: z.boolean(),
  })
  .superRefine((data, ctx) => {
    // The same invariant the API enforces (user.dto.js `departmentInvariant`):
    // Management is company-wide and has no department; everyone else must have one.
    if (data.role !== MANAGEMENT && !data.departmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['departmentId'],
        message: 'A department is required for Tech Leads and Employees',
      });
    }

    if (data.password) {
      const result = passwordRules.safeParse(data.password);
      if (!result.success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: result.error.issues[0].message,
        });
      }
    }
  });

const EMPTY_USER = {
  firstName: '',
  lastName: '',
  email: '',
  employeeCode: '',
  phone: '',
  designation: '',
  role: 'EMPLOYEE',
  departmentId: '',
  teamId: '',
  password: '',
  sendWelcomeEmail: true,
};

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();
  const { can, user: currentUser } = useAuth();
  const { options: departmentOptions } = useDepartments();

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [departmentId, setDepartmentId] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  const [menu, setMenu] = useState({ anchor: null, user: null });
  const [formUser, setFormUser] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState(null);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy,
      sortOrder,
      search: search || undefined,
      departmentId: departmentId || undefined,
      role: role || undefined,
      status: status || undefined,
    }),
    [page, pageSize, sortBy, sortOrder, search, departmentId, role, status],
  );

  const usersQuery = useQuery({
    queryKey: ['users', params],
    queryFn: () => usersApi.list(params),
    placeholderData: (previous) => previous,
  });

  const rows = usersQuery.data?.data ?? [];
  const total = usersQuery.data?.meta?.pagination?.total ?? 0;

  const invalidateUsers = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const reactivateMutation = useMutation({
    mutationFn: (id) => usersApi.reactivate(id),
    onSuccess: () => {
      invalidateUsers();
      queryClient.invalidateQueries({ queryKey: ['user-options'] });
      enqueueSnackbar('Account reactivated', { variant: 'success' });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const hasFilters = Boolean(searchInput || departmentId || role || status);

  const resetFilters = () => {
    setSearchInput('');
    setDepartmentId('');
    setRole('');
    setStatus('');
    setPage(1);
  };

  /** Any filter change must return to page 1 — page 7 of a new result set is usually empty. */
  const withPageReset = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const closeMenu = () => setMenu({ anchor: null, user: null });

  const openForm = (user) => {
    setFormUser(user);
    setFormOpen(true);
    closeMenu();
  };

  const handleReactivate = async (user) => {
    closeMenu();
    const confirmed = await confirm({
      title: `Reactivate ${user.fullName}?`,
      message: 'They will be able to sign in again with their existing password.',
      confirmLabel: 'Reactivate',
    });
    if (confirmed) reactivateMutation.mutate(user.id);
  };

  const columns = useMemo(
    () => [
      {
        id: 'firstName',
        label: 'Employee',
        sortable: true,
        render: (row) => <UserCell user={row} secondary={row.employeeCode} />,
      },
      {
        id: 'email',
        label: 'Email',
        sortable: true,
        render: (row) => (
          <Typography variant="body2" noWrap>
            {row.email}
          </Typography>
        ),
      },
      {
        id: 'role',
        label: 'Role',
        sortable: true,
        render: (row) => <ToneChip tone={ROLE_TONE[row.role]} label={ROLE[row.role] ?? row.role} />,
      },
      {
        id: 'department',
        label: 'Department',
        render: (row) =>
          row.department ? (
            <DepartmentChip department={row.department} />
          ) : (
            <Typography variant="caption" color="text.disabled">
              Company-wide
            </Typography>
          ),
      },
      {
        id: 'team',
        label: 'Team',
        render: (row) =>
          row.team ? (
            <Typography variant="body2" noWrap>
              {row.team.name}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.disabled">
              —
            </Typography>
          ),
      },
      {
        id: 'status',
        label: 'Status',
        sortable: true,
        render: (row) => (
          <ToneChip tone={USER_STATUS_TONE[row.status]} label={USER_STATUS[row.status] ?? row.status} />
        ),
      },
      {
        id: 'lastLoginAt',
        label: 'Last login',
        sortable: true,
        render: (row) =>
          row.lastLoginAt ? (
            <Tooltip title={new Date(row.lastLoginAt).toLocaleString()}>
              <Typography variant="body2" color="text.secondary" noWrap>
                {formatRelative(row.lastLoginAt)}
              </Typography>
            </Tooltip>
          ) : (
            <Typography variant="caption" color="text.disabled">
              Never
            </Typography>
          ),
      },
      {
        id: 'actions',
        label: '',
        align: 'right',
        width: 56,
        render: (row) => (
          <IconButton
            size="small"
            aria-label={`Actions for ${row.fullName}`}
            onClick={(event) => setMenu({ anchor: event.currentTarget, user: row })}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        ),
      },
    ],
    [],
  );

  const menuUser = menu.user;
  const isSelf = menuUser?.id === currentUser?.id;

  return (
    <Box>
      <PageHeader
        title="Employees"
        subtitle="Accounts are never deleted — deactivating one preserves its task history and every audit row that references it."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Employees' }]}
        actions={
          <Guard permission={PERMISSIONS.USER_CREATE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openForm(null)}>
              Add employee
            </Button>
          </Guard>
        }
      />

      <FilterBar onReset={resetFilters} canReset={hasFilters}>
        <SearchField
          value={searchInput}
          onChange={withPageReset(setSearchInput)}
          placeholder="Name, email, code…"
        />
        <SelectFilter
          label="Department"
          value={departmentId}
          onChange={withPageReset(setDepartmentId)}
          options={departmentOptions}
          allLabel="All departments"
          width={190}
        />
        <SelectFilter
          label="Role"
          value={role}
          onChange={withPageReset(setRole)}
          options={ROLES}
          allLabel="All roles"
          width={150}
        />
        <SelectFilter
          label="Status"
          value={status}
          onChange={withPageReset(setStatus)}
          options={USER_STATUSES}
          allLabel="All statuses"
          width={150}
        />
      </FilterBar>

      {usersQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(usersQuery.error, 'Could not load employees.')}
        </Alert>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={usersQuery.isLoading}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(nextSortBy, nextOrder) => {
          setSortBy(nextSortBy);
          setSortOrder(nextOrder);
        }}
        emptyTitle="No employees found"
        emptyMessage={
          hasFilters
            ? 'No employee matches these filters. Try widening them.'
            : 'Add your first employee to get started.'
        }
      />

      <Menu anchorEl={menu.anchor} open={Boolean(menu.anchor)} onClose={closeMenu}>
        <MenuItem onClick={() => openForm(menuUser)} disabled={!can(PERMISSIONS.USER_UPDATE)}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>

        <MenuItem
          onClick={() => {
            setResetTarget(menuUser);
            closeMenu();
          }}
          disabled={!can(PERMISSIONS.USER_RESET_PASSWORD)}
        >
          <ListItemIcon>
            <KeyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Reset password</ListItemText>
        </MenuItem>

        <Divider />

        {menuUser?.status === 'INACTIVE' ? (
          <MenuItem
            onClick={() => handleReactivate(menuUser)}
            disabled={!can(PERMISSIONS.USER_DEACTIVATE)}
          >
            <ListItemIcon>
              <RestoreIcon fontSize="small" color="success" />
            </ListItemIcon>
            <ListItemText>Reactivate</ListItemText>
          </MenuItem>
        ) : (
          <MenuItem
            onClick={() => {
              setDeactivateTarget(menuUser);
              closeMenu();
            }}
            // The API rejects self-deactivation (SELF_DEACTIVATION); don't offer it.
            disabled={!can(PERMISSIONS.USER_DEACTIVATE) || isSelf}
          >
            <ListItemIcon>
              <BlockIcon fontSize="small" color="error" />
            </ListItemIcon>
            <ListItemText>{isSelf ? 'Deactivate (not your own account)' : 'Deactivate'}</ListItemText>
          </MenuItem>
        )}

        <MenuItem
          onClick={() => {
            setDeleteTarget(menuUser);
            closeMenu();
          }}
          // The API rejects self-deletion (SELF_DELETE) exactly as it rejects
          // self-deactivation; don't offer what cannot be done.
          disabled={!can(PERMISSIONS.USER_DELETE) || isSelf}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <DeleteForeverIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText>
            {isSelf ? 'Delete (not your own account)' : 'Delete permanently'}
          </ListItemText>
        </MenuItem>
      </Menu>

      {formOpen && (
        <UserFormDialog
          open={formOpen}
          user={formUser}
          departmentOptions={departmentOptions}
          onClose={() => setFormOpen(false)}
          onCreated={(result) => {
            setFormOpen(false);
            invalidateUsers();
            queryClient.invalidateQueries({ queryKey: ['user-options'] });
            if (result.temporaryPassword) {
              setTemporaryPassword({
                password: result.temporaryPassword,
                email: result.user.email,
                title: 'Account created',
              });
            } else {
              enqueueSnackbar('Employee created', { variant: 'success' });
            }
          }}
          onUpdated={() => {
            setFormOpen(false);
            invalidateUsers();
            queryClient.invalidateQueries({ queryKey: ['user-options'] });
            enqueueSnackbar('Employee updated', { variant: 'success' });
          }}
        />
      )}

      {resetTarget && (
        <ResetPasswordDialog
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onDone={(result, user) => {
            setResetTarget(null);
            invalidateUsers();
            setTemporaryPassword({
              password: result.temporaryPassword,
              email: user.email,
              title: 'Password reset',
            });
          }}
        />
      )}

      {deactivateTarget && (
        <DeactivateDialog
          user={deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          onDone={() => {
            setDeactivateTarget(null);
            invalidateUsers();
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            enqueueSnackbar('Account deactivated. All of their sessions were revoked.', {
              variant: 'success',
            });
          }}
        />
      )}

      {deleteTarget && (
        <DeleteUserDialog
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeactivateInstead={(user) => {
            setDeleteTarget(null);
            setDeactivateTarget(user);
          }}
          onDone={(message) => {
            setDeleteTarget(null);
            invalidateUsers();
            queryClient.invalidateQueries({ queryKey: ['user-options'] });
            queryClient.invalidateQueries({ queryKey: ['teams'] });
            enqueueSnackbar(message, { variant: 'success', autoHideDuration: 8000 });
          }}
        />
      )}

      <TemporaryPasswordDialog
        open={Boolean(temporaryPassword)}
        password={temporaryPassword?.password ?? ''}
        email={temporaryPassword?.email}
        title={temporaryPassword?.title}
        onClose={() => setTemporaryPassword(null)}
      />
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 * Create / edit
 * ------------------------------------------------------------------ */

function UserFormDialog({ open, user, departmentOptions, onClose, onCreated, onUpdated }) {
  const isEdit = Boolean(user);
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(userSchema),
    defaultValues: isEdit
      ? {
          ...EMPTY_USER,
          firstName: user.firstName ?? '',
          lastName: user.lastName ?? '',
          email: user.email ?? '',
          employeeCode: user.employeeCode ?? '',
          phone: user.phone ?? '',
          designation: user.designation ?? '',
          role: user.role,
          departmentId: user.departmentId ?? '',
          teamId: user.teamId ?? '',
        }
      : EMPTY_USER,
  });

  const role = watch('role');
  const departmentId = watch('departmentId');
  const isManagement = role === MANAGEMENT;

  const teamsQuery = useQuery({
    queryKey: ['team-options', departmentId],
    queryFn: () => teamsApi.options({ departmentId }).then((res) => res.data),
    // A team belongs to exactly one department, so the list is meaningless until
    // a department is chosen — and a Management account has no team at all.
    enabled: Boolean(departmentId) && !isManagement,
  });

  const teamOptions = useMemo(
    () => (teamsQuery.data ?? []).map((team) => ({ value: team.id, label: team.name })),
    [teamsQuery.data],
  );

  const mutation = useMutation({
    mutationFn: (values) => {
      const managementAccount = values.role === MANAGEMENT;

      const body = {
        firstName: values.firstName,
        lastName: values.lastName,
        email: values.email,
        employeeCode: values.employeeCode,
        phone: values.phone,
        designation: values.designation,
        role: values.role,
        // Explicit nulls, not omissions: on a PATCH, omitting these would leave a
        // demoted user's stale department in place.
        departmentId: managementAccount ? null : values.departmentId,
        teamId: managementAccount ? null : values.teamId || null,
      };

      if (isEdit) return usersApi.update(user.id, body);

      return usersApi.create({
        ...body,
        password: values.password || undefined,
        sendWelcomeEmail: values.sendWelcomeEmail,
      });
    },
    onSuccess: (res) => (isEdit ? onUpdated(res.data) : onCreated(res.data)),
    onError: (error) => setServerError(error),
  });

  const handleRoleChange = (nextRole, field) => {
    field.onChange(nextRole);
    // Clear what the new role cannot legally hold, so a stale departmentId can't
    // ride along in the payload and earn a 422.
    if (nextRole === MANAGEMENT) {
      setValue('departmentId', '', { shouldValidate: true });
      setValue('teamId', '');
    }
  };

  return (
    <Dialog open={open} onClose={isSubmitting ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <DialogTitle>{isEdit ? `Edit ${user.fullName}` : 'Add employee'}</DialogTitle>

        <DialogContent>
          {serverError && isActionable(serverError) && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServerError(null)}>
              {errorMessage(serverError)}
            </Alert>
          )}

          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="firstName"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="First name"
                    error={Boolean(errors.firstName)}
                    helperText={errors.firstName?.message}
                    autoFocus
                  />
                )}
              />
              <Controller
                name="lastName"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Last name (optional)"
                    error={Boolean(errors.lastName)}
                    helperText={errors.lastName?.message ?? 'Leave blank for a single-name employee'}
                  />
                )}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="email"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Email"
                    type="email"
                    error={Boolean(errors.email)}
                    helperText={errors.email?.message}
                  />
                )}
              />
              <Controller
                name="employeeCode"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Employee code"
                    onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                    error={Boolean(errors.employeeCode)}
                    helperText={errors.employeeCode?.message ?? 'e.g. ARA-014'}
                  />
                )}
              />
            </Stack>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="phone"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Phone (optional)"
                    error={Boolean(errors.phone)}
                    helperText={errors.phone?.message}
                  />
                )}
              />
              <Controller
                name="designation"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Designation (optional)"
                    error={Boolean(errors.designation)}
                    helperText={errors.designation?.message}
                  />
                )}
              />
            </Stack>

            <Divider />

            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Role"
                  onChange={(event) => handleRoleChange(event.target.value, field)}
                  error={Boolean(errors.role)}
                  helperText={
                    errors.role?.message ??
                    (isManagement
                      ? 'Management accounts are company-wide: they belong to no department and no team.'
                      : undefined)
                  }
                >
                  {ROLES.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />

            {/* Hidden entirely for Management — the API rejects a department on a
                Management account, so offering the select would be a trap. */}
            {!isManagement && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <Controller
                  name="departmentId"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Department"
                      onChange={(event) => {
                        field.onChange(event.target.value);
                        // A team from the old department would be rejected by the API.
                        setValue('teamId', '');
                      }}
                      error={Boolean(errors.departmentId)}
                      helperText={errors.departmentId?.message}
                    >
                      {departmentOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />

                <Controller
                  name="teamId"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      select
                      label="Team (optional)"
                      disabled={!departmentId}
                      error={Boolean(errors.teamId)}
                      helperText={
                        errors.teamId?.message ??
                        (departmentId ? 'Teams in the chosen department' : 'Choose a department first')
                      }
                    >
                      <MenuItem value="">No team</MenuItem>
                      {teamOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value}>
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                />
              </Stack>
            )}

            {!isEdit && (
              <>
                <Divider />

                <Controller
                  name="password"
                  control={control}
                  render={({ field }) => (
                    <TextField
                      {...field}
                      label="Temporary password (optional)"
                      type="password"
                      autoComplete="new-password"
                      error={Boolean(errors.password)}
                      helperText={
                        errors.password?.message ??
                        'Leave blank and the server generates a strong one, shown to you once.'
                      }
                    />
                  )}
                />

                <Controller
                  name="sendWelcomeEmail"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={<Checkbox {...field} checked={field.value} size="small" />}
                      label={
                        <Typography variant="body2">
                          Email them a welcome message with their sign-in details
                        </Typography>
                      }
                    />
                  )}
                />
              </>
            )}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create employee'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Reset password
 * ------------------------------------------------------------------ */

function ResetPasswordDialog({ user, onClose, onDone }) {
  const [notifyUser, setNotifyUser] = useState(true);
  const [serverError, setServerError] = useState(null);

  const mutation = useMutation({
    mutationFn: () =>
      // No `newPassword`: the server generates one and returns it exactly once.
      usersApi.resetPassword(user.id, { requireChange: true, notifyUser }),
    onSuccess: (res) => onDone(res.data, user),
    onError: (error) => setServerError(error),
  });

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Reset password</DialogTitle>

      <DialogContent>
        {serverError && isActionable(serverError) && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage(serverError)}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          A new temporary password will be generated for <strong>{user.fullName}</strong> and shown to
          you once. All of their active sessions are revoked immediately, and they must set a new
          password at their next sign-in.
        </Typography>

        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={notifyUser}
              onChange={(event) => setNotifyUser(event.target.checked)}
            />
          }
          label={<Typography variant="body2">Email the new password to {user.email}</Typography>}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          variant="contained"
          disabled={mutation.isPending}
          startIcon={<KeyIcon fontSize="small" />}
        >
          Reset password
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Deactivate
 * ------------------------------------------------------------------ */

const deactivateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, 'Give a reason — it is written to the audit log')
    .max(500, 'At most 500 characters'),
});

function DeactivateDialog({ user, onClose, onDone }) {
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(deactivateSchema),
    defaultValues: { reason: '' },
  });

  const mutation = useMutation({
    mutationFn: (values) => usersApi.deactivate(user.id, { reason: values.reason }),
    onSuccess: () => onDone(),
    onError: (error) => setServerError(error),
  });

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <DialogTitle>Deactivate {user.fullName}?</DialogTitle>

        <DialogContent>
          {/* The 409s (LAST_MANAGEMENT_ACCOUNT, STILL_LEADS_TEAM) arrive with a
              message that tells the admin exactly what to do first. Show it verbatim. */}
          {serverError && isActionable(serverError) && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {errorMessage(serverError)}
            </Alert>
          )}

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            They will be signed out within seconds and cannot sign in again. Their task history and
            audit trail are kept — accounts are deactivated, never deleted.
          </Typography>

          <Controller
            name="reason"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Reason"
                multiline
                minRows={3}
                required
                error={Boolean(errors.reason)}
                helperText={
                  errors.reason?.message ?? 'Recorded on the audit entry. 3–500 characters.'
                }
                autoFocus
              />
            )}
          />
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" color="error" disabled={mutation.isPending}>
            Deactivate account
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Delete permanently
 * ------------------------------------------------------------------ */

/**
 * The one irreversible action in the whole admin surface.
 *
 * It asks the API what the delete would actually destroy BEFORE showing the
 * confirmation, so the admin reads real numbers ("412 task entries across 96
 * days") instead of a generic "are you sure?" — and it makes them type the
 * person's name. That is deliberate friction: a single misplaced click should not
 * be able to erase a year of somebody's work, and every alternative to typing is
 * a thing a tired person does by reflex.
 */
function DeleteUserDialog({ user, onClose, onDeactivateInstead, onDone }) {
  const previewQuery = useQuery({
    queryKey: ['user-delete-preview', user.id],
    queryFn: () => usersApi.deletePreview(user.id).then((res) => res.data),
    // The counts must be fresh: this is the number the admin is about to act on.
    staleTime: 0,
    gcTime: 0,
  });

  const preview = previewQuery.data;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: 'error.main' }}>Delete {user.fullName} permanently?</DialogTitle>

      {previewQuery.isLoading && (
        <>
          <DialogContent>
            <Skeleton variant="rounded" height={72} />
            <Skeleton variant="text" sx={{ mt: 2 }} />
            <Skeleton variant="text" width="60%" />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} color="inherit">
              Cancel
            </Button>
          </DialogActions>
        </>
      )}

      {previewQuery.isError && (
        <>
          <DialogContent>
            <Alert severity="error">
              {errorMessage(previewQuery.error, 'Could not work out what this would delete.')}
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose} color="inherit">
              Close
            </Button>
          </DialogActions>
        </>
      )}

      {/* Mounted only once the preview is in, so the type-to-confirm schema is built
          from the real name rather than from an empty string. */}
      {preview && (
        <DeleteUserConfirmation
          user={user}
          preview={preview}
          onClose={onClose}
          onDeactivateInstead={onDeactivateInstead}
          onDone={onDone}
        />
      )}
    </Dialog>
  );
}

function DeleteUserConfirmation({ user, preview, onClose, onDeactivateInstead, onDone }) {
  const [serverError, setServerError] = useState(null);

  // `willPreserve`, not `willDestroy`. Deleting the ACCOUNT no longer erases the
  // WORK — the timesheets survive, stamped with the person's name. The dialog has
  // to say that, because an admin who believes they are about to destroy a year of
  // delivery history will (rightly) never click the button.
  const { taskEntries = 0, taskDays = 0 } = preview.willPreserve ?? {};
  const blockers = preview.blockers ?? [];
  const isBlocked = blockers.length > 0;
  const hasWork = taskEntries > 0;

  const schema = useMemo(
    () =>
      z.object({
        confirmation: z
          .string()
          .trim()
          .refine((value) => value === preview.fullName, {
            message: `Type "${preview.fullName}" exactly`,
          }),
      }),
    [preview.fullName],
  );

  const {
    control,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { confirmation: '' },
  });

  const mutation = useMutation({
    mutationFn: () => usersApi.destroy(user.id),
    // The API's own message counts what it destroyed; it is the truthful receipt.
    onSuccess: (res) => onDone(res.message ?? `${preview.fullName} was permanently deleted`),
    onError: (error) => setServerError(error),
  });

  return (
    <form onSubmit={handleSubmit(() => mutation.mutate())} noValidate>
      <DialogContent>
        <Stack spacing={2}>
          {serverError && isActionable(serverError) && (
            <Alert severity="error">{errorMessage(serverError)}</Alert>
          )}

          <Alert severity="error" icon={false}>
            <AlertTitle sx={{ fontSize: 14 }}>This cannot be undone.</AlertTitle>
            This permanently removes the <strong>account</strong> for {preview.fullName} (
            {preview.email}) — their login, sessions and notifications.
          </Alert>

          {/* The reassurance is as important as the warning. Without it, an admin
              assumes the worst and never deletes anything. */}
          {hasWork && (
            <Alert severity="success" icon={false}>
              <AlertTitle sx={{ fontSize: 14 }}>Their work is kept</AlertTitle>
              All <strong>{taskEntries}</strong> task {taskEntries === 1 ? 'entry' : 'entries'} across{' '}
              <strong>{taskDays}</strong> {taskDays === 1 ? 'day' : 'days'} will be{' '}
              <strong>preserved</strong> and stay attributed to <strong>{preview.fullName}</strong> by
              name — in the monitor, in every report, and in every export. Deleting the account does
              not erase the work.
            </Alert>
          )}

          {preview.recommendation && (
            <Alert severity="info">{preview.recommendation}</Alert>
          )}

          {isBlocked && (
            <Alert severity="error">
              <AlertTitle sx={{ fontSize: 14 }}>Clear these first</AlertTitle>
              <Stack component="ul" sx={{ m: 0, pl: 2.5 }}>
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </Stack>
            </Alert>
          )}

          <Divider />

          <Controller
            name="confirmation"
            control={control}
            render={({ field }) => (
              <TextField
                {...field}
                label="Type the employee's full name to confirm"
                placeholder={preview.fullName}
                disabled={isBlocked || mutation.isPending}
                error={Boolean(errors.confirmation)}
                helperText={
                  errors.confirmation?.message ??
                  'Deleting destroys history. The audit log keeps a record that it happened.'
                }
                autoComplete="off"
                autoFocus
              />
            )}
          />
        </Stack>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
          Cancel
        </Button>

        <Button
          onClick={() => onDeactivateInstead(user)}
          disabled={mutation.isPending}
          startIcon={<BlockIcon fontSize="small" />}
        >
          Deactivate instead
        </Button>

        <Button
          type="submit"
          variant="contained"
          color="error"
          disabled={isBlocked || mutation.isPending}
          startIcon={<DeleteForeverIcon fontSize="small" />}
        >
          Delete permanently
        </Button>
      </DialogActions>
    </form>
  );
}
