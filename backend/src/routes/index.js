/**
 * The API surface, assembled in one place.
 * A new module is one import and one `.use()` — and it is immediately visible
 * that nothing has been mounted without going through the router chain.
 */
import { Router } from 'express';
import authRoutes from '../modules/auth/auth.routes.js';
import userRoutes from '../modules/users/user.routes.js';
import departmentRoutes from '../modules/departments/department.routes.js';
import teamRoutes from '../modules/teams/team.routes.js';
import projectRoutes from '../modules/projects/project.routes.js';
import taskRoutes from '../modules/tasks/task.routes.js';
import dashboardRoutes from '../modules/dashboard/dashboard.routes.js';
import reportRoutes from '../modules/reports/report.routes.js';
import auditRoutes from '../modules/audit/audit.routes.js';
import notificationRoutes from '../modules/notifications/notification.routes.js';
import settingRoutes from '../modules/settings/setting.routes.js';
import systemRoutes from './system.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/departments', departmentRoutes);
router.use('/teams', teamRoutes);
router.use('/projects', projectRoutes);
router.use('/tasks', taskRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/reports', reportRoutes);
router.use('/audit', auditRoutes);
router.use('/notifications', notificationRoutes);
router.use('/settings', settingRoutes);
router.use('/system', systemRoutes);

export default router;
