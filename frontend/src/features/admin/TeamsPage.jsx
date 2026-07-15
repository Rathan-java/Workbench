import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Pagination from '@mui/material/Pagination';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import AddIcon from '@mui/icons-material/AddRounded';
import CloseIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditIcon from '@mui/icons-material/EditOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import PersonRemoveIcon from '@mui/icons-material/PersonRemoveOutlined';
import WarningIcon from '@mui/icons-material/WarningAmberRounded';
import PersonAddIcon from '@mui/icons-material/PersonAddAltOutlined';

import PageHeader from '../../components/common/PageHeader.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import Guard from '../../components/common/Guard.jsx';
import { useConfirm } from '../../components/common/ConfirmDialog.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { teams as teamsApi, users as usersApi } from '../../api/endpoints.js';
import { PERMISSIONS, ROLE } from '../../utils/constants.js';

import DeleteTeamDialog from './components/DeleteTeamDialog.jsx';
import DepartmentChip from './components/DepartmentChip.jsx';
import ToneChip from './components/ToneChip.jsx';
import { ROLE_TONE } from './components/tones.js';
import FilterBar, { SearchField, SelectFilter } from './components/FilterBar.jsx';
import UserCell, { UserAvatar } from './components/UserCell.jsx';
import { useDepartments } from './components/useDepartments.js';
import { errorMessage, isActionable } from './components/apiError.js';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 400;

const teamSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  code: z
    .string()
    .trim()
    .min(2, 'At least 2 characters')
    .max(48)
    .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and hyphens only'),
  description: z.string().trim().max(500).or(z.literal('')),
  departmentId: z.string().min(1, 'Choose a department'),
  leadId: z.string().or(z.literal('')),
  isActive: z.boolean(),
});

export default function TeamsPage() {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { options: departmentOptions, getById: getDepartment } = useDepartments();

  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [departmentId, setDepartmentId] = useState('');
  const [page, setPage] = useState(1);

  const [formTeam, setFormTeam] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState(null);

  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      sortBy: 'name',
      sortOrder: 'asc',
      search: search || undefined,
      departmentId: departmentId || undefined,
    }),
    [page, search, departmentId],
  );

  const teamsQuery = useQuery({
    queryKey: ['teams', params],
    queryFn: () => teamsApi.list(params),
    placeholderData: (previous) => previous,
  });

  const teams = teamsQuery.data?.data ?? [];
  const pagination = teamsQuery.data?.meta?.pagination;
  const totalPages = pagination?.totalPages ?? 1;

  const hasFilters = Boolean(searchInput || departmentId);

  const resetFilters = () => {
    setSearchInput('');
    setDepartmentId('');
    setPage(1);
  };

  const openForm = (team) => {
    setFormTeam(team);
    setFormOpen(true);
  };

  const afterMutation = (message) => {
    queryClient.invalidateQueries({ queryKey: ['teams'] });
    queryClient.invalidateQueries({ queryKey: ['team-options'] });
    enqueueSnackbar(message, { variant: 'success' });
  };

  return (
    <Box>
      <PageHeader
        title="Teams"
        subtitle="A team lives inside exactly one department, and its lead must be a Tech Lead from that same department."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Teams' }]}
        actions={
          <Guard permission={PERMISSIONS.TEAM_MANAGE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openForm(null)}>
              Create team
            </Button>
          </Guard>
        }
      />

      <FilterBar onReset={resetFilters} canReset={hasFilters}>
        <SearchField
          value={searchInput}
          onChange={(value) => {
            setSearchInput(value);
            setPage(1);
          }}
          placeholder="Team name or code…"
        />
        <SelectFilter
          label="Department"
          value={departmentId}
          onChange={(value) => {
            setDepartmentId(value);
            setPage(1);
          }}
          options={departmentOptions}
          allLabel="All departments"
          width={190}
        />
      </FilterBar>

      {teamsQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(teamsQuery.error, 'Could not load teams.')}
        </Alert>
      )}

      {teamsQuery.isLoading ? (
        <TeamGrid>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={168} />
          ))}
        </TeamGrid>
      ) : teams.length === 0 ? (
        <EmptyState
          icon={GroupsIcon}
          title="No teams yet"
          message={
            hasFilters
              ? 'No team matches these filters.'
              : 'Create a team to give a Tech Lead a group of employees to look after.'
          }
        />
      ) : (
        <TeamGrid>
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} onOpen={() => setSelectedTeamId(team.id)} />
          ))}
        </TeamGrid>
      )}

      {totalPages > 1 && (
        <Stack alignItems="center" sx={{ mt: 3 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_event, value) => setPage(value)}
            shape="rounded"
          />
        </Stack>
      )}

      {formOpen && (
        <TeamFormDialog
          team={formTeam}
          departmentOptions={departmentOptions}
          getDepartment={getDepartment}
          onClose={() => setFormOpen(false)}
          onSaved={(isEdit) => {
            setFormOpen(false);
            afterMutation(isEdit ? 'Team updated' : 'Team created');
          }}
        />
      )}

      {selectedTeamId && (
        <TeamDrawer
          teamId={selectedTeamId}
          onClose={() => setSelectedTeamId(null)}
          onEdit={(team) => {
            setSelectedTeamId(null);
            openForm(team);
          }}
        />
      )}
    </Box>
  );
}

function TeamGrid({ children }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 2,
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: 'repeat(3, minmax(0, 1fr))',
        },
      }}
    >
      {children}
    </Box>
  );
}

function TeamCard({ team, onOpen }) {
  return (
    <Card sx={{ opacity: team.isActive ? 1 : 0.65 }}>
      <CardActionArea onClick={onOpen} sx={{ height: '100%', alignItems: 'stretch' }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap>
                {team.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {team.code}
              </Typography>
            </Box>

            {!team.isActive && <ToneChip tone="neutral" label="Inactive" />}
          </Stack>

          <DepartmentChip department={team.department} sx={{ alignSelf: 'flex-start' }} />

          <Divider />

          {team.lead ? (
            <UserCell user={team.lead} secondary="Team lead" size={28} />
          ) : (
            <Chip
              icon={<WarningIcon sx={{ fontSize: 14 }} />}
              label="No lead assigned"
              size="small"
              color="warning"
              variant="outlined"
              sx={{ alignSelf: 'flex-start' }}
            />
          )}

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 'auto', pt: 0.5 }}>
            <GroupsIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
            <Typography variant="caption" color="text.secondary">
              {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
            </Typography>
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Detail drawer — members
 * ------------------------------------------------------------------ */

function TeamDrawer({ teamId, onClose, onEdit }) {
  const [deleting, setDeleting] = useState(null);
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const confirm = useConfirm();

  const [selected, setSelected] = useState([]);

  const teamQuery = useQuery({
    queryKey: ['team', teamId],
    queryFn: () => teamsApi.get(teamId).then((res) => res.data),
  });

  const team = teamQuery.data;

  /**
   * Candidates are constrained to the team's OWN department: the API rejects a
   * cross-department assignment (MEMBER_DEPARTMENT_MISMATCH) and refuses
   * Management accounts outright. Management users carry no departmentId, so the
   * department filter already excludes them — the role filter below makes that
   * explicit rather than incidental.
   */
  const candidatesQuery = useQuery({
    queryKey: ['user-options', { departmentId: team?.departmentId }],
    queryFn: () => usersApi.options({ departmentId: team.departmentId }).then((res) => res.data),
    enabled: Boolean(team?.departmentId),
  });

  const memberIds = useMemo(() => new Set((team?.members ?? []).map((m) => m.id)), [team]);

  const candidates = useMemo(
    () =>
      (candidatesQuery.data ?? []).filter(
        (candidate) => candidate.role !== 'MANAGEMENT' && !memberIds.has(candidate.id),
      ),
    [candidatesQuery.data, memberIds],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['team', teamId] });
    queryClient.invalidateQueries({ queryKey: ['teams'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const assignMutation = useMutation({
    mutationFn: (userIds) => teamsApi.assignMembers(teamId, { userIds }),
    onSuccess: () => {
      setSelected([]);
      invalidate();
      enqueueSnackbar('Members assigned', { variant: 'success' });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const removeMutation = useMutation({
    mutationFn: (userId) => teamsApi.removeMember(teamId, userId),
    onSuccess: () => {
      invalidate();
      enqueueSnackbar('Member removed', { variant: 'success' });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const handleRemove = async (member) => {
    const confirmed = await confirm({
      title: `Remove ${member.fullName} from ${team.name}?`,
      message: 'They keep their account and their task history; they simply have no team until reassigned.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (confirmed) removeMutation.mutate(member.id);
  };

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', sm: 460 } } } }}
    >
      {(teamQuery.isFetching || assignMutation.isPending || removeMutation.isPending) && (
        <LinearProgress />
      )}

      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" noWrap>
              {team?.name ?? 'Team'}
            </Typography>
            {team && (
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {team.code}
              </Typography>
            )}
          </Box>

          <Stack direction="row" spacing={0.5}>
            {team && (
              <Guard permission={PERMISSIONS.TEAM_MANAGE}>
                <Tooltip title="Edit team">
                  <IconButton size="small" onClick={() => onEdit(team)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Delete team">
                  <IconButton size="small" color="error" onClick={() => setDeleting(team)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Guard>
            )}
            <IconButton size="small" onClick={onClose} aria-label="Close">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
        </Stack>

        {teamQuery.isError && (
          <Alert severity="error">{errorMessage(teamQuery.error, 'Could not load this team.')}</Alert>
        )}

        {team && (
          <Stack spacing={2.5}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <DepartmentChip department={team.department} />
              <ToneChip tone={team.isActive ? 'success' : 'neutral'} label={team.isActive ? 'Active' : 'Inactive'} />
            </Stack>

            {team.description && (
              <Typography variant="body2" color="text.secondary">
                {team.description}
              </Typography>
            )}

            <Box>
              <Typography variant="overline" color="text.secondary">
                Team lead
              </Typography>
              <Box sx={{ mt: 1 }}>
                {team.lead ? (
                  <UserCell user={team.lead} secondary={team.lead.email} />
                ) : (
                  <Alert severity="warning" icon={<WarningIcon fontSize="small" />}>
                    No lead assigned. Nobody is approving this team&apos;s timesheets — edit the team
                    to assign a Tech Lead.
                  </Alert>
                )}
              </Box>
            </Box>

            <Divider />

            <Guard permission={PERMISSIONS.TEAM_MANAGE}>
              <Box>
                <Typography variant="overline" color="text.secondary">
                  Assign members
                </Typography>

                <Autocomplete
                  multiple
                  options={candidates}
                  value={selected}
                  onChange={(_event, value) => setSelected(value)}
                  getOptionLabel={(option) => option.fullName}
                  isOptionEqualToValue={(option, value) => option.id === value.id}
                  loading={candidatesQuery.isLoading}
                  disabled={!team.isActive}
                  noOptionsText="Everyone in this department is already on this team"
                  sx={{ mt: 1 }}
                  renderOption={(props, option) => {
                    const { key, ...optionProps } = props;
                    return (
                      <Box component="li" key={key} {...optionProps} sx={{ gap: 1.25 }}>
                        <UserAvatar user={option} size={26} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" noWrap>
                            {option.fullName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {option.employeeCode}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  }}
                  renderInput={(inputParams) => (
                    <TextField
                      {...inputParams}
                      placeholder={selected.length ? '' : 'Search employees…'}
                      helperText={
                        team.isActive
                          ? 'Only employees from this team’s department can be assigned.'
                          : 'This team is inactive — reactivate it to assign members.'
                      }
                    />
                  )}
                />

                <Button
                  variant="contained"
                  size="small"
                  startIcon={<PersonAddIcon fontSize="small" />}
                  sx={{ mt: 1.5 }}
                  disabled={selected.length === 0 || assignMutation.isPending}
                  onClick={() => assignMutation.mutate(selected.map((s) => s.id))}
                >
                  Assign {selected.length > 0 ? `${selected.length} ` : ''}
                  {selected.length === 1 ? 'employee' : 'employees'}
                </Button>
              </Box>
            </Guard>

            <Divider />

            <Box>
              <Typography variant="overline" color="text.secondary">
                Members ({team.members.length})
              </Typography>

              {team.members.length === 0 ? (
                <EmptyState
                  dense
                  icon={GroupsIcon}
                  title="No members yet"
                  message="Assign employees from this department above."
                />
              ) : (
                <Stack divider={<Divider />} sx={{ mt: 1 }}>
                  {team.members.map((member) => {
                    const isLead = member.id === team.leadId;

                    return (
                      <Stack
                        key={member.id}
                        direction="row"
                        alignItems="center"
                        justifyContent="space-between"
                        spacing={1}
                        sx={{ py: 1 }}
                      >
                        <UserCell
                          user={member}
                          secondary={member.designation || member.employeeCode}
                          size={30}
                        />

                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <ToneChip tone={ROLE_TONE[member.role]} label={ROLE[member.role] ?? member.role} />

                          <Guard permission={PERMISSIONS.TEAM_MANAGE}>
                            {/* The API returns 409 CANNOT_REMOVE_LEAD here; disabling the
                                button with an explanation beats letting them find out. */}
                            <Tooltip
                              title={
                                isLead
                                  ? 'This member leads the team. Assign a different lead before removing them.'
                                  : 'Remove from team'
                              }
                            >
                              <span>
                                <IconButton
                                  size="small"
                                  color="error"
                                  disabled={isLead || removeMutation.isPending}
                                  onClick={() => handleRemove(member)}
                                  aria-label={`Remove ${member.fullName}`}
                                >
                                  <PersonRemoveIcon fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </Guard>
                        </Stack>
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </Box>
          </Stack>
        )}
      </Box>
      <DeleteTeamDialog
        team={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={onClose}
      />
    </Drawer>
  );
}

/* ------------------------------------------------------------------ *
 * Create / edit
 * ------------------------------------------------------------------ */

function TeamFormDialog({ team, departmentOptions, getDepartment, onClose, onSaved }) {
  const isEdit = Boolean(team);
  const [serverError, setServerError] = useState(null);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(teamSchema),
    defaultValues: {
      name: team?.name ?? '',
      code: team?.code ?? '',
      description: team?.description ?? '',
      departmentId: team?.departmentId ?? '',
      leadId: team?.leadId ?? '',
      isActive: team?.isActive ?? true,
    },
  });

  const departmentId = watch('departmentId');

  /**
   * The lead dropdown is filtered to TECH_LEADs *in the chosen department*: the
   * API refuses any other lead (LEAD_ROLE_INVALID / LEAD_DEPARTMENT_MISMATCH),
   * and that rule is exactly what keeps the departments isolated from one another.
   */
  // Note: constants.ROLE is a label map ('TECH_LEAD' -> 'Tech Lead'); the API wants
  // the enum VALUE, so the role filter is the literal.
  const leadsQuery = useQuery({
    queryKey: ['user-options', { departmentId, role: 'TECH_LEAD' }],
    queryFn: () => usersApi.options({ departmentId, role: 'TECH_LEAD' }).then((res) => res.data),
    enabled: Boolean(departmentId),
  });

  const leadOptions = leadsQuery.data ?? [];

  const mutation = useMutation({
    mutationFn: (values) => {
      const body = {
        name: values.name,
        code: values.code,
        description: values.description,
        leadId: values.leadId || null,
      };

      // A team's department is immutable — the API rejects a change with
      // TEAM_DEPARTMENT_IMMUTABLE, so it is simply never sent on an update.
      if (isEdit) return teamsApi.update(team.id, { ...body, isActive: values.isActive });

      return teamsApi.create({ ...body, departmentId: values.departmentId });
    },
    onSuccess: () => onSaved(isEdit),
    onError: (error) => setServerError(error),
  });

  const department = isEdit ? (team.department ?? getDepartment(team.departmentId)) : null;

  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} noValidate>
        <DialogTitle>{isEdit ? `Edit ${team.name}` : 'Create team'}</DialogTitle>

        <DialogContent>
          {serverError && isActionable(serverError) && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServerError(null)}>
              {errorMessage(serverError)}
            </Alert>
          )}

          <Stack spacing={2} sx={{ pt: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="name"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Team name"
                    error={Boolean(errors.name)}
                    helperText={errors.name?.message}
                    autoFocus
                  />
                )}
              />
              <Controller
                name="code"
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label="Code"
                    onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                    error={Boolean(errors.code)}
                    helperText={errors.code?.message ?? 'e.g. TECH-CORE'}
                  />
                )}
              />
            </Stack>

            <Controller
              name="description"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  label="Description (optional)"
                  multiline
                  minRows={2}
                  error={Boolean(errors.description)}
                  helperText={errors.description?.message}
                />
              )}
            />

            {isEdit ? (
              <Box>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  Department
                </Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <DepartmentChip department={department} />
                  <Typography variant="caption" color="text.disabled">
                    Immutable — a team cannot be moved between departments.
                  </Typography>
                </Stack>
              </Box>
            ) : (
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
                      // A lead from the previous department is no longer eligible.
                      setValue('leadId', '');
                    }}
                    error={Boolean(errors.departmentId)}
                    helperText={
                      errors.departmentId?.message ?? 'Cannot be changed once the team exists.'
                    }
                  >
                    {departmentOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              />
            )}

            <Controller
              name="leadId"
              control={control}
              render={({ field }) => (
                <TextField
                  {...field}
                  select
                  label="Team lead (optional)"
                  disabled={!departmentId}
                  error={Boolean(errors.leadId)}
                  helperText={
                    errors.leadId?.message ??
                    (!departmentId
                      ? 'Choose a department first — a lead must be a Tech Lead from that department.'
                      : leadOptions.length === 0 && !leadsQuery.isLoading
                        ? 'No Tech Leads in this department yet. Create one, or leave the team unled for now.'
                        : 'Only Tech Leads from this department are eligible.')
                  }
                >
                  <MenuItem value="">No lead</MenuItem>
                  {leadOptions.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.fullName} · {option.employeeCode}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />

            {isEdit && (
              <Controller
                name="isActive"
                control={control}
                render={({ field }) => (
                  <FormControlLabel
                    control={<Switch {...field} checked={field.value} size="small" />}
                    label={
                      <Typography variant="body2">
                        Active — inactive teams cannot take new members
                      </Typography>
                    }
                  />
                )}
              />
            )}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {isEdit ? 'Save changes' : 'Create team'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
