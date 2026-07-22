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
import Tab from '@mui/material/Tab';
import TablePagination from '@mui/material/TablePagination';
import Tabs from '@mui/material/Tabs';
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
import {
  ai as aiApi,
  departments as departmentsApi,
  projects as projectsApi,
  users as usersApi,
} from '../../api/endpoints.js';
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

/**
 * The on-demand efficiency review.
 *
 * Deliberately a button rather than a schedule. A cron job quietly building a
 * case file about somebody every night is a different product from a manager
 * choosing to ask a question, and the second is the one worth having — it puts a
 * person's name against the decision to look, and it makes the cost visible.
 *
 * Nobody is notified by a review. The result appears here, for the person who
 * asked. An employee receiving "you have been reviewed" would learn only that
 * they are under suspicion, which helps nobody.
 */
function ReviewRunner({ disabled, onDone }) {
  const { enqueueSnackbar } = useSnackbar();
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [userId, setUserId] = useState('');
  const [days, setDays] = useState(10);
  const [summary, setSummary] = useState(null);

  const departmentsQuery = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.list().then((res) => res.data),
    staleTime: 10 * 60 * 1000,
  });
  const departments = (departmentsQuery.data ?? []).filter((d) => d.isActive);

  /**
   * Both lists hang off the chosen department and are not fetched until there is
   * one — an unfiltered project list would offer projects that the review would
   * then reject as belonging elsewhere.
   */
  const projectsQuery = useQuery({
    queryKey: ['projects', 'options', departmentId],
    queryFn: () => projectsApi.options({ departmentId }).then((res) => res.data),
    enabled: Boolean(departmentId),
    staleTime: 5 * 60 * 1000,
  });
  const peopleQuery = useQuery({
    queryKey: ['users', 'options', departmentId],
    queryFn: () => usersApi.options({ departmentId }).then((res) => res.data),
    enabled: Boolean(departmentId),
    staleTime: 5 * 60 * 1000,
  });

  const projects = projectsQuery.data ?? [];
  // Management accounts do not log hours, so offering them here would only
  // produce a review with nothing in it.
  const people = (peopleQuery.data ?? []).filter((u) => u.role !== 'MANAGEMENT');

  // A project or a person from the previous department is a wrong answer, not a
  // stale one — clear both the moment the department changes.
  const changeDepartment = (id) => {
    setDepartmentId(id);
    setProjectId('');
    setUserId('');
  };

  const reviewMutation = useMutation({
    mutationFn: () =>
      aiApi.review({ departmentId, days: Number(days), projectId: projectId || undefined, userId: userId || undefined }),
    onSuccess: (res) => {
      setSummary(res.data);
      onDone?.();
      enqueueSnackbar(res.message ?? 'Review complete', { variant: 'success', autoHideDuration: 8000 });
    },
    onError: (error) => enqueueSnackbar(errorMessage(error), { variant: 'error' }),
  });

  const selected = departments.find((d) => d.id === departmentId);
  const optedOut = selected && selected.aiAnalysisEnabled === false;

  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2">Run an efficiency review</Typography>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.5 }}>
        Reads every active person in one department across a whole period at once — their daily log,
        their assignments, and whether the modules that work belongs to have actually moved. This is
        what finds the things a two-hour window cannot: the same task described three different ways
        over a fortnight. Nobody is notified; the results appear below. Narrow it to one project or
        one person if you have a specific question — leave both alone for the whole department.
      </Typography>

      <Stack
        direction="row"
        spacing={2}
        rowGap={2}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <SelectFilter
          label="Department"
          value={departmentId}
          onChange={changeDepartment}
          options={departments.map((d) => ({ value: d.id, label: d.name }))}
          allLabel="Choose a department"
          width={230}
        />
        {/*
          Optional, and they say so on their faces: "All projects" and "Everyone"
          are the values they hold until somebody deliberately changes them.
        */}
        <SelectFilter
          label="Project (optional)"
          value={projectId}
          onChange={setProjectId}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          allLabel="All projects"
          width={210}
          disabled={!departmentId}
        />
        <SelectFilter
          label="Employee (optional)"
          value={userId}
          onChange={setUserId}
          options={people.map((u) => ({ value: u.id, label: u.fullName }))}
          allLabel="Everyone"
          width={210}
          disabled={!departmentId}
        />
        <SelectFilter
          label="Period"
          value={days}
          onChange={setDays}
          options={[7, 10, 14, 30].map((d) => ({ value: d, label: `Last ${d} days` }))}
          width={160}
        />
        <Button
          variant="contained"
          startIcon={<AutoAwesomeIcon />}
          disabled={!departmentId || optedOut || disabled || reviewMutation.isPending}
          onClick={() => reviewMutation.mutate()}
        >
          {reviewMutation.isPending ? 'Reviewing…' : 'Run AI detection'}
        </Button>
      </Stack>

      {reviewMutation.isPending && <LinearProgress sx={{ mt: 1.5 }} />}

      {optedOut && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {selected.name} has AI analysis switched off, so nothing from it can be sent — on a
          schedule or on request. Turn it on under Administration → Departments first.
        </Alert>
      )}

      {summary && (
        <Alert severity="info" sx={{ mt: 1.5 }} onClose={() => setSummary(null)}>
          {summary.department}
          {/*
            The narrowing is repeated back deliberately. "0 flagged" means one
            thing about a department and quite another about a single project
            inside it, and the reader must not have to remember which they asked.
          */}
          {summary.scope?.project && ` · ${summary.scope.project}`}
          {summary.scope?.employee && ` · ${summary.scope.employee}`}: {summary.assessed} assessed
          over {summary.workingDays} working days ({summary.from} → {summary.to}).{' '}
          <strong>{summary.flagged} flagged.</strong>
          {summary.failed > 0 && ` ${summary.failed} could not be assessed.`}
          {summary.assessed === 0 &&
            ' Nobody matched — check that the project has people on it, or widen the review.'}
        </Alert>
      )}
    </Paper>
  );
}

export default function InsightsPage() {
  const queryClient = useQueryClient();
  const { enqueueSnackbar } = useSnackbar();

  /**
   * Two feeds, never mixed. "Live" is the scheduled analyser saying today is
   * going wrong; "Reviews" is a manager having deliberately asked whether
   * somebody has moved in a fortnight. Reading them as one list would let a
   * two-week judgement pass for something that happened this afternoon.
   */
  const [mode, setMode] = useState('live');
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
      isReview: mode === 'review' || undefined,
    }),
    [page, pageSize, severity, kind, unacknowledged, includeOnTrack, mode],
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
      <Tabs
        value={mode}
        onChange={(_e, value) => {
          setMode(value);
          setPage(1);
        }}
        sx={{ mb: 2 }}
      >
        <Tab value="live" label="Live findings" />
        <Tab value="review" label="Period reviews" />
      </Tabs>
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

      {/* "Nothing flagged for Video Editing" means one of two very different
          things: the analyser looked and found nothing, or it was never allowed
          to look. A manager acts differently on each, so name the departments. */}
      {status?.departmentsOptedOut?.length > 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Not analysed:{' '}
          <strong>{status.departmentsOptedOut.map((d) => d.name).join(', ')}</strong>. Nothing from{' '}
          {status.departmentsOptedOut.length === 1 ? 'this department' : 'these departments'} is sent
          to the AI, so they will never appear below. Change this per department under
          Administration → Departments.
        </Alert>
      )}

      {mode === 'review' && (
        <Guard permission={PERMISSIONS.SETTINGS_MANAGE}>
          <ReviewRunner
            disabled={notConfigured}
            onDone={() => queryClient.invalidateQueries({ queryKey: ['ai', 'insights'] })}
          />
        </Guard>
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
