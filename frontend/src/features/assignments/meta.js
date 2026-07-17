/**
 * Shared display metadata for assignments — status and priority chips, used by
 * the list, the detail thread and the dashboard delivery strip so the colour of
 * "In Review" is the same everywhere.
 *
 * Colours obey the house rule: nothing is red unless it is destructive. Overdue
 * and urgent read as WARNING (amber), never error — an overdue task is a nudge,
 * not a deletion.
 */
import { ASSIGNMENT_STATUS, ASSIGNMENT_PRIORITY } from '../../utils/constants.js';

/** MUI chip `color` + human label per status. */
export const STATUS_META = {
  ASSIGNED: { color: 'default', label: ASSIGNMENT_STATUS.ASSIGNED },
  IN_PROGRESS: { color: 'info', label: ASSIGNMENT_STATUS.IN_PROGRESS },
  SUBMITTED: { color: 'secondary', label: ASSIGNMENT_STATUS.SUBMITTED },
  DONE: { color: 'success', label: ASSIGNMENT_STATUS.DONE },
  CANCELLED: { color: 'default', label: ASSIGNMENT_STATUS.CANCELLED },
};

export const PRIORITY_META = {
  LOW: { color: 'default', label: ASSIGNMENT_PRIORITY.LOW },
  NORMAL: { color: 'default', label: ASSIGNMENT_PRIORITY.NORMAL },
  HIGH: { color: 'warning', label: ASSIGNMENT_PRIORITY.HIGH },
  URGENT: { color: 'warning', label: ASSIGNMENT_PRIORITY.URGENT },
};

export const statusMeta = (s) => STATUS_META[s] ?? { color: 'default', label: s };
export const priorityMeta = (p) => PRIORITY_META[p] ?? { color: 'default', label: p };

/** fullName from an options row that may only carry firstName/lastName/email. */
export const personLabel = (u) =>
  u?.fullName ?? [u?.firstName, u?.lastName].filter(Boolean).join(' ') ?? u?.email ?? 'Unknown';
