/**
 * The application shell: persistent sidebar, top bar, content outlet.
 *
 * Two things worth noting:
 *
 * 1. THE NAVIGATION IS DERIVED FROM PERMISSIONS, NOT FROM ROLE.
 *    Each item declares the permission it needs, and the sidebar filters itself.
 *    Nobody ever writes `{user.role === 'MANAGEMENT' && <Item/>}` — when a
 *    permission moves between roles, the menu follows automatically.
 *    (This is cosmetic only. The API enforces the same rules independently; a
 *    user who guesses a URL still gets a 403.)
 *
 * 2. THE DEPARTMENT IS PART OF THE CHROME.
 *    A Tech Lead and a Video Editing lead see the same screens, so the
 *    department accent colour and name sit permanently in the sidebar. In a
 *    system whose whole model is "you only see your department", the user must
 *    never have to wonder which one they are looking at.
 */
import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
  useMediaQuery,
  useTheme,
  Chip,
  ListSubheader,
} from '@mui/material';
import DashboardIcon from '@mui/icons-material/SpaceDashboardOutlined';
import TaskIcon from '@mui/icons-material/EditCalendarOutlined';
import MonitorIcon from '@mui/icons-material/MonitorHeartOutlined';
import ApprovalIcon from '@mui/icons-material/FactCheckOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTreeOutlined';
import PeopleIcon from '@mui/icons-material/PeopleAltOutlined';
import GroupsIcon from '@mui/icons-material/GroupsOutlined';
import FolderIcon from '@mui/icons-material/FolderOpenOutlined';
import AssessmentIcon from '@mui/icons-material/AssessmentOutlined';
import HistoryIcon from '@mui/icons-material/ManageSearchOutlined';
import SettingsIcon from '@mui/icons-material/SettingsOutlined';
import { useAuth } from '../../context/AuthContext.jsx';
import { PERMISSIONS } from '../../utils/constants.js';
import TopBar from './TopBar.jsx';

export const SIDEBAR_WIDTH = 256;

/**
 * @typedef {object} NavItem
 * @property {string} label
 * @property {string} to
 * @property {React.ElementType} icon
 * @property {string} [permission]     Hidden when the user lacks it.
 * @property {string[]} [anyOf]        Hidden unless the user has at least one.
 * @property {boolean} [requiresDepartment] Hidden for anyone with no department.
 */

/** @type {{heading: string|null, items: NavItem[]}[]} */
const NAV_SECTIONS = [
  {
    heading: null,
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: DashboardIcon },
      {
        label: 'My Task Sheet',
        to: '/tasks',
        icon: TaskIcon,
        permission: PERMISSIONS.TASK_WRITE_OWN,
        /**
         * MANAGEMENT DOES NOT LOG HOURS.
         *
         * A Management account is cross-departmental and therefore has no
         * department — and the task grid's columns and fields come FROM the
         * department. There is nothing to render, and the API correctly answers
         * "this account does not belong to a department and has no task sheet."
         *
         * Showing them the link and letting them walk into that error is a
         * self-inflicted bug report. They monitor; they do not fill in a
         * timesheet.
         */
        requiresDepartment: true,
      },
    ],
  },
  {
    heading: 'Oversight',
    items: [
      {
        label: 'Monitor',
        to: '/monitor',
        icon: MonitorIcon,
        permission: PERMISSIONS.DASHBOARD_TEAM,
      },
      {
        label: 'Approvals',
        to: '/approvals',
        icon: ApprovalIcon,
        permission: PERMISSIONS.TASK_APPROVE,
      },
      {
        label: 'Reports',
        to: '/reports',
        icon: AssessmentIcon,
        permission: PERMISSIONS.REPORT_EXPORT,
      },
    ],
  },
  {
    heading: 'Administration',
    items: [
      // First, deliberately: a department is the root of the org model — its people,
      // teams, projects and task grid all hang off it.
      {
        label: 'Departments',
        to: '/admin/departments',
        icon: AccountTreeIcon,
        permission: PERMISSIONS.DEPARTMENT_MANAGE,
      },
      // USER_READ so a Tech Lead can open their department's roster to reset a
      // locked-out employee. Management still gets the full create/edit/delete set.
      { label: 'Employees', to: '/admin/users', icon: PeopleIcon, permission: PERMISSIONS.USER_READ },
      { label: 'Teams', to: '/admin/teams', icon: GroupsIcon, permission: PERMISSIONS.TEAM_MANAGE },
      { label: 'Projects', to: '/admin/projects', icon: FolderIcon, permission: PERMISSIONS.PROJECT_MANAGE },
      { label: 'Audit Log', to: '/admin/audit', icon: HistoryIcon, permission: PERMISSIONS.AUDIT_READ },
      { label: 'Settings', to: '/admin/settings', icon: SettingsIcon, permission: PERMISSIONS.SETTINGS_READ },
    ],
  },
];

const isVisible = (item, can, user) => {
  // A screen that is rendered FROM a department cannot render without one.
  if (item.requiresDepartment && !user?.departmentId) return false;
  if (item.permission) return can(item.permission);
  if (item.anyOf) return item.anyOf.some(can);
  return true;
};

function SidebarContent({ onNavigate }) {
  const { user, can } = useAuth();
  const location = useLocation();
  const accent = user?.department?.colorHex ?? '#2563EB';

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => isVisible(item, can, user)),
  })).filter((section) => section.items.length > 0);

  return (
    <>
      <Toolbar sx={{ px: 2.5, minHeight: 64 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            sx={{
              width: 30,
              height: 30,
              borderRadius: 1.5,
              display: 'grid',
              placeItems: 'center',
              background: `linear-gradient(135deg, ${accent}, ${accent}bb)`,
              color: '#fff',
              fontWeight: 700,
              fontSize: 15,
              flexShrink: 0,
            }}
          >
            A
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.2 }}>
              Ara Workbench
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', lineHeight: 1.3 }}>
              {user?.department?.name ?? 'Company-wide'}
            </Typography>
          </Box>
        </Box>
      </Toolbar>

      <Divider />

      <Box sx={{ overflowY: 'auto', flex: 1, py: 1 }}>
        {sections.map((section, index) => (
          <List
            key={section.heading ?? `section-${index}`}
            dense
            disablePadding
            sx={{ px: 1.25, pb: 0.5 }}
            subheader={
              section.heading ? (
                <ListSubheader
                  disableSticky
                  sx={{
                    bgcolor: 'transparent',
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'text.disabled',
                    lineHeight: 2.6,
                    px: 1.5,
                  }}
                >
                  {section.heading}
                </ListSubheader>
              ) : null
            }
          >
            {section.items.map((item) => {
              const Icon = item.icon;
              const active = location.pathname.startsWith(item.to);

              return (
                <ListItemButton
                  key={item.to}
                  component={NavLink}
                  to={item.to}
                  onClick={onNavigate}
                  sx={{
                    borderRadius: 1.5,
                    mb: 0.25,
                    py: 0.85,
                    color: active ? 'primary.main' : 'text.secondary',
                    bgcolor: active ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 34, color: 'inherit' }}>
                    <Icon sx={{ fontSize: 19 }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{
                      fontSize: 13.5,
                      fontWeight: active ? 650 : 500,
                      color: active ? 'primary.main' : 'text.primary',
                    }}
                  />
                </ListItemButton>
              );
            })}
          </List>
        ))}
      </Box>

      <Divider />
      <Box sx={{ p: 1.75 }}>
        <Chip
          size="small"
          label={
            { MANAGEMENT: 'Management', TECH_LEAD: 'Tech Lead', EMPLOYEE: 'Employee' }[user?.role] ??
            user?.role
          }
          sx={{
            width: '100%',
            justifyContent: 'flex-start',
            fontWeight: 600,
            fontSize: 11,
            height: 24,
            bgcolor: `${accent}18`,
            color: accent,
            border: `1px solid ${accent}33`,
          }}
        />
      </Box>
    </>
  );
}

export default function AppLayout() {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <TopBar onMenuClick={() => setMobileOpen(true)} />

      <Box component="nav" sx={{ width: { lg: SIDEBAR_WIDTH }, flexShrink: { lg: 0 } }}>
        <Drawer
          variant={isDesktop ? 'permanent' : 'temporary'}
          open={isDesktop || mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }} // mobile nav must not re-mount on every open
          sx={{
            '& .MuiDrawer-paper': {
              width: SIDEBAR_WIDTH,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              borderRight: `1px solid ${theme.palette.divider}`,
            },
          }}
        >
          <SidebarContent onNavigate={() => setMobileOpen(false)} />
        </Drawer>
      </Box>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          width: { lg: `calc(100% - ${SIDEBAR_WIDTH}px)` },
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0, // lets wide tables scroll inside the main area instead of blowing out the page
        }}
      >
        <Toolbar sx={{ minHeight: { xs: 56, sm: 64 } }} />
        <Box sx={{ p: { xs: 2, sm: 3 }, flex: 1 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
