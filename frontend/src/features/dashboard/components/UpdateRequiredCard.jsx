import { useNavigate } from 'react-router-dom';

import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha, useTheme } from '@mui/material/styles';

import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined';

import { initials } from '../../../utils/format.js';

/**
 * UPDATE REQUIRED — the only actionable list on the dashboard.
 *
 * Everyone who has gone more than N hours (3 by default) without logging a
 * finished hour, grouped by department, with the number of updates they owe.
 *
 * This is a CHASE LIST, so it is built to be read in five seconds and acted on:
 * names, a count, and a link straight to the person's sheet. No charts.
 *
 * ── WHEN IT IS EMPTY, SAY SO WARMLY ─────────────────────────────────────────
 * A blank panel reads as "broken" or "still loading". An explicit, positive empty
 * state is what turns "nothing to show" into "nothing to do" — and that is the
 * state you actually want this card to be in every day.
 */
export default function UpdateRequiredCard({ data, date, thresholdHours }) {
  const theme = useTheme();
  const navigate = useNavigate();

  const departments = data ?? [];
  const totalPeople = departments.reduce((s, d) => s + d.employees.length, 0);
  const totalOwed = departments.reduce((s, d) => s + d.totalPending, 0);

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2.5, overflow: 'hidden', height: '100%' }}>
      <Box
        sx={{
          px: 2.25,
          py: 1.75,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: totalPeople
            ? alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.06)
            : alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.25}>
          {totalPeople ? (
            <NotificationsActiveOutlinedIcon sx={{ fontSize: 20, color: 'warning.main' }} />
          ) : (
            <CheckCircleOutlineIcon sx={{ fontSize: 20, color: 'success.main' }} />
          )}

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
              Update required
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {totalPeople
                ? `${totalPeople} ${totalPeople === 1 ? 'person has' : 'people have'} not logged an hour that finished over ${thresholdHours} hours ago`
                : `Nobody is more than ${thresholdHours} hours behind`}
            </Typography>
          </Box>

          {totalOwed > 0 && (
            <Chip
              label={`${totalOwed} owed`}
              color="warning"
              size="small"
              sx={{ fontWeight: 700, flexShrink: 0 }}
            />
          )}
        </Stack>
      </Box>

      {totalPeople === 0 ? (
        <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
          <CheckCircleOutlineIcon sx={{ fontSize: 36, color: 'success.main', mb: 1 }} />
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Everyone is up to date
          </Typography>
          <Typography variant="caption" color="text.secondary">
            No one has a finished hour left unlogged for more than {thresholdHours} hours.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ maxHeight: 460, overflowY: 'auto' }}>
          {departments.map((dept, index) => (
            <Box key={dept.departmentId}>
              {index > 0 && <Divider />}

              <Box
                sx={{
                  px: 2.25,
                  py: 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  bgcolor: 'action.hover',
                }}
              >
                <Box
                  sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: dept.colorHex, flexShrink: 0 }}
                />
                <Typography variant="caption" sx={{ fontWeight: 700, flex: 1 }}>
                  {dept.name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 700 }}>
                  {dept.totalPending} {dept.totalPending === 1 ? 'update' : 'updates'}
                </Typography>
              </Box>

              {dept.employees.map((person) => (
                <Stack
                  key={person.userId}
                  direction="row"
                  alignItems="center"
                  spacing={1.25}
                  sx={{
                    px: 2.25,
                    py: 1.25,
                    borderBottom: 1,
                    borderColor: 'divider',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:last-of-type': { borderBottom: 0 },
                  }}
                >
                  <Avatar
                    src={person.avatarPath ? `/uploads/${person.avatarPath}` : undefined}
                    sx={{ width: 30, height: 30, fontSize: 11 }}
                  >
                    {initials(person.fullName)}
                  </Avatar>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13.5 }} noWrap>
                      {person.fullName}
                    </Typography>
                    <Tooltip title={`Hours not logged: ${person.hours.join(', ')}`}>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {person.employeeCode} · {person.hours.slice(0, 2).join(', ')}
                        {person.hours.length > 2 && ` +${person.hours.length - 2}`}
                      </Typography>
                    </Tooltip>
                  </Box>

                  <Chip
                    label={person.pendingUpdates}
                    size="small"
                    color="warning"
                    variant="outlined"
                    sx={{ height: 22, minWidth: 30, fontWeight: 700, flexShrink: 0 }}
                  />

                  <Button
                    size="small"
                    variant="text"
                    onClick={() => navigate(`/monitor?userId=${person.userId}&date=${date}`)}
                    sx={{ fontSize: 12, flexShrink: 0 }}
                  >
                    View
                  </Button>
                </Stack>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
