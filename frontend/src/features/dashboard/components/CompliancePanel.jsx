import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import { Link as RouterLink } from 'react-router-dom';
import { alpha, useTheme } from '@mui/material/styles';

import EmptyState from '../../../components/common/EmptyState.jsx';
import ErrorState from '../../../components/common/ErrorState.jsx';
import SummaryTile from './SummaryTile.jsx';
import { formatNumber, initials } from '../../../utils/format.js';

/**
 * Who has not logged their hours, right now.
 *
 * The list is everyone with slots still missing — not only the people who
 * logged nothing at all. A half-filled sheet is the same phone call as an empty
 * one, and the API already sorts worst-first, which is chasing order. The chip
 * distinguishes "nothing at all" from "partly done" so the manager can triage
 * without opening anything.
 */
export default function CompliancePanel({ data, loading, error, onRetry }) {
  const theme = useTheme();

  if (loading) {
    return (
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1}>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} variant="rounded" height={62} sx={{ flex: 1 }} />
          ))}
        </Stack>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={48} />
        ))}
      </Stack>
    );
  }

  if (error) return <ErrorState dense error={error} onRetry={onRetry} />;

  const summary = data?.summary;
  const date = data?.date;
  const needsChasing = (data?.employees ?? []).filter((employee) => employee.missingSlots > 0);

  return (
    <Stack spacing={2} sx={{ minHeight: 0, flex: 1 }}>
      <Stack direction="row" spacing={1}>
        <SummaryTile label="Compliant" value={summary?.compliant ?? 0} color={theme.palette.success.main} />
        <SummaryTile label="Partial" value={summary?.partial ?? 0} color={theme.palette.warning.main} />
        <SummaryTile label="Not logged" value={summary?.missing ?? 0} color={theme.palette.warning.main} />
      </Stack>

      {needsChasing.length === 0 ? (
        <EmptyState
          dense
          icon={TaskAltIcon}
          title="Everyone is up to date"
          message={
            summary?.total
              ? `All ${formatNumber(summary.total)} people in scope have filled their sheet.`
              : 'There is nobody in scope for this date.'
          }
        />
      ) : (
        <Stack spacing={0.5} sx={{ overflowY: 'auto', minHeight: 0, mx: -1, px: 1 }}>
          {needsChasing.map((employee) => {
            const loggedNothing = !employee.hasLogged;
            const tone = loggedNothing ? theme.palette.warning.main : theme.palette.warning.main;

            return (
              <Stack
                key={employee.userId}
                direction="row"
                alignItems="center"
                spacing={1.25}
                sx={{
                  py: 1,
                  px: 1,
                  borderRadius: 1.5,
                  '&:hover': { backgroundColor: 'action.hover' },
                  '&:hover .view-sheet': { opacity: 1 },
                }}
              >
                <Avatar
                  src={employee.avatarPath ? `/uploads/${employee.avatarPath}` : undefined}
                  sx={{ width: 32, height: 32, fontSize: '0.6875rem', fontWeight: 600 }}
                >
                  {initials(employee.fullName)}
                </Avatar>

                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                    {employee.fullName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap component="div">
                    {[employee.team?.name ?? employee.department?.name, employee.employeeCode]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                </Box>

                <Chip
                  label={
                    loggedNothing
                      ? 'Not logged'
                      : `${employee.filledSlots}/${employee.expectedSlots} slots`
                  }
                  sx={{
                    flexShrink: 0,
                    color: tone,
                    backgroundColor: alpha(tone, theme.palette.mode === 'light' ? 0.1 : 0.16),
                  }}
                />

                <Button
                  className="view-sheet"
                  component={RouterLink}
                  to={`/monitor?userId=${employee.userId}&date=${date}`}
                  size="small"
                  variant="outlined"
                  sx={{
                    flexShrink: 0,
                    opacity: { xs: 1, md: 0 },
                    transition: 'opacity 120ms ease',
                    '&:focus-visible': { opacity: 1 },
                  }}
                >
                  View sheet
                </Button>
              </Stack>
            );
          })}
        </Stack>
      )}
    </Stack>
  );
}
