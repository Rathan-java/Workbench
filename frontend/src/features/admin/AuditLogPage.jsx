import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import CloseIcon from '@mui/icons-material/CloseRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined';
import ErrorIcon from '@mui/icons-material/ErrorOutlineRounded';
import CodeIcon from '@mui/icons-material/CodeRounded';

import DataTable from '../../components/common/DataTable.jsx';
import PageHeader from '../../components/common/PageHeader.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import { useDebounce } from '../../hooks/useDebounce.js';
import { audit as auditApi, users as usersApi } from '../../api/endpoints.js';
import { DEFAULT_PAGE_SIZE } from '../../utils/constants.js';
import { formatDateTime, formatRelative, humanizeEnum } from '../../utils/format.js';

import ToneChip from './components/ToneChip.jsx';
import { actionTone, toneHex } from './components/tones.js';
import FilterBar, { SearchField, SelectFilter } from './components/FilterBar.jsx';
import UserCell from './components/UserCell.jsx';
import { errorMessage } from './components/apiError.js';

const SEARCH_DEBOUNCE_MS = 400;

/** Entity types the backend actually stamps on an audit row. */
const ENTITY_TYPES = [
  'User',
  'Team',
  'Project',
  'Department',
  'TaskEntry',
  'TaskDay',
  'SystemSetting',
  'RefreshToken',
  'Report',
  'System',
].map((value) => ({ value, label: value }));

const SUCCESS_OPTIONS = [
  { value: 'true', label: 'Succeeded' },
  { value: 'false', label: 'Failed' },
];

export default function AuditLogPage() {
  const [searchInput, setSearchInput] = useState('');
  const search = useDebounce(searchInput, SEARCH_DEBOUNCE_MS);
  const [action, setAction] = useState('');
  const [actor, setActor] = useState(null);
  const [entityType, setEntityType] = useState('');
  const [success, setSuccess] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');

  const [selected, setSelected] = useState(null);

  const actionsQuery = useQuery({
    queryKey: ['audit-actions'],
    queryFn: () => auditApi.actions().then((res) => res.data),
    staleTime: Infinity,
  });

  const actorsQuery = useQuery({
    queryKey: ['user-options', { includeInactive: true }],
    queryFn: () => usersApi.options({ includeInactive: true }).then((res) => res.data),
    staleTime: 5 * 60 * 1000,
  });

  const actionOptions = useMemo(
    () => (actionsQuery.data ?? []).map((value) => ({ value, label: humanizeEnum(value) })),
    [actionsQuery.data],
  );

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy,
      sortOrder,
      search: search || undefined,
      action: action || undefined,
      actorId: actor?.id || undefined,
      entityType: entityType || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      // Booleans, not strings — endpoints.js knows how to make `false` survive
      // the API's z.coerce.boolean().
      success: success === '' ? undefined : success === 'true',
    }),
    [page, pageSize, sortBy, sortOrder, search, action, actor, entityType, dateFrom, dateTo, success],
  );

  const auditQuery = useQuery({
    queryKey: ['audit', params],
    queryFn: () => auditApi.list(params),
    placeholderData: (previous) => previous,
  });

  const rows = auditQuery.data?.data ?? [];
  const total = auditQuery.data?.meta?.pagination?.total ?? 0;

  const hasFilters = Boolean(
    searchInput || action || actor || entityType || success || dateFrom || dateTo,
  );

  const resetFilters = () => {
    setSearchInput('');
    setAction('');
    setActor(null);
    setEntityType('');
    setSuccess('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  };

  const withPageReset = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const columns = useMemo(
    () => [
      {
        id: 'createdAt',
        label: 'When',
        sortable: true,
        width: 170,
        render: (row) => (
          <Tooltip title={formatRelative(row.createdAt)}>
            <Typography variant="body2" color="text.secondary" noWrap>
              {formatDateTime(row.createdAt)}
            </Typography>
          </Tooltip>
        ),
      },
      {
        id: 'actor',
        label: 'Actor',
        width: 200,
        render: (row) =>
          row.actor ? (
            <UserCell user={row.actor} secondary={row.actorRole ? humanizeEnum(row.actorRole) : undefined} size={28} />
          ) : (
            <Stack>
              <Typography variant="body2" color="text.secondary">
                System
              </Typography>
              {row.actorEmail && (
                <Typography variant="caption" color="text.disabled">
                  {row.actorEmail}
                </Typography>
              )}
            </Stack>
          ),
      },
      {
        id: 'action',
        label: 'Action',
        sortable: true,
        render: (row) => (
          <Stack direction="row" spacing={0.5} alignItems="center">
            {!row.success && <ErrorIcon sx={{ fontSize: 14, color: 'error.main' }} />}
            <ToneChip tone={actionTone(row.action)} label={humanizeEnum(row.action)} />
          </Stack>
        ),
      },
      {
        id: 'summary',
        label: 'Summary',
        render: (row) => (
          <Typography variant="body2" sx={{ maxWidth: 420 }} noWrap>
            {row.summary || '—'}
          </Typography>
        ),
      },
      {
        id: 'ip',
        label: 'IP',
        width: 130,
        render: (row) => (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontFamily: 'monospace' }}
            noWrap
          >
            {row.ip || '—'}
          </Typography>
        ),
      },
    ],
    [],
  );

  return (
    <Box>
      <PageHeader
        title="Audit log"
        subtitle="Append-only. Rows are only ever inserted — there is no edit or delete endpoint, and the 180-day retention job explicitly spares this table. The record of who deleted the data outlives the data."
        breadcrumbs={[{ label: 'Admin' }, { label: 'Audit log' }]}
      />

      <FilterBar onReset={resetFilters} canReset={hasFilters}>
        <SearchField
          value={searchInput}
          onChange={withPageReset(setSearchInput)}
          placeholder="Summary, email, correlation ID…"
        />

        <SelectFilter
          label="Action"
          value={action}
          onChange={withPageReset(setAction)}
          options={actionOptions}
          allLabel="All actions"
          width={210}
        />

        <Autocomplete
          options={actorsQuery.data ?? []}
          value={actor}
          onChange={(_event, value) => {
            setActor(value);
            setPage(1);
          }}
          getOptionLabel={(option) => option.fullName}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          loading={actorsQuery.isLoading}
          sx={{ width: { xs: '100%', sm: 210 } }}
          renderInput={(inputParams) => <TextField {...inputParams} label="Actor" />}
        />

        <SelectFilter
          label="Entity"
          value={entityType}
          onChange={withPageReset(setEntityType)}
          options={ENTITY_TYPES}
          allLabel="All entities"
          width={150}
        />

        <SelectFilter
          label="Outcome"
          value={success}
          onChange={withPageReset(setSuccess)}
          options={SUCCESS_OPTIONS}
          allLabel="Any outcome"
          width={150}
        />

        <TextField
          label="From"
          type="date"
          value={dateFrom}
          onChange={(event) => withPageReset(setDateFrom)(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: { xs: '100%', sm: 160 } }}
        />
        <TextField
          label="To"
          type="date"
          value={dateTo}
          onChange={(event) => withPageReset(setDateTo)(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ width: { xs: '100%', sm: 160 } }}
        />
      </FilterBar>

      {auditQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(auditQuery.error, 'Could not load the audit log.')}
        </Alert>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={auditQuery.isLoading}
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
        onRowClick={setSelected}
        dense
        emptyTitle="No audit events"
        emptyMessage={
          hasFilters
            ? 'No event matches these filters. Widen the date range or clear the action filter.'
            : 'Nothing has been recorded yet.'
        }
      />

      {selected && <AuditDetailDrawer entry={selected} onClose={() => setSelected(null)} />}
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 * Detail drawer — the before/after diff
 * ------------------------------------------------------------------ */

function AuditDetailDrawer({ entry, onClose }) {
  const { enqueueSnackbar } = useSnackbar();
  const [showRaw, setShowRaw] = useState(false);

  const copy = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      enqueueSnackbar(`${label} copied`, { variant: 'success' });
    } catch {
      enqueueSnackbar('Could not copy — the clipboard needs a secure context.', {
        variant: 'warning',
      });
    }
  };

  const hasPayload = Boolean(entry.before || entry.after);

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{ paper: { sx: { width: { xs: '100%', md: 640 } } } }}
    >
      <Box sx={{ p: 2.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <ToneChip tone={actionTone(entry.action)} label={humanizeEnum(entry.action)} />
              {!entry.success && <ToneChip tone="error" label="Failed" />}
            </Stack>

            <Typography variant="body2" sx={{ pr: 2 }}>
              {entry.summary || 'No summary recorded.'}
            </Typography>

            <Typography variant="caption" color="text.secondary">
              {formatDateTime(entry.createdAt)} · {formatRelative(entry.createdAt)}
            </Typography>
          </Box>

          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Stack spacing={2}>
          <Box>
            <Typography variant="overline" color="text.secondary">
              Actor
            </Typography>

            <Box sx={{ mt: 1 }}>
              {entry.actor ? (
                <UserCell user={entry.actor} secondary={entry.actorEmail} />
              ) : (
                <Typography variant="body2" color="text.secondary">
                  System {entry.actorEmail ? `(${entry.actorEmail})` : '— no signed-in user'}
                </Typography>
              )}
            </Box>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 1.5,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            <Field label="Role" value={entry.actorRole ? humanizeEnum(entry.actorRole) : null} />
            <Field label="IP address" value={entry.ip} mono />
            <Field label="Entity" value={entry.entityType} />
            <Field label="Entity ID" value={entry.entityId} mono />
          </Box>

          <Field label="User agent" value={entry.userAgent} wrap />

          <Box>
            <Typography variant="overline" color="text.secondary">
              Correlation ID
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography
                variant="body2"
                sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}
              >
                {entry.correlationId || '—'}
              </Typography>
              {entry.correlationId && (
                <Tooltip title="Copy correlation ID">
                  <IconButton
                    size="small"
                    onClick={() => copy(entry.correlationId, 'Correlation ID')}
                    aria-label="Copy correlation ID"
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
            <Typography variant="caption" color="text.disabled">
              Ties this event to every server log line from the same request.
            </Typography>
          </Box>

          <Divider />

          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="overline" color="text.secondary">
                What changed
              </Typography>

              {hasPayload && (
                <Link
                  component="button"
                  type="button"
                  variant="caption"
                  underline="hover"
                  onClick={() => setShowRaw((value) => !value)}
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                >
                  <CodeIcon sx={{ fontSize: 14 }} />
                  {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
                </Link>
              )}
            </Stack>

            <DiffView before={entry.before} after={entry.after} />

            <Collapse in={showRaw} unmountOnExit>
              <Box
                sx={{
                  mt: 1.5,
                  display: 'grid',
                  gap: 1.5,
                  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                }}
              >
                <RawJson title="before" value={entry.before} />
                <RawJson title="after" value={entry.after} />
              </Box>
            </Collapse>
          </Box>
        </Stack>
      </Box>
    </Drawer>
  );
}

function Field({ label, value, mono = false, wrap = false }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="overline" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography
        variant="body2"
        color={value ? 'text.primary' : 'text.disabled'}
        sx={{
          fontFamily: mono ? 'monospace' : undefined,
          wordBreak: wrap ? 'break-word' : undefined,
          overflowWrap: 'anywhere',
        }}
      >
        {value || '—'}
      </Typography>
    </Box>
  );
}

/**
 * The point of the audit log.
 *
 * `before` and `after` already contain only the CHANGED keys for update events
 * (audit.service.js `diff()` strips the rest), but creation events carry only
 * `after` and some events carry unrelated keys in each — so the union is taken
 * and each key compared, rather than trusting the payload to be pre-diffed.
 */
function DiffView({ before, after }) {
  const theme = useTheme();

  const rows = useMemo(() => {
    const beforeObject = isPlainObject(before) ? before : {};
    const afterObject = isPlainObject(after) ? after : {};
    const keys = [...new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)])].sort();

    return keys.map((key) => {
      const oldValue = beforeObject[key];
      const newValue = afterObject[key];

      return {
        key,
        oldValue,
        newValue,
        changed: JSON.stringify(oldValue ?? null) !== JSON.stringify(newValue ?? null),
      };
    });
  }, [before, after]);

  if (rows.length === 0) {
    return (
      <EmptyState
        dense
        icon={CodeIcon}
        title="No field-level changes recorded"
        message="This event has no before/after payload — sign-ins, exports and reads record the act, not a mutation."
        sx={{ py: 3 }}
      />
    );
  }

  const removed = toneHex('error', theme);
  const added = toneHex('success', theme);

  return (
    <Box
      sx={{
        mt: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(90px, 0.8fr) minmax(0, 1fr) minmax(0, 1fr)',
          gap: 1,
          px: 1.5,
          py: 0.75,
          bgcolor: 'action.hover',
        }}
      >
        <Typography variant="overline" color="text.secondary">
          Field
        </Typography>
        <Typography variant="overline" color="text.secondary">
          Before
        </Typography>
        <Typography variant="overline" color="text.secondary">
          After
        </Typography>
      </Box>

      {rows.map((row) => (
        <Box
          key={row.key}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(90px, 0.8fr) minmax(0, 1fr) minmax(0, 1fr)',
            gap: 1,
            px: 1.5,
            py: 1,
            borderTop: 1,
            borderColor: 'divider',
            // Unchanged keys stay visually quiet; the changed ones are the story.
            bgcolor: row.changed ? alpha(theme.palette.warning.main, 0.05) : 'transparent',
          }}
        >
          <Typography variant="body2" fontWeight={row.changed ? 600 : 400} sx={{ overflowWrap: 'anywhere' }}>
            {row.key}
          </Typography>

          <DiffValue
            value={row.oldValue}
            color={row.changed ? removed : undefined}
            strike={row.changed && row.oldValue !== undefined}
          />

          <DiffValue value={row.newValue} color={row.changed ? added : undefined} />
        </Box>
      ))}
    </Box>
  );
}

function DiffValue({ value, color, strike = false }) {
  const empty = value === undefined || value === null || value === '';

  return (
    <Typography
      variant="body2"
      sx={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.75rem',
        color: empty ? 'text.disabled' : (color ?? 'text.primary'),
        textDecoration: strike && !empty ? 'line-through' : 'none',
        overflowWrap: 'anywhere',
        whiteSpace: 'pre-wrap',
      }}
    >
      {empty ? '—' : formatValue(value)}
    </Typography>
  );
}

function RawJson({ title, value }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" display="block">
        {title}
      </Typography>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1.25,
          borderRadius: 1.5,
          border: 1,
          borderColor: 'divider',
          bgcolor: 'action.hover',
          fontSize: '0.7rem',
          lineHeight: 1.5,
          overflowX: 'auto',
          maxHeight: 280,
        }}
      >
        {value ? JSON.stringify(value, null, 2) : 'null'}
      </Box>
    </Box>
  );
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatValue = (value) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(value, null, 2);
};
