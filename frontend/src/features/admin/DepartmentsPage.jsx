import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { alpha, lighten, useTheme } from '@mui/material/styles';

import AddIcon from '@mui/icons-material/AddRounded';
import AccountTreeIcon from '@mui/icons-material/AccountTreeOutlined';
import FolderIcon from '@mui/icons-material/FolderOpenOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';

import PageHeader from '../../components/common/PageHeader.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import Guard from '../../components/common/Guard.jsx';
import { PERMISSIONS } from '../../utils/constants.js';

import ToneChip from './components/ToneChip.jsx';
import FilterBar, { SearchField } from './components/FilterBar.jsx';
import { useDepartments } from './components/useDepartments.js';
import { errorMessage } from './components/apiError.js';
import DepartmentWizard from './components/DepartmentWizard.jsx';
import DepartmentDrawer from './components/DepartmentDrawer.jsx';
import DeleteDepartmentDialog from './components/DeleteDepartmentDialog.jsx';
import { weekdaySummary } from './components/departmentConfig.js';

export default function DepartmentsPage() {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const { departments, isLoading, isError, error } = useDepartments();

  const [search, setSearch] = useState('');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  /** The list endpoint takes no query parameters, so the filter is a local one. */
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return departments;

    return departments.filter(
      (department) =>
        department.name.toLowerCase().includes(needle) ||
        department.code.toLowerCase().includes(needle),
    );
  }, [departments, search]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['departments'] });

  return (
    <Box>
      <PageHeader
        title="Departments"
        subtitle="A department owns its own working hours and its own task fields — creating one builds its employees' task screen, with no code change anywhere."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Departments' }]}
        actions={
          <Guard permission={PERMISSIONS.DEPARTMENT_MANAGE}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setWizardOpen(true)}>
              New department
            </Button>
          </Guard>
        }
      />

      <FilterBar onReset={() => setSearch('')} canReset={Boolean(search)}>
        <SearchField value={search} onChange={setSearch} placeholder="Name or code…" />
      </FilterBar>

      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(error, 'Could not load departments.')}
        </Alert>
      )}

      {isLoading ? (
        <DepartmentGrid>
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} variant="rounded" height={188} />
          ))}
        </DepartmentGrid>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={AccountTreeIcon}
          title={search ? 'No department matches' : 'No departments yet'}
          message={
            search
              ? 'Nothing matches that name or code.'
              : 'A department is the root of the org model: its people, its teams, its projects and its task grid all hang off it.'
          }
        />
      ) : (
        <DepartmentGrid>
          {visible.map((department) => (
            <DepartmentCard
              key={department.id}
              department={department}
              onOpen={() => setSelectedId(department.id)}
            />
          ))}
        </DepartmentGrid>
      )}

      {wizardOpen && (
        <DepartmentWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(department) => {
            setWizardOpen(false);
            invalidate();
            enqueueSnackbar(`${department.name} created. Its task screen is live.`, {
              variant: 'success',
            });
          }}
        />
      )}

      {selectedId && (
        <DepartmentDrawer
          departmentId={selectedId}
          onClose={() => setSelectedId(null)}
          onDeleteRequest={(department) => setDeleteTarget(department)}
        />
      )}

      {deleteTarget && (
        <DeleteDepartmentDialog
          department={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={(department) => {
            setDeleteTarget(null);
            setSelectedId(null);
            invalidate();
            enqueueSnackbar(`${department.name} deleted`, { variant: 'success' });
          }}
          onDeactivated={(department) => {
            setDeleteTarget(null);
            setSelectedId(null);
            invalidate();
            // The list endpoint only returns ACTIVE departments, so it is about to
            // disappear from this page entirely. Say so, rather than letting the
            // admin wonder where it went.
            enqueueSnackbar(
              `${department.name} deactivated. It keeps its history but no longer appears here or in any dropdown.`,
              { variant: 'info', autoHideDuration: 8000 },
            );
          }}
        />
      )}
    </Box>
  );
}

function DepartmentGrid({ children }) {
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

function DepartmentCard({ department, onOpen }) {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  const base = /^#[0-9A-Fa-f]{6}$/.test(department.colorHex ?? '')
    ? department.colorHex
    : theme.palette.primary.main;

  // The seeded hues are chosen for a white background; on #020617 a 600-weight
  // colour reads as mud. Lift it in dark mode, exactly as DepartmentChip does.
  const accent = isDark ? lighten(base, 0.35) : base;

  const stats = department.stats ?? {};

  return (
    <Card
      sx={{
        opacity: department.isActive ? 1 : 0.65,
        borderTop: `3px solid ${accent}`,
      }}
    >
      <CardActionArea onClick={onOpen} sx={{ height: '100%', alignItems: 'stretch' }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, height: '100%' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" noWrap sx={{ color: accent }}>
                {department.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {department.code}
              </Typography>
            </Box>

            <ToneChip
              tone={department.isActive ? 'success' : 'neutral'}
              label={department.isActive ? 'Active' : 'Inactive'}
            />
          </Stack>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              minHeight: 40,
            }}
          >
            {department.description || 'No description.'}
          </Typography>

          <Divider />

          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Stat icon={PeopleIcon} value={stats.employees ?? 0} label="employees" accent={accent} />
            <Stat icon={GroupsIcon} value={stats.teams ?? 0} label="teams" accent={accent} />
            <Stat icon={FolderIcon} value={stats.projects ?? 0} label="projects" accent={accent} />
          </Stack>

          <Typography variant="caption" color="text.disabled" sx={{ mt: 'auto', pt: 0.5 }}>
            {department.requiredSlotsPerDay} hours a day ·{' '}
            {weekdaySummary(department.workingWeekdays ?? [])}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

function Stat({ icon: Icon, value, label, accent }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 26,
          height: 26,
          borderRadius: 1,
          bgcolor: alpha(accent, 0.12),
          color: accent,
        }}
      >
        <Icon sx={{ fontSize: 15 }} />
      </Box>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.1 }}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.disabled" sx={{ lineHeight: 1 }}>
          {label}
        </Typography>
      </Box>
    </Stack>
  );
}
