/**
 * ONE HOUR OF THE DAY.
 *
 * It asks two questions — WHAT DID YOU COMPLETE, and WHAT FOR — and then it gets
 * out of the way.
 *
 * WHY IT IS A CARD THAT OPENS, NOT A FORM THAT IS ALWAYS OPEN
 * A saved hour renders as one readable line. Seven live forms stacked down a
 * page is a wall; seven lines of "10:00–11:00 · Payments · Reconciliation service
 * and its tests" is a timesheet you can actually read back at the end of the
 * week — which is the only reason anyone would ever want to keep one.
 *
 * Click it and it opens for editing. Save and it closes again. An hour is never
 * locked by having been saved: you can log the 10am slot at 5pm, then change it
 * at 5:30 when you remember what you actually did.
 *
 * WHAT IS NOT HERE, AND WHY
 * No Status, no Priority, no Module, no Work Type. An employee writes an hour up
 * AFTER living it, so every entry is completed work by definition — a status
 * dropdown could only ever hold one true value, and a field with one true value
 * does not collect information, it collects clicks. Priority on an hour that has
 * already happened is a question with no meaning at all.
 *
 * The department's own optional fields still render IF an admin has defined any.
 * None are seeded. The form is empty by default, on purpose.
 *
 * AUTO-SAVE
 * Still here, as a safety net, debounced. It is a DRAFT: it will happily update
 * an hour that already has a project, but it will never create one without a
 * project — the server refuses, and the cell stays honestly "unsaved" rather than
 * writing a row that no project report would ever be able to see.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Box,
  TextField,
  Typography,
  Collapse,
  IconButton,
  MenuItem,
  Chip,
  Tooltip,
  Stack,
  Alert,
  Button,
  CircularProgress,
  Divider,
  ButtonBase,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/HistoryOutlined';
import AssignmentIcon from '@mui/icons-material/AssignmentTurnedInOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import SyncIcon from '@mui/icons-material/Sync';
import ScheduleIcon from '@mui/icons-material/ScheduleOutlined';
import EditIcon from '@mui/icons-material/EditOutlined';
import AddIcon from '@mui/icons-material/Add';
import NotesIcon from '@mui/icons-material/NotesOutlined';
import CloseIcon from '@mui/icons-material/Close';
import { useDebouncedCallback } from '../../hooks/useDebounce.js';
import DynamicField from './DynamicField.jsx';
import { TASK_DESCRIPTION_MAX, TASK_REMARKS_MAX } from '../../utils/constants.js';
import { formatDateTime } from '../../utils/format.js';

const AUTOSAVE_DELAY_MS = 1200;

const SAVE_STATE = {
  IDLE: 'IDLE',
  DIRTY: 'DIRTY',
  SAVING: 'SAVING',
  SAVED: 'SAVED',
  ERROR: 'ERROR',
  CONFLICT: 'CONFLICT',
};

const emptyDraft = () => ({
  description: '',
  projectId: null,
  assignmentId: null,
  unassigned: false,
  remarks: null,
  attributes: {},
  version: undefined,
});

const draftFromEntry = (entry) =>
  entry
    ? {
        description: entry.description ?? '',
        projectId: entry.projectId ?? null,
        assignmentId: entry.assignmentId ?? null,
        // A saved hour with no assignment IS "Other work" — a decision already
        // made, not an unanswered prompt.
        unassigned: !entry.assignmentId,
        remarks: entry.remarks ?? null,
        attributes: entry.attributes ?? {},
        version: entry.version,
      }
    : emptyDraft();

export default function TaskCellEditor({
  cell,
  fieldDefinitions = [],
  projects = [],
  /**
   * The employee's open assigned tasks (ASSIGNED / IN_PROGRESS). When this is
   * non-empty, each hour must name one — or be explicitly "Other work". That is
   * the "required only if assigned" rule; it is derived from this list, so no
   * separate flag is needed.
   */
  assignments = [],
  readOnly = false,
  onSave,
  onViewHistory,
  autoExpand = false,
  /** Set for an empty overtime column: removes the extra hour. Undefined otherwise. */
  onRemoveOvertime,
  removingOvertime = false,
  /**
   * Whether this sheet must name a project. True for an employee; false for a
   * Tech Lead, whose hours span every project and fall to the department's
   * Internal bucket unless they pick one. Driven by the grid's own flag.
   */
  projectRequired = true,
}) {
  const { timeSlot, entry, isCurrentHour, isMissing } = cell;

  const [draft, setDraft] = useState(() => draftFromEntry(entry));
  const [saveState, setSaveState] = useState(SAVE_STATE.IDLE);
  const [errorMessage, setErrorMessage] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [serverCopy, setServerCopy] = useState(null);
  const [showRemarks, setShowRemarks] = useState(Boolean(entry?.remarks));

  /**
   * An hour with no entry has nothing to READ, so it opens straight into edit —
   * otherwise the current hour would greet you with a card you have to click
   * before you can type into it, which is a click that buys nothing.
   */
  const [isEditing, setIsEditing] = useState(() => !entry && (autoExpand || isCurrentHour));

  const committed = useRef(draftFromEntry(entry));

  /**
   * The version WE just wrote.
   *
   * Without this the "Saved" tick is invisible: we save → the parent patches the
   * query cache with the server's response → that flows back down as a new
   * `entry` prop with a bumped version → the effect below sees a version it does
   * not recognise, assumes a foreign edit, and resets state within a frame. The
   * user's work is saved and they are shown nothing, so they start hammering the
   * save button "just in case".
   */
  const ownVersion = useRef(null);

  useEffect(() => {
    const incoming = entry?.version ?? null;
    if (incoming !== null && incoming === ownVersion.current) return; // our own echo

    const next = draftFromEntry(entry);
    committed.current = next;
    setDraft(next);
    setSaveState(SAVE_STATE.IDLE);
    setShowRemarks(Boolean(entry?.remarks));
  }, [entry?.id, entry?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === draft.projectId),
    [projects, draft.projectId],
  );

  const selectedAssignment = useMemo(
    () => assignments.find((a) => a.id === draft.assignmentId),
    [assignments, draft.assignmentId],
  );

  const hasAssignments = assignments.length > 0;
  // The single-select value: an assignment id, the "Other work" sentinel, or ''
  // (nothing chosen yet — only possible for a fresh cell when work is assigned).
  const OTHER = '__OTHER__';
  const assignmentChoice = draft.assignmentId ?? (draft.unassigned ? OTHER : '');

  const chooseAssignment = (value) => {
    if (value === OTHER) {
      update({ assignmentId: null, unassigned: true });
    } else if (value === '') {
      update({ assignmentId: null, unassigned: false });
    } else {
      // Picking a task auto-fills its project — the assignment already knows what
      // it is for, so we mirror the server's auto-fill in the form immediately.
      const a = assignments.find((x) => x.id === value);
      update({ assignmentId: value, unassigned: false, projectId: a?.projectId ?? draft.projectId });
    }
  };

  // When a task is chosen its project is fixed by the task, so we hide the project
  // picker. "Other work" (or no assignments at all) shows it exactly as before.
  const projectPickerVisible = !draft.assignmentId;
  const mustChooseAssignment = hasAssignments && !draft.assignmentId && !draft.unassigned;

  const persist = useCallback(
    async (payload, { isAutoSave }) => {
      setSaveState(SAVE_STATE.SAVING);
      setErrorMessage(null);
      setFieldErrors({});

      try {
        const saved = await onSave({
          timeSlotId: timeSlot.id,
          description: payload.description,
          projectId: payload.projectId,
          assignmentId: payload.assignmentId ?? null,
          unassigned: payload.unassigned ?? false,
          remarks: payload.remarks || null,
          attributes: Object.keys(payload.attributes ?? {}).length ? payload.attributes : null,
          version: payload.version,
          isAutoSave,
        });

        // The server may legitimately decline to write a draft — an autosave with
        // no project yet has nowhere to go, so it is held, not stored. Stay DIRTY:
        // that is the truth, and pretending otherwise would show a "Saved" tick
        // over an hour that does not exist.
        if (saved?.skipped || !saved?.entry) {
          setSaveState(SAVE_STATE.DIRTY);
          return;
        }

        const next = { ...payload, version: saved.entry.version };
        committed.current = next;
        ownVersion.current = saved.entry.version;
        setDraft(next);
        setSaveState(SAVE_STATE.SAVED);
        setServerCopy(null);

        // An explicit save is a full stop. Close the card so the hour reads back
        // as a line of a timesheet instead of a form still demanding attention.
        if (!isAutoSave) setIsEditing(false);
      } catch (error) {
        if (error.code === 'VERSION_CONFLICT') {
          setSaveState(SAVE_STATE.CONFLICT);
          setServerCopy(error.details?.current ?? null);
          setIsEditing(true);
          return;
        }

        if (error.status === 422 && error.details?.issues) {
          const errors = {};
          for (const issue of error.details.issues) {
            errors[issue.path.replace(/^attributes\./, '')] = issue.message;
          }
          setFieldErrors(errors);
          // Mid-keystroke is the wrong moment to shout. A missing project only
          // becomes a hard error when the user actually tries to save.
          setSaveState(isAutoSave ? SAVE_STATE.DIRTY : SAVE_STATE.ERROR);
          setErrorMessage(isAutoSave ? null : error.message);
          if (!isAutoSave) setIsEditing(true);
          return;
        }

        setSaveState(SAVE_STATE.ERROR);
        setErrorMessage(error.message ?? 'Could not save. Check your connection.');
      }
    },
    [onSave, timeSlot.id],
  );

  const autoSave = useDebouncedCallback((payload) => {
    if (!payload.description?.trim()) return; // an empty cell is a no-op, not a save
    persist(payload, { isAutoSave: true });
  }, AUTOSAVE_DELAY_MS);

  const update = (patch) => {
    if (readOnly) return;
    const next = { ...draft, ...patch };
    setDraft(next);
    setSaveState(SAVE_STATE.DIRTY);
    autoSave(next);
  };

  const updateAttribute = (key, value) => {
    if (readOnly) return;
    const attributes = { ...draft.attributes };
    if (value === null || value === '' || value === undefined) delete attributes[key];
    else attributes[key] = value;
    update({ attributes });
  };

  const saveNow = () => {
    autoSave.cancel();
    persist(draft, { isAutoSave: false });
  };

  const cancelEdit = () => {
    autoSave.cancel();
    setDraft(committed.current);
    setFieldErrors({});
    setErrorMessage(null);
    setSaveState(SAVE_STATE.IDLE);
    setIsEditing(false);
  };

  const takeServerCopy = () => {
    const next = draftFromEntry(serverCopy);
    committed.current = next;
    setDraft(next);
    setServerCopy(null);
    setSaveState(SAVE_STATE.IDLE);
  };

  const overwriteWithMine = () =>
    persist({ ...draft, version: serverCopy?.version }, { isAutoSave: false });

  const chars = draft.description.length;
  const overLimit = chars > TASK_DESCRIPTION_MAX;
  // A chosen assignment supplies the project, so the project requirement is met by
  // the task itself. "Other work" falls back to the normal project rule.
  const projectSatisfied = Boolean(draft.assignmentId) || !projectRequired || Boolean(draft.projectId);
  const canSave =
    Boolean(draft.description.trim()) && projectSatisfied && !mustChooseAssignment && !overLimit;

  const borderColour = isCurrentHour
    ? 'primary.main'
    : saveState === SAVE_STATE.CONFLICT
      ? 'warning.main'
      : isMissing && !entry
        ? 'warning.light'
        : 'divider';

  return (
    <Box
      sx={{
        border: 1,
        borderColor: borderColour,
        borderWidth: isCurrentHour ? 2 : 1,
        // Dashed = optional. Same visual language as the "+" that created it.
        borderStyle: timeSlot.isOvertime && !entry ? 'dashed' : 'solid',
        borderRadius: 2,
        bgcolor: 'background.paper',
        overflow: 'hidden',
        transition: 'border-color 140ms',
      }}
    >
      {/* ─── hour header ─────────────────────────────────────────────── */}
      <Box
        sx={{
          px: 1.5,
          py: 0.85,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          bgcolor: isCurrentHour ? 'primary.main' : 'action.hover',
          color: isCurrentHour ? 'primary.contrastText' : 'text.secondary',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <ScheduleIcon sx={{ fontSize: 15 }} />
        <Typography variant="caption" sx={{ fontWeight: 700, letterSpacing: '0.02em', flex: 1 }}>
          {timeSlot.label}
        </Typography>

        {timeSlot.isOvertime && (
          <Chip label="EXTRA" size="small" color="primary" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
        )}
        {entry?.isLate && (
          <Tooltip title="Logged after the hour had passed. Recorded, not penalised.">
            <Chip label="LATE" size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />
          </Tooltip>
        )}
        {entry?.editedByLead && (
          <Tooltip title="Your Tech Lead edited this entry">
            <Chip label="LEAD EDIT" size="small" color="info" sx={{ height: 18, fontSize: 10 }} />
          </Tooltip>
        )}
        {!isCurrentHour && isMissing && !entry && (
          <Chip label="MISSING" size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />
        )}

        <SaveIndicator state={saveState} />

        {/* Undo this extra hour — only shown for an empty overtime column. */}
        {onRemoveOvertime && (
          <Tooltip title="Remove this extra hour">
            <IconButton
              size="small"
              onClick={onRemoveOvertime}
              disabled={removingOvertime}
              aria-label="Remove this extra hour"
              sx={{ color: 'inherit', p: 0.25 }}
            >
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}

        {entry && onViewHistory && (
          <Tooltip title={`History (${entry.revisionCount ?? 0})`}>
            <IconButton size="small" onClick={() => onViewHistory(entry)} sx={{ color: 'inherit', p: 0.25 }}>
              <HistoryIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {saveState === SAVE_STATE.CONFLICT && (
        <Alert
          severity="warning"
          sx={{ borderRadius: 0, py: 0.5 }}
          action={
            <Stack direction="row" spacing={0.5}>
              <Button size="small" onClick={takeServerCopy}>
                Use theirs
              </Button>
              <Button size="small" variant="contained" onClick={overwriteWithMine}>
                Keep mine
              </Button>
            </Stack>
          }
        >
          <Typography variant="caption">
            Someone else saved this hour while you were editing it.
          </Typography>
        </Alert>
      )}

      {/* ─── READ VIEW — a saved hour, at a glance ───────────────────── */}
      {entry && !isEditing && (
        <ButtonBase
          onClick={() => !readOnly && setIsEditing(true)}
          disabled={readOnly}
          sx={{
            width: '100%',
            display: 'block',
            textAlign: 'left',
            p: 1.5,
            '&:hover .edit-hint': { opacity: 1 },
            '&:hover': { bgcolor: readOnly ? undefined : 'action.hover' },
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          <Stack direction="row" alignItems="flex-start" spacing={1}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="body2"
                sx={{ color: 'text.primary', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
              >
                {entry.description}
              </Typography>

              <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 1, flexWrap: 'wrap', gap: 0.5 }}>
                {entry.assignment && (
                  <Chip
                    size="small"
                    icon={<AssignmentIcon sx={{ fontSize: 13 }} />}
                    label={entry.assignment.title}
                    title={`Assigned task: ${entry.assignment.title}`}
                    color="secondary"
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11, fontWeight: 600, maxWidth: 220, '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' } }}
                  />
                )}
                {entry.project && (
                  <Chip
                    size="small"
                    label={entry.project.code}
                    title={entry.project.name}
                    color={entry.project.isInternal ? 'default' : 'primary'}
                    variant={entry.project.isInternal ? 'outlined' : 'filled'}
                    sx={{ height: 20, fontSize: 11, fontWeight: 600 }}
                  />
                )}
                {entry.remarks && (
                  <Tooltip title={entry.remarks}>
                    <NotesIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                  </Tooltip>
                )}
              </Stack>
            </Box>

            {!readOnly && (
              <EditIcon
                className="edit-hint"
                sx={{ fontSize: 16, color: 'text.disabled', opacity: 0, transition: 'opacity 120ms' }}
              />
            )}
          </Stack>
        </ButtonBase>
      )}

      {/* ─── EMPTY — nothing logged yet ──────────────────────────────── */}
      {!entry && !isEditing && (
        <ButtonBase
          onClick={() => !readOnly && setIsEditing(true)}
          disabled={readOnly}
          sx={{
            width: '100%',
            justifyContent: 'flex-start',
            gap: 1,
            p: 1.75,
            color: 'text.disabled',
            '&:hover': { bgcolor: readOnly ? undefined : 'action.hover', color: 'primary.main' },
          }}
        >
          <AddIcon sx={{ fontSize: 17 }} />
          <Typography variant="body2">What did you complete this hour?</Typography>
        </ButtonBase>
      )}

      {/* ─── EDIT VIEW ───────────────────────────────────────────────── */}
      <Collapse in={isEditing} unmountOnExit>
        <Box sx={{ p: 1.5 }}>
          <TextField
            fullWidth
            multiline
            minRows={3}
            maxRows={8}
            autoFocus
            size="small"
            placeholder="What did you complete this hour?"
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            disabled={readOnly || saveState === SAVE_STATE.SAVING}
            error={overLimit || Boolean(fieldErrors.description)}
            helperText={fieldErrors.description}
          />

          <Typography
            variant="caption"
            sx={{ display: 'block', textAlign: 'right', mt: 0.25, color: overLimit ? 'warning.main' : 'text.disabled' }}
          >
            {chars}/{TASK_DESCRIPTION_MAX}
          </Typography>

          {/* WHICH ASSIGNED TASK THIS HOUR WAS FOR. Shown only when the employee
              actually has open assigned work. Picking one ties this hour into the
              task's progress thread and fills its project automatically; "Other
              work" logs an ad-hoc hour exactly as before. Required to pick one or
              the other — that is the "required only if assigned" rule. */}
          {hasAssignments && (
            <TextField
              select
              fullWidth
              required
              size="small"
              label="Which task?"
              sx={{ mt: 1.5 }}
              value={assignmentChoice}
              onChange={(e) => chooseAssignment(e.target.value)}
              disabled={readOnly || saveState === SAVE_STATE.SAVING}
              error={mustChooseAssignment && saveState === SAVE_STATE.ERROR}
              helperText={
                selectedAssignment
                  ? 'This hour counts toward the task above — its project fills in automatically.'
                  : draft.unassigned
                    ? 'Ad-hoc work, not tied to an assigned task. Pick the project below.'
                    : 'Pick the assigned task this hour advanced, or choose “Other work”.'
              }
            >
              {assignments.map((a) => (
                <MenuItem key={a.id} value={a.id}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
                    <AssignmentIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {a.title}
                    </Typography>
                    {a.isOverdue && (
                      <Chip label="OVERDUE" size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />
                    )}
                    {a.priority && a.priority !== 'NORMAL' && (
                      <Chip label={a.priority} size="small" variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                    )}
                  </Stack>
                </MenuItem>
              ))}
              <Divider />
              <MenuItem value={OTHER}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Other work (not an assigned task)
                </Typography>
              </MenuItem>
            </TextField>
          )}

          {/* THE ONLY OTHER FIELD — and only for an employee. Project is what
              turns an hour into something a manager can roll up by person, by
              project, by department. A Tech Lead spans every project, so asking
              them to pick one would only produce an arbitrary answer; their sheet
              omits it entirely and the hour files under the department's Internal
              bucket. Leads may still pick a project when a specific one applies.
              Hidden entirely when a task is chosen — the task fixes the project. */}
          {projectPickerVisible && (projectRequired ? (
            <TextField
              select
              fullWidth
              required
              size="small"
              label="Project"
              sx={{ mt: 1.5 }}
              value={draft.projectId ?? ''}
              onChange={(e) => update({ projectId: e.target.value || null })}
              disabled={readOnly || saveState === SAVE_STATE.SAVING}
              error={Boolean(fieldErrors.projectId)}
              helperText={
                fieldErrors.projectId ??
                (selectedProject?.isInternal
                  ? 'Meetings, admin, training — work that belongs to no project.'
                  : undefined)
              }
            >
              {projects.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 62 }}>
                      {p.code}
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1 }}>
                      {p.name}
                    </Typography>
                  </Stack>
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <TextField
              select
              fullWidth
              size="small"
              label="Project (optional)"
              sx={{ mt: 1.5 }}
              value={draft.projectId ?? ''}
              onChange={(e) => update({ projectId: e.target.value || null })}
              disabled={readOnly || saveState === SAVE_STATE.SAVING}
              helperText="Leave blank — your hours span every project. Pick one only if this hour was for a specific project."
            >
              <MenuItem value="">
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No specific project
                </Typography>
              </MenuItem>
              {projects
                .filter((p) => !p.isInternal)
                .map((p) => (
                  <MenuItem key={p.id} value={p.id}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                      <Typography variant="body2" sx={{ fontWeight: 600, minWidth: 62 }}>
                        {p.code}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary', flex: 1 }}>
                        {p.name}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
            </TextField>
          ))}

          {/* When a task is chosen, show its project as a read-only chip so the
              hour never looks project-less — the server files it under the task's
              project. */}
          {selectedAssignment && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5, color: 'text.secondary' }}>
              <AssignmentIcon sx={{ fontSize: 16 }} />
              <Typography variant="caption">
                Logged against <strong>{selectedAssignment.title}</strong>
                {selectedAssignment.project ? ` · ${selectedAssignment.project.code}` : ''}
              </Typography>
            </Stack>
          )}

          {/* Optional. Hidden behind a link, because a field that is usually
              empty should not occupy space that is always there. */}
          {showRemarks ? (
            <TextField
              fullWidth
              multiline
              minRows={2}
              size="small"
              label="Remarks (optional)"
              sx={{ mt: 1.5 }}
              value={draft.remarks ?? ''}
              onChange={(e) => update({ remarks: e.target.value })}
              disabled={readOnly || saveState === SAVE_STATE.SAVING}
              inputProps={{ maxLength: TASK_REMARKS_MAX }}
            />
          ) : (
            !readOnly && (
              <Button
                size="small"
                startIcon={<NotesIcon sx={{ fontSize: 15 }} />}
                onClick={() => setShowRemarks(true)}
                sx={{ mt: 1, textTransform: 'none', color: 'text.secondary' }}
              >
                Add a note
              </Button>
            )
          )}

          {/* Department-specific fields — rendered ONLY if an admin defined any.
              Nothing is seeded, so for every department out of the box this
              renders nothing at all, and the form stays two questions long. */}
          {fieldDefinitions.length > 0 && (
            <>
              <Divider sx={{ my: 1.75 }}>
                <Typography variant="caption" sx={{ color: 'text.disabled', letterSpacing: '0.06em' }}>
                  {fieldDefinitions.length === 1 ? 'ONE MORE THING' : 'A FEW MORE THINGS'}
                </Typography>
              </Divider>
              <Stack spacing={1.5}>
                {fieldDefinitions.map((field) => (
                  <DynamicField
                    key={field.key}
                    field={field}
                    value={draft.attributes?.[field.key]}
                    onChange={(value) => updateAttribute(field.key, value)}
                    error={fieldErrors[field.key]}
                    disabled={readOnly || saveState === SAVE_STATE.SAVING}
                  />
                ))}
              </Stack>
            </>
          )}

          {errorMessage && (
            <Alert severity="warning" sx={{ mt: 1.5, py: 0.25 }}>
              <Typography variant="caption">{errorMessage}</Typography>
            </Alert>
          )}

          {entry && (
            <Typography variant="caption" sx={{ display: 'block', mt: 1.5, color: 'text.disabled' }}>
              Last saved {formatDateTime(entry.updatedAt)}
              {entry.updatedBy ? ` by ${entry.updatedBy.fullName}` : ''}
            </Typography>
          )}

          {!readOnly && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
              <Button
                fullWidth
                variant="contained"
                size="small"
                onClick={saveNow}
                disabled={!canSave || saveState === SAVE_STATE.SAVING}
                startIcon={
                  saveState === SAVE_STATE.SAVING ? <CircularProgress size={13} color="inherit" /> : undefined
                }
              >
                {saveState === SAVE_STATE.SAVING ? 'Saving…' : entry ? 'Save changes' : 'Save this hour'}
              </Button>
              {entry && (
                <Button size="small" onClick={cancelEdit} disabled={saveState === SAVE_STATE.SAVING}>
                  Cancel
                </Button>
              )}
            </Stack>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * Small, quiet, and never a blocking spinner. The point of an autosave is that
 * you do not have to think about it — a modal over the top would defeat it.
 */
function SaveIndicator({ state }) {
  if (state === SAVE_STATE.SAVING) {
    return (
      <Tooltip title="Saving">
        <SyncIcon sx={{ fontSize: 14, animation: 'spin 900ms linear infinite', '@keyframes spin': { to: { transform: 'rotate(360deg)' } } }} />
      </Tooltip>
    );
  }
  if (state === SAVE_STATE.SAVED) {
    return (
      <Tooltip title="Saved">
        <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} />
      </Tooltip>
    );
  }
  if (state === SAVE_STATE.DIRTY) {
    return (
      <Tooltip title="Unsaved changes">
        <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'warning.main' }} />
      </Tooltip>
    );
  }
  if (state === SAVE_STATE.ERROR) {
    return (
      <Tooltip title="Could not save">
        <ErrorOutlineIcon sx={{ fontSize: 14, color: 'warning.main' }} />
      </Tooltip>
    );
  }
  return null;
}
