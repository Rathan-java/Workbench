import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { fullName as toFullName, initials } from '../../../utils/format.js';

/** Avatars are served as static files from /uploads; the DTO carries only the path. */
const avatarUrl = (avatarPath) => (avatarPath ? `/uploads/${avatarPath}` : undefined);

export function UserAvatar({ user, size = 32, sx }) {
  return (
    <Avatar
      src={avatarUrl(user?.avatarPath)}
      sx={{ width: size, height: size, fontSize: size * 0.4, fontWeight: 600, ...sx }}
    >
      {initials(user)}
    </Avatar>
  );
}

/** Avatar + name, with an optional second line (employee code, email, role…). */
export default function UserCell({ user, secondary, size = 32, fallback = '—' }) {
  if (!user) {
    return (
      <Typography variant="body2" color="text.disabled">
        {fallback}
      </Typography>
    );
  }

  return (
    <Stack direction="row" spacing={1.25} alignItems="center" sx={{ minWidth: 0 }}>
      <UserAvatar user={user} size={size} />

      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body2" fontWeight={500} noWrap>
          {toFullName(user)}
        </Typography>

        {secondary && (
          <Typography variant="caption" color="text.secondary" noWrap component="div">
            {secondary}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
