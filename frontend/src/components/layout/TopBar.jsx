import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AppBar,
  Toolbar,
  IconButton,
  Box,
  Avatar,
  Menu,
  MenuItem,
  ListItemIcon,
  Typography,
  Badge,
  Divider,
  Tooltip,
  List,
  ListItemButton,
  ListItemText,
  Button,
  Popover,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import NotificationsIcon from '@mui/icons-material/NotificationsNoneOutlined';
import LightModeIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeIcon from '@mui/icons-material/DarkModeOutlined';
import PersonIcon from '@mui/icons-material/PersonOutline';
import LogoutIcon from '@mui/icons-material/LogoutOutlined';
import LockIcon from '@mui/icons-material/LockOutlined';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { useAuth } from '../../context/AuthContext.jsx';
import { useThemeMode } from '../../theme/ThemeModeContext.jsx';
import { notifications as notificationsApi } from '../../api/endpoints.js';
import { SIDEBAR_WIDTH } from './AppLayout.jsx';
import { initials, formatRelative } from '../../utils/format.js';

const LEVEL_COLOR = {
  CRITICAL: 'error.main',
  WARNING: 'warning.main',
  SUCCESS: 'success.main',
  INFO: 'info.main',
};

/**
 * The notification bell.
 *
 * Polls the unread count on an interval rather than opening a websocket. That is
 * a deliberate trade: a 30-second poll of a single indexed COUNT is trivially
 * cheap and survives Azure App Service restarts, proxies and corporate firewalls
 * without a reconnection strategy. A websocket buys us sub-second latency on a
 * reminder that is, by nature, already an hour old.
 */
function NotificationBell() {
  const [anchor, setAnchor] = useState(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: countData } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.unreadCount(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const { data: listData } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => notificationsApi.list({ pageSize: 8 }),
    enabled: Boolean(anchor), // only fetch the list when the menu is actually open
  });

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markOne = useMutation({
    mutationFn: (id) => notificationsApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = countData?.data?.count ?? 0;
  const items = listData?.data ?? [];

  const open = (notification) => {
    if (!notification.readAt) markOne.mutate(notification.id);
    setAnchor(null);
    if (notification.link) navigate(notification.link);
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)}>
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: '92vw', mt: 1 } } }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.25,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Notifications {unread > 0 && `(${unread})`}
          </Typography>
          {unread > 0 && (
            <Button
              size="small"
              startIcon={<DoneAllIcon sx={{ fontSize: 15 }} />}
              onClick={() => markAll.mutate()}
              sx={{ fontSize: 12 }}
            >
              Mark all read
            </Button>
          )}
        </Box>

        {items.length === 0 ? (
          <Box sx={{ py: 5, textAlign: 'center' }}>
            <NotificationsIcon sx={{ fontSize: 32, color: 'text.disabled', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              You&apos;re all caught up.
            </Typography>
          </Box>
        ) : (
          <List disablePadding sx={{ maxHeight: 420, overflowY: 'auto' }}>
            {items.map((n) => (
              <ListItemButton
                key={n.id}
                onClick={() => open(n)}
                sx={{
                  alignItems: 'flex-start',
                  py: 1.25,
                  borderLeft: 3,
                  borderColor: n.readAt ? 'transparent' : (LEVEL_COLOR[n.level] ?? 'info.main'),
                  bgcolor: n.readAt ? 'transparent' : 'action.hover',
                }}
              >
                <ListItemText
                  primary={n.title}
                  secondary={
                    <>
                      <Typography variant="body2" color="text.secondary" component="span" display="block">
                        {n.body}
                      </Typography>
                      <Typography variant="caption" color="text.disabled">
                        {formatRelative(n.createdAt)}
                      </Typography>
                    </>
                  }
                  primaryTypographyProps={{
                    fontSize: 13.5,
                    fontWeight: n.readAt ? 500 : 650,
                  }}
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}

export default function TopBar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const navigate = useNavigate();
  const [anchor, setAnchor] = useState(null);

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        width: { lg: `calc(100% - ${SIDEBAR_WIDTH}px)` },
        ml: { lg: `${SIDEBAR_WIDTH}px` },
      }}
    >
      <Toolbar sx={{ gap: 1, minHeight: { xs: 56, sm: 64 } }}>
        <IconButton
          edge="start"
          onClick={onMenuClick}
          sx={{ display: { lg: 'none' } }}
          aria-label="Open navigation"
        >
          <MenuIcon />
        </IconButton>

        <Box sx={{ flexGrow: 1 }} />

        <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          <IconButton size="small" onClick={toggleMode}>
            {mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          </IconButton>
        </Tooltip>

        <NotificationBell />

        <Box
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            ml: 0.5,
            pl: 1,
            pr: { xs: 0.5, sm: 1.25 },
            py: 0.5,
            borderRadius: 2,
            cursor: 'pointer',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Avatar
            src={user?.avatarPath ? `/uploads/${user.avatarPath}` : undefined}
            sx={{ width: 30, height: 30, fontSize: 12, fontWeight: 600 }}
          >
            {initials(user?.fullName)}
          </Avatar>
          <Box sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1.2, textAlign: 'left' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 13, lineHeight: 1.3 }}>
              {user?.fullName}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11, lineHeight: 1.3 }}>
              {user?.employeeCode}
            </Typography>
          </Box>
        </Box>

        <Menu
          anchorEl={anchor}
          open={Boolean(anchor)}
          onClose={() => setAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { width: 220, mt: 1 } } }}
        >
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
              {user?.fullName}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {user?.email}
            </Typography>
          </Box>
          <Divider />

          <MenuItem
            onClick={() => {
              setAnchor(null);
              navigate('/profile');
            }}
          >
            <ListItemIcon>
              <PersonIcon fontSize="small" />
            </ListItemIcon>
            My profile
          </MenuItem>

          <MenuItem
            onClick={() => {
              setAnchor(null);
              navigate('/profile?tab=security');
            }}
          >
            <ListItemIcon>
              <LockIcon fontSize="small" />
            </ListItemIcon>
            Change password
          </MenuItem>

          <Divider />

          <MenuItem onClick={logout} sx={{ color: 'error.main' }}>
            <ListItemIcon>
              <LogoutIcon fontSize="small" color="error" />
            </ListItemIcon>
            Sign out
          </MenuItem>
        </Menu>
      </Toolbar>
    </AppBar>
  );
}
