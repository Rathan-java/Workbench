import { useMemo, useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { alpha, useTheme } from '@mui/material/styles';

import EmptyState from '../../../components/common/EmptyState.jsx';
import ErrorState from '../../../components/common/ErrorState.jsx';
import { formatNumber, formatPercent, initials } from '../../../utils/format.js';
import { complianceTone } from '../tone.js';

/**
 * "Completed" is gone: every logged hour is completed work by definition, so the
 * column counted nothing. `hoursLogged` (against `expectedHours`) is the number
 * that survives — it says whether the day was actually accounted for.
 */
const COLUMNS = [
  { key: 'fullName', label: 'Employee', numeric: false },
  { key: 'department', label: 'Department', numeric: false },
  { key: 'daysTracked', label: 'Days', numeric: true },
  { key: 'complianceRate', label: 'Compliance', numeric: true, width: 168 },
  { key: 'punctualityRate', label: 'Punctuality', numeric: true },
  { key: 'hoursLogged', label: 'Hours', numeric: true },
];

const sortValue = (row, key) => {
  if (key === 'department') return row.department?.name ?? '';
  if (key === 'fullName') return row.fullName ?? '';
  return Number(row[key]) || 0;
};

function ComplianceBar({ rate }) {
  const theme = useTheme();
  const tone = complianceTone(rate, theme);

  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ justifyContent: 'flex-end' }}>
      <LinearProgress
        variant="determinate"
        value={Math.min(Math.max(Number(rate) || 0, 0), 100)}
        sx={{
          flex: 1,
          maxWidth: 88,
          height: 6,
          borderRadius: 3,
          backgroundColor: alpha(tone, 0.16),
          '& .MuiLinearProgress-bar': { backgroundColor: tone, borderRadius: 3 },
        }}
      />
      <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 40, textAlign: 'right', color: tone }}>
        {formatPercent(rate, 0)}
      </Typography>
    </Stack>
  );
}

/**
 * The leaderboard, defaulting to WORST compliance first.
 *
 * Ranking the best performers at the top is what a vanity dashboard does. The
 * manager opening this needs the four people whose sheets are empty, and they
 * need them without scrolling — so the default sort is ascending compliance,
 * and every column is still toggleable for the manager who wants to celebrate.
 */
export default function EmployeeLeaderboard({ rows, loading, error, onRetry }) {
  const [sort, setSort] = useState({ key: 'complianceRate', dir: 'asc' });

  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];

    return list.sort((a, b) => {
      const left = sortValue(a, sort.key);
      const right = sortValue(b, sort.key);

      const comparison =
        typeof left === 'string' ? left.localeCompare(right) : left - right;

      return sort.dir === 'asc' ? comparison : -comparison;
    });
  }, [rows, sort]);

  const toggleSort = (key) =>
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : // A newly picked column opens ascending: lowest compliance, or A–Z.
          { key, dir: 'asc' },
    );

  if (loading) {
    return (
      <Stack spacing={1} sx={{ p: 0.5 }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} variant="rounded" height={44} />
        ))}
      </Stack>
    );
  }

  if (error) return <ErrorState dense error={error} onRetry={onRetry} />;

  if (!sorted.length) {
    return (
      <EmptyState
        dense
        title="No productivity data yet"
        message="Nobody in scope has tracked a day in this range. Productivity is built from the nightly rollup, so today's entries appear here tomorrow."
      />
    );
  }

  return (
    <TableContainer sx={{ maxHeight: 420 }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            {COLUMNS.map((column) => (
              <TableCell
                key={column.key}
                align={column.numeric ? 'right' : 'left'}
                sortDirection={sort.key === column.key ? sort.dir : false}
                sx={{ width: column.width }}
              >
                <TableSortLabel
                  active={sort.key === column.key}
                  direction={sort.key === column.key ? sort.dir : 'asc'}
                  onClick={() => toggleSort(column.key)}
                >
                  {column.label}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>

        <TableBody>
          {sorted.map((row) => (
            <TableRow key={row.userId} hover>
              <TableCell>
                <Stack direction="row" alignItems="center" spacing={1.25}>
                  <Avatar
                    src={row.avatarPath ? `/uploads/${row.avatarPath}` : undefined}
                    sx={{ width: 30, height: 30, fontSize: '0.6875rem', fontWeight: 600 }}
                  >
                    {initials(row.fullName)}
                  </Avatar>

                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                      {row.fullName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap component="div">
                      {row.designation || row.employeeCode}
                    </Typography>
                  </Box>
                </Stack>
              </TableCell>

              <TableCell>
                {row.department ? (
                  <Stack direction="row" alignItems="center" spacing={0.75}>
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        flexShrink: 0,
                        // The department's own colour, straight from the API.
                        backgroundColor: row.department.colorHex ?? 'text.disabled',
                      }}
                    />
                    <Typography variant="body2" color="text.secondary" noWrap>
                      {row.department.name}
                    </Typography>
                  </Stack>
                ) : (
                  <Typography variant="body2" color="text.disabled">
                    —
                  </Typography>
                )}
              </TableCell>

              <TableCell align="right">
                <Typography variant="body2" color="text.secondary">
                  {formatNumber(row.daysTracked)}
                </Typography>
              </TableCell>

              <TableCell align="right">
                <ComplianceBar rate={row.complianceRate} />
              </TableCell>

              <TableCell align="right">
                <Typography variant="body2">{formatPercent(row.punctualityRate, 0)}</Typography>
              </TableCell>

              <TableCell align="right">
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {formatNumber(row.hoursLogged ?? 0)}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {' / '}
                    {formatNumber(row.expectedHours ?? 0)}
                  </Typography>
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
