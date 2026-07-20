/**
 * AI INSIGHTS — what the two-hourly analyser found.
 *
 * Every two hours the analyser compares what each person was ASSIGNED against
 * the hours they LOGGED, and writes down what it thinks. This screen is where a
 * Tech Lead or Management reads those findings and closes them out.
 *
 * TWO THINGS THIS SCREEN IS DELIBERATE ABOUT:
 *
 * 1. THE EMPLOYEE NEVER SEES IT. The route and the nav item both require
 *    DASHBOARD_TEAM, which Tech Leads and Management hold and employees do not.
 *    An employee is notified that their entries need another look; they never
 *    read the assessment, its score or its reasoning. (The API enforces this
 *    independently — the gate here is courtesy, not security.)
 *
 * 2. EVERY FINDING IS AUDITABLE AGAINST ITS INPUTS. Expanding a row shows the
 *    exact evidence the model was handed. A judgement about somebody's afternoon
 *    that cannot be checked against what the model actually saw is an accusation,
 *    not a finding — so the evidence ships with it rather than living in a log.
 *
 * Scope is the server's job: a lead gets their own department's findings, and
 * there is no `if (role === …)` anywhere in this file.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSnackbar } from 'notistack';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TablePagination from '@mui/material/TablePagination';
import Typography from '@mui/material/Typography';

import AutoAwesomeIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CheckIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import ExpandMoreIcon from '@mui/icons-material/ExpandMoreRounded';
import PlayIcon from '@mui/icons-material/PlayArrowRounded';

import PageHeader from '../../components/common/PageHeader.jsx';
import EmptyState from '../../components/common/EmptyState.jsx';
import Guard from '../../components/common/Guard.jsx';
import FilterBar, { SelectFilter } from '../admin/components/FilterBar.jsx';
import ToneChip from '../admin/components/ToneChip.jsx';
import { INSIGHT_KIND_TONE, INSIGHT_SEVERITY_TONE } from '../admin/components/tones.js';
import { errorMessage } from '../admin/components/apiError.js';
import { ai as aiApi } from '../../api/endpoints.js';
import {
  DEFAULT_PAGE_SIZE,
  INSIGHT_KIND,
  INSIGHT_KINDS,
  INSIGHT_SEVERITY,
  INSIGHT_SEVERITIES,
  PAGE_SIZE_OPTIONS,
  PERMISSIONS,
} from '../../utils/constants.js';
import { formatDateTime, formatRelative } from '../../utils/format.js';

export default function InsightsPage() {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  const [severity, setSeverity] = useState('');
  const [kind, setKind] = useState('');
  const [unacknowledged, setUnacknowledged] = useState(false);
  const [includeOnTrack, setIncludeOnTrack] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const params = useMemo(
    () => ({
      page,
      pageSize,
      severity: severity || undefined,
      kind: kind || undefined,
      // Only ever sent as `true` — `unacknowledged=false` would ask the API for
      // the acknowledged ones, which is not what an unticked box means.
      unacknowledged: unacknowledged || undefined,
      includeOnTrack: includeOnTrack || undefined,
    }),
    [page, pageSize, severity, kind, unacknowledged, includeOnTrack],
  );

  const statusQuery = useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => aiApi.status().then((res) => res.data),
    staleTime: 10 * 60 * 1000,
  });

  const insightsQuery = useQuery({
    queryKey: ['ai', 'insights', params],
    queryFn: () => aiApi.insights(params),
    placeholderData: (previous) => previous,
  });

  const status = statusQuery.data;
  const items = insightsQuery.data?.data ?? [];
  const total = insightsQuery.data?.meta?.pagination?.total ?? 0;

  const hasFilters = Boolean(severity || kind || unacknowledged || includeOnTrack);

  const resetFilters = () => {
    setSeverity('');
    setKind('');
    setUnacknowledged(false);
    setIncludeOnTrack(false);
    setPage(1);
  };

  const withPageReset = (setter) => (value) => {
    setter(value);
    setPage(1);
  };

  const analyseMutation = useMutation({
    mutationFn: () => aiApi.analyse(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'insights'] });
      enqueueSnackbar(res.data?.summary ?? 'Analysis finished', {
        variant: 'success',
        autoHideDuration: 8000,
      });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const notConfigured = status && !status.configured;

  return (
    <Box>
      <PageHeader
        title="AI Insights"
        subtitle="Every two hours the analyser reads what each person was assigned and what they actually logged, and writes down anything that does not line up. Findings are for you to act on — the employee never sees them."
        breadcrumbs={[{ label: 'Oversight' }, { label: 'AI Insights' }]}
        actions={
          <Guard permission={PERMISSIONS.SETTINGS_MANAGE}>
            <Button
              variant="contained"
              startIcon={<PlayIcon />}
              disabled={analyseMutation.isPending || notConfigured}
              onClick={() => analyseMutation.mutate()}
            >
              {analyseMutation.isPending ? 'Analysing…' : 'Run analysis now'}
            </Button>
          </Guard>
        }
      />

      {notConfigured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          AI analysis is not configured. Add <code>GEMINI_API_KEY</code> to{' '}
          <code>backend/.env</code> to enable it.
          {status.model && (
            <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
              Configured model: {status.model}
              {status.windowHours ? ` · ${status.windowHours}-hour window` : ''}
            </Typography>
          )}
        </Alert>
      )}

      {/* Configured but switched off is a different problem from never set up,
          and the fix is a different line in a different file. Say which. */}
      {status?.configured && !status.enabled && (
        <Alert severity="info" sx={{ mb: 2 }}>
          AI analysis is configured ({status.model}) but currently disabled, so no new findings are
          being recorded.
        </Alert>
      )}

      <FilterBar onReset={resetFilters} canReset={hasFilters}>
        <SelectFilter
          label="Severity"
          value={severity}
          onChange={withPageReset(setSeverity)}
          options={INSIGHT_SEVERITIES}
          allLabel="Any severity"
          width={170}
        />
        <SelectFilter
          label="Finding"
          value={kind}
          onChange={withPageReset(setKind)}
          options={INSIGHT_KINDS}
          allLabel="All findings"
          width={180}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={unacknowledged}
              onChange={(event) => withPageReset(setUnacknowledged)(event.target.checked)}
            />
          }
          label={<Typography variant="body2">Unacknowledged only</Typography>}
        />
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={includeOnTrack}
              onChange={(event) => withPageReset(setIncludeOnTrack)(event.target.checked)}
            />
          }
          label={<Typography variant="body2">Show on-track too</Typography>}
        />
      </FilterBar>

      {insightsQuery.isFetching && <LinearProgress sx={{ mb: 1 }} />}

      {insightsQuery.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorMessage(insightsQuery.error, 'Could not load findings.')}
        </Alert>
      )}

      {!insightsQuery.isLoading && items.length === 0 && !insightsQuery.isError && (
        <Paper sx={{ py: 1 }}>
          <EmptyState
            icon={AutoAwesomeIcon}
            title="Nothing flagged"
            message={
              hasFilters
                ? 'No finding matches these filters.'
                : 'No findings — the analyser has not flagged anything.'
            }
          />
        </Paper>
      )}

      <Stack spacing={1.5}>
        {items.map((insight) => (
          <InsightCard key={insight.id} insight={insight} />
        ))}
      </Stack>

      {total > 0 && (
        <TablePagination
          component="div"
          count={total}
          page={Math.max(0, page - 1)}
          rowsPerPage={pageSize}
          rowsPerPageOptions={PAGE_SIZE_OPTIONS}
          onPageChange={(_event, nextPage) => setPage(nextPage + 1)}
          onRowsPerPageChange={(event) => {
            setPageSize(parseInt(event.target.value, 10));
            setPage(1);
          }}
          labelRowsPerPage="Rows:"
        />
      )}
    </Box>
  );
}

/* ------------------------------------------------------------------ *
 * One finding
 * ------------------------------------------------------------------ */

function InsightCard({ insight }) {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();
  const [expanded, setExpanded] = useState(false);

  const acknowledgeMutation = useMutation({
    mutationFn: () => aiApi.acknowledge(insight.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'insights'] });
      enqueueSnackbar('Finding acknowledged', { variant: 'success' });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const acknowledged = Boolean(insight.acknowledgedAt);

  return (
    <Paper sx={{ p: 2 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        alignItems={{ sm: 'flex-start' }}
        justifyContent="space-between"
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="subtitle2">{insight.userName}</Typography>

            {insight.department && (
              <Chip
                size="small"
                variant="outlined"
                label={insight.department.name}
                sx={{
                  height: 20,
                  fontSize: 11,
                  ...(insight.department.colorHex && {
                    color: insight.department.colorHex,
                    borderColor: `${insight.department.colorHex}66`,
                  }),
                }}
              />
            )}

            <ToneChip
              tone={INSIGHT_KIND_TONE[insight.kind]}
              label={INSIGHT_KIND[insight.kind] ?? insight.kind}
            />
            <ToneChip
              tone={INSIGHT_SEVERITY_TONE[insight.severity]}
              variant="outlined"
              label={INSIGHT_SEVERITY[insight.severity] ?? insight.severity}
            />

            {Number.isFinite(insight.alignmentScore) && (
              <Chip
                size="small"
                variant="outlined"
                label={`Alignment ${insight.alignmentScore}%`}
                sx={{ height: 20, fontSize: 11 }}
              />
            )}
          </Stack>

          <Typography variant="body2" sx={{ mt: 1 }}>
            {insight.finding}
          </Typography>

          {insight.recommendation && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {insight.recommendation}
            </Typography>
          )}

          {insight.assignment && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
              Assignment: {insight.assignment.title}
              {insight.assignment.project ? ` · ${insight.assignment.project}` : ''}
            </Typography>
          )}

          <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5 }}>
            {formatDateTime(insight.windowStart)} → {formatDateTime(insight.windowEnd)} · recorded{' '}
            {formatRelative(insight.createdAt)}
            {insight.model ? ` · ${insight.model}` : ''}
          </Typography>
        </Box>

        <Stack spacing={0.5} alignItems={{ xs: 'flex-start', sm: 'flex-end' }} sx={{ flexShrink: 0 }}>
          {acknowledged ? (
            <Stack direction="row" spacing={0.5} alignItems="center" color="success.main">
              <CheckIcon fontSize="small" />
              <Typography variant="caption" color="text.secondary">
                Acknowledged by {insight.acknowledgedBy ?? 'a lead'}
              </Typography>
            </Stack>
          ) : (
            <Button
              size="small"
              variant="outlined"
              disabled={acknowledgeMutation.isPending}
              onClick={() => acknowledgeMutation.mutate()}
            >
              Acknowledge
            </Button>
          )}

          <Button
            size="small"
            color="inherit"
            endIcon={
              <ExpandMoreIcon
                fontSize="small"
                sx={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: '0.2s' }}
              />
            }
            onClick={() => setExpanded((open) => !open)}
          >
            Evidence
          </Button>
        </Stack>
      </Stack>

      <Collapse in={expanded} unmountOnExit>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1.5 }}>
          Exactly what the model was shown. A finding that cannot be checked against its inputs is
          not a finding.
        </Typography>
        <Box
          component="pre"
          sx={{
            mt: 0.5,
            p: 1.5,
            m: 0,
            maxHeight: 360,
            overflow: 'auto',
            borderRadius: 1.5,
            bgcolor: 'action.hover',
            fontSize: 11.5,
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {JSON.stringify(insight.evidence ?? {}, null, 2)}
        </Box>
      </Collapse>
    </Paper>
  );
}
