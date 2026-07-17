/**
 * Routing.
 *
 * Three gates, in order:
 *
 *   PublicOnly   — a signed-in user hitting /login is bounced to the dashboard.
 *   RequireAuth  — an anonymous user is bounced to /login, remembering where
 *                  they were headed so the redirect after sign-in lands them
 *                  there rather than dumping them on a generic home page.
 *   RequirePermission — renders a real "no access" page rather than a blank
 *                  screen. (Cosmetic: the API denies it independently.)
 *
 * A forced password change short-circuits everything. An admin-reset account
 * whose temporary password is known to the admin must not be able to wander the
 * app on that shared secret.
 *
 * Every page is lazy-loaded. The initial bundle is the shell and the login
 * screen; an Employee never downloads the admin CRUD or the charting library.
 */
import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import AppLayout from '../components/layout/AppLayout.jsx';
import LoadingScreen from '../components/common/LoadingScreen.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { PERMISSIONS } from '../utils/constants.js';
import LockIcon from '@mui/icons-material/LockOutlined';
import SearchOffIcon from '@mui/icons-material/SearchOff';

const Login = lazy(() => import('../features/auth/LoginPage.jsx'));
const ForgotPassword = lazy(() => import('../features/auth/ForgotPasswordPage.jsx'));
const ForceChangePassword = lazy(() => import('../features/auth/ForceChangePasswordPage.jsx'));

const Dashboard = lazy(() => import('../features/dashboard/DashboardPage.jsx'));
const TaskSheet = lazy(() => import('../features/tasks/TaskSheetPage.jsx'));
const Assignments = lazy(() => import('../features/assignments/AssignmentsPage.jsx'));
const AssignmentDetail = lazy(() => import('../features/assignments/AssignmentDetailPage.jsx'));
const Monitor = lazy(() => import('../features/monitor/MonitorPage.jsx'));
const Approvals = lazy(() => import('../features/approvals/ApprovalsPage.jsx'));
const Reports = lazy(() => import('../features/reports/ReportsPage.jsx'));
const Profile = lazy(() => import('../features/profile/ProfilePage.jsx'));

const Departments = lazy(() => import('../features/admin/DepartmentsPage.jsx'));
const Users = lazy(() => import('../features/admin/UsersPage.jsx'));
const Teams = lazy(() => import('../features/admin/TeamsPage.jsx'));
const Projects = lazy(() => import('../features/admin/ProjectsPage.jsx'));
const AuditLog = lazy(() => import('../features/admin/AuditLogPage.jsx'));
const Settings = lazy(() => import('../features/admin/SettingsPage.jsx'));

function RequireAuth({ children }) {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (isLoading) return <LoadingScreen message="Restoring your session…" />;

  if (!isAuthenticated) {
    // `state.from` is what makes a deep link survive the sign-in detour.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return children;
}

function PublicOnly({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return <LoadingScreen />;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
}

function RequirePermission({ permission, children }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <EmptyState
        icon={LockIcon}
        title="You don't have access to this page"
        message="Your role doesn't include this area. If you believe that's a mistake, contact your administrator."
      />
    );
  }
  return children;
}

/** Land each role on the screen they actually came for. */
function HomeRedirect() {
  const { can } = useAuth();
  return <Navigate to={can(PERMISSIONS.DASHBOARD_TEAM) ? '/dashboard' : '/tasks'} replace />;
}

/**
 * The task sheet needs a department — its columns and its fields come from one.
 * A Management account has none (it is cross-departmental by definition), so
 * there is literally nothing to render.
 *
 * The nav already hides the link, but a bookmark or a typed URL must not dump
 * them on a red "Could not load your task sheet" error. Send them where they
 * were actually going.
 */
function RequireDepartment({ children }) {
  const { user } = useAuth();
  if (!user?.departmentId) return <Navigate to="/monitor" replace />;
  return children;
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={SearchOffIcon}
      title="Page not found"
      message="The page you're looking for doesn't exist or has moved."
      actionLabel="Go to dashboard"
      onAction={() => navigate('/dashboard')}
    />
  );
}

export default function AppRouter() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnly>
              <Login />
            </PublicOnly>
          }
        />
        <Route
          path="/forgot-password"
          element={
            <PublicOnly>
              <ForgotPassword />
            </PublicOnly>
          }
        />

        {/* Reachable only while authenticated AND flagged — deliberately outside AppLayout,
            so the app chrome is not usable until the temporary password is replaced. */}
        <Route path="/change-password" element={<ForceChangePassword />} />

        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route
            path="/tasks"
            element={
              <RequireDepartment>
                <TaskSheet />
              </RequireDepartment>
            }
          />
          <Route
            path="/assignments"
            element={
              <RequirePermission permission={PERMISSIONS.ASSIGNMENT_READ}>
                <Assignments />
              </RequirePermission>
            }
          />
          <Route
            path="/assignments/:id"
            element={
              <RequirePermission permission={PERMISSIONS.ASSIGNMENT_READ}>
                <AssignmentDetail />
              </RequirePermission>
            }
          />
          <Route path="/profile" element={<Profile />} />

          <Route
            path="/monitor"
            element={
              <RequirePermission permission={PERMISSIONS.DASHBOARD_TEAM}>
                <Monitor />
              </RequirePermission>
            }
          />
          <Route
            path="/approvals"
            element={
              <RequirePermission permission={PERMISSIONS.TASK_APPROVE}>
                <Approvals />
              </RequirePermission>
            }
          />
          <Route
            path="/reports"
            element={
              <RequirePermission permission={PERMISSIONS.REPORT_EXPORT}>
                <Reports />
              </RequirePermission>
            }
          />

          <Route
            path="/admin/departments"
            element={
              <RequirePermission permission={PERMISSIONS.DEPARTMENT_MANAGE}>
                <Departments />
              </RequirePermission>
            }
          />
          {/* USER_READ, not USER_CREATE: a Tech Lead needs this page to reset a
              locked-out employee's password. The page's create/edit/delete
              actions stay individually gated, so a lead sees their department's
              roster with only "Reset password" enabled — and the API scopes the
              list to their department regardless. */}
          <Route
            path="/admin/users"
            element={
              <RequirePermission permission={PERMISSIONS.USER_READ}>
                <Users />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/teams"
            element={
              <RequirePermission permission={PERMISSIONS.TEAM_MANAGE}>
                <Teams />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/projects"
            element={
              <RequirePermission permission={PERMISSIONS.PROJECT_MANAGE}>
                <Projects />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <RequirePermission permission={PERMISSIONS.AUDIT_READ}>
                <AuditLog />
              </RequirePermission>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <RequirePermission permission={PERMISSIONS.SETTINGS_READ}>
                <Settings />
              </RequirePermission>
            }
          />
        </Route>

        <Route
          path="*"
          element={
            <NotFound />
          }
        />
      </Routes>
    </Suspense>
  );
}
