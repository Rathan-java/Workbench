-- CreateTable
CREATE TABLE `departments` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(48) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` VARCHAR(500) NULL,
    `colorHex` VARCHAR(9) NOT NULL DEFAULT '#2563EB',
    `icon` VARCHAR(48) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `requiredSlotsPerDay` INTEGER NOT NULL DEFAULT 7,
    `workingWeekdays` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `departments_code_key`(`code`),
    INDEX `departments_isActive_sortOrder_idx`(`isActive`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `time_slots` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(32) NOT NULL,
    `startMinute` INTEGER NOT NULL,
    `endMinute` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL,
    `isBreak` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `time_slots_departmentId_isActive_sortOrder_idx`(`departmentId`, `isActive`, `sortOrder`),
    UNIQUE INDEX `time_slots_departmentId_startMinute_key`(`departmentId`, `startMinute`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_field_definitions` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `type` ENUM('TEXT', 'TEXTAREA', 'NUMBER', 'SELECT', 'MULTISELECT', 'DATE', 'BOOLEAN', 'DURATION_MINUTES', 'URL') NOT NULL,
    `isRequired` BOOLEAN NOT NULL DEFAULT false,
    `options` JSON NULL,
    `placeholder` VARCHAR(160) NULL,
    `helpText` VARCHAR(240) NULL,
    `maxLength` INTEGER NULL,
    `minValue` INTEGER NULL,
    `maxValue` INTEGER NULL,
    `defaultValue` JSON NULL,
    `showInTable` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_field_definitions_departmentId_isActive_sortOrder_idx`(`departmentId`, `isActive`, `sortOrder`),
    UNIQUE INDEX `task_field_definitions_departmentId_key_key`(`departmentId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teams` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `code` VARCHAR(48) NOT NULL,
    `description` VARCHAR(500) NULL,
    `leadId` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `teams_code_key`(`code`),
    INDEX `teams_departmentId_isActive_idx`(`departmentId`, `isActive`),
    INDEX `teams_leadId_idx`(`leadId`),
    UNIQUE INDEX `teams_departmentId_name_key`(`departmentId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `employeeCode` VARCHAR(32) NOT NULL,
    `email` VARCHAR(190) NOT NULL,
    `passwordHash` VARCHAR(120) NOT NULL,
    `firstName` VARCHAR(80) NOT NULL,
    `lastName` VARCHAR(80) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `designation` VARCHAR(120) NULL,
    `avatarPath` VARCHAR(255) NULL,
    `role` ENUM('MANAGEMENT', 'TECH_LEAD', 'EMPLOYEE') NOT NULL,
    `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `departmentId` VARCHAR(191) NULL,
    `teamId` VARCHAR(191) NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    `locale` VARCHAR(12) NOT NULL DEFAULT 'en',
    `passwordChangedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT false,
    `failedLoginCount` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `lastLoginIp` VARCHAR(64) NULL,
    `createdById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deactivatedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_employeeCode_key`(`employeeCode`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_departmentId_status_idx`(`departmentId`, `status`),
    INDEX `users_teamId_status_idx`(`teamId`, `status`),
    INDEX `users_role_status_idx`(`role`, `status`),
    INDEX `users_lastName_firstName_idx`(`lastName`, `firstName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `projects` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(48) NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `clientName` VARCHAR(160) NULL,
    `startDate` DATE NULL,
    `endDate` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `projects_departmentId_status_idx`(`departmentId`, `status`),
    UNIQUE INDEX `projects_departmentId_code_key`(`departmentId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `project_modules` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_modules_projectId_isActive_idx`(`projectId`, `isActive`),
    UNIQUE INDEX `project_modules_projectId_name_key`(`projectId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_days` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NULL,
    `workDate` DATE NOT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
    `submittedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `filledSlots` INTEGER NOT NULL DEFAULT 0,
    `expectedSlots` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_days_departmentId_workDate_idx`(`departmentId`, `workDate`),
    INDEX `task_days_teamId_workDate_idx`(`teamId`, `workDate`),
    INDEX `task_days_workDate_status_idx`(`workDate`, `status`),
    INDEX `task_days_status_departmentId_idx`(`status`, `departmentId`),
    UNIQUE INDEX `task_days_userId_workDate_key`(`userId`, `workDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_entries` (
    `id` VARCHAR(191) NOT NULL,
    `taskDayId` VARCHAR(191) NOT NULL,
    `timeSlotId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NULL,
    `workDate` DATE NOT NULL,
    `description` TEXT NOT NULL,
    `projectId` VARCHAR(191) NULL,
    `moduleId` VARCHAR(191) NULL,
    `priority` ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
    `status` ENUM('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'ON_HOLD', 'TESTING') NOT NULL DEFAULT 'IN_PROGRESS',
    `remarks` TEXT NULL,
    `attributes` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `isLate` BOOLEAN NOT NULL DEFAULT false,
    `editedByLead` BOOLEAN NOT NULL DEFAULT false,
    `createdById` VARCHAR(191) NOT NULL,
    `updatedById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `task_entries_departmentId_workDate_idx`(`departmentId`, `workDate`),
    INDEX `task_entries_teamId_workDate_idx`(`teamId`, `workDate`),
    INDEX `task_entries_userId_workDate_idx`(`userId`, `workDate`),
    INDEX `task_entries_projectId_workDate_idx`(`projectId`, `workDate`),
    INDEX `task_entries_status_workDate_idx`(`status`, `workDate`),
    INDEX `task_entries_priority_workDate_idx`(`priority`, `workDate`),
    INDEX `task_entries_workDate_idx`(`workDate`),
    UNIQUE INDEX `task_entries_taskDayId_timeSlotId_key`(`taskDayId`, `timeSlotId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_entry_revisions` (
    `id` VARCHAR(191) NOT NULL,
    `entryId` VARCHAR(191) NOT NULL,
    `revision` INTEGER NOT NULL,
    `action` ENUM('CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'REOPEN', 'LEAD_EDIT') NOT NULL,
    `snapshot` JSON NOT NULL,
    `changedFields` JSON NULL,
    `reason` VARCHAR(500) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(32) NOT NULL,
    `workDate` DATE NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_entry_revisions_entryId_createdAt_idx`(`entryId`, `createdAt`),
    INDEX `task_entry_revisions_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `task_entry_revisions_workDate_idx`(`workDate`),
    UNIQUE INDEX `task_entry_revisions_entryId_revision_key`(`entryId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_day_transitions` (
    `id` VARCHAR(191) NOT NULL,
    `taskDayId` VARCHAR(191) NOT NULL,
    `from` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL,
    `to` ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_day_transitions_taskDayId_createdAt_idx`(`taskDayId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `familyId` VARCHAR(64) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `replacedByHash` VARCHAR(64) NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `refresh_tokens_tokenHash_key`(`tokenHash`),
    INDEX `refresh_tokens_userId_revokedAt_idx`(`userId`, `revokedAt`),
    INDEX `refresh_tokens_familyId_idx`(`familyId`),
    INDEX `refresh_tokens_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_otps` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `otpHash` VARCHAR(120) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `resetTokenHash` VARCHAR(64) NULL,
    `resetTokenExpiresAt` DATETIME(3) NULL,
    `ip` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_otps_resetTokenHash_key`(`resetTokenHash`),
    INDEX `password_reset_otps_userId_consumedAt_idx`(`userId`, `consumedAt`),
    INDEX `password_reset_otps_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `action` ENUM('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', 'TOKEN_REUSE_DETECTED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGED', 'PASSWORD_RESET_BY_ADMIN', 'PROFILE_UPDATED', 'AVATAR_UPLOADED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'ROLE_CHANGED', 'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_LEAD_ASSIGNED', 'TEAM_MEMBER_ASSIGNED', 'PROJECT_CREATED', 'PROJECT_UPDATED', 'DEPARTMENT_UPDATED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'TASK_EDITED_BY_LEAD', 'TASK_DAY_SUBMITTED', 'TASK_DAY_APPROVED', 'TASK_DAY_REJECTED', 'TASK_DAY_REOPENED', 'REPORT_EXPORTED', 'SETTING_UPDATED', 'RETENTION_CLEANUP') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorEmail` VARCHAR(190) NULL,
    `actorRole` ENUM('MANAGEMENT', 'TECH_LEAD', 'EMPLOYEE') NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `departmentId` VARCHAR(32) NULL,
    `summary` VARCHAR(500) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `ip` VARCHAR(64) NULL,
    `userAgent` VARCHAR(255) NULL,
    `correlationId` VARCHAR(64) NULL,
    `success` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_createdAt_idx`(`createdAt`),
    INDEX `audit_logs_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `audit_logs_action_createdAt_idx`(`action`, `createdAt`),
    INDEX `audit_logs_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `audit_logs_departmentId_createdAt_idx`(`departmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `type` ENUM('MISSED_HOURLY_UPDATE', 'TEAM_COMPLIANCE_ALERT', 'DAILY_SUMMARY', 'TASK_APPROVED', 'TASK_REJECTED', 'TASK_EDITED_BY_LEAD', 'ACCOUNT', 'SYSTEM') NOT NULL,
    `level` ENUM('INFO', 'WARNING', 'CRITICAL', 'SUCCESS') NOT NULL DEFAULT 'INFO',
    `title` VARCHAR(160) NOT NULL,
    `body` TEXT NOT NULL,
    `link` VARCHAR(255) NULL,
    `entityType` VARCHAR(64) NULL,
    `entityId` VARCHAR(64) NULL,
    `readAt` DATETIME(3) NULL,
    `emailedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `notifications_userId_readAt_createdAt_idx`(`userId`, `readAt`, `createdAt`),
    INDEX `notifications_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_productivity_rollups` (
    `id` VARCHAR(191) NOT NULL,
    `workDate` DATE NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NULL,
    `expectedSlots` INTEGER NOT NULL DEFAULT 0,
    `filledSlots` INTEGER NOT NULL DEFAULT 0,
    `lateSlots` INTEGER NOT NULL DEFAULT 0,
    `notStarted` INTEGER NOT NULL DEFAULT 0,
    `inProgress` INTEGER NOT NULL DEFAULT 0,
    `completed` INTEGER NOT NULL DEFAULT 0,
    `blocked` INTEGER NOT NULL DEFAULT 0,
    `onHold` INTEGER NOT NULL DEFAULT 0,
    `testing` INTEGER NOT NULL DEFAULT 0,
    `complianceRate` DOUBLE NOT NULL DEFAULT 0,
    `computedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `daily_productivity_rollups_departmentId_workDate_idx`(`departmentId`, `workDate`),
    INDEX `daily_productivity_rollups_teamId_workDate_idx`(`teamId`, `workDate`),
    INDEX `daily_productivity_rollups_workDate_idx`(`workDate`),
    UNIQUE INDEX `daily_productivity_rollups_userId_workDate_key`(`userId`, `workDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scheduler_locks` (
    `name` VARCHAR(64) NOT NULL,
    `lockedUntil` DATETIME(3) NOT NULL,
    `owner` VARCHAR(64) NOT NULL,
    `lastRunAt` DATETIME(3) NULL,
    `lastRunOk` BOOLEAN NULL,
    `lastRunNote` VARCHAR(500) NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_settings` (
    `key` VARCHAR(96) NOT NULL,
    `value` JSON NOT NULL,
    `description` VARCHAR(500) NULL,
    `category` VARCHAR(48) NOT NULL DEFAULT 'general',
    `updatedById` VARCHAR(191) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `system_settings_category_idx`(`category`),
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `holidays` (
    `id` VARCHAR(191) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(160) NOT NULL,
    `departmentId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `holidays_date_idx`(`date`),
    UNIQUE INDEX `holidays_date_departmentId_key`(`date`, `departmentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `time_slots` ADD CONSTRAINT `time_slots_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_field_definitions` ADD CONSTRAINT `task_field_definitions_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teams` ADD CONSTRAINT `teams_leadId_fkey` FOREIGN KEY (`leadId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `projects` ADD CONSTRAINT `projects_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `project_modules` ADD CONSTRAINT `project_modules_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_days` ADD CONSTRAINT `task_days_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_days` ADD CONSTRAINT `task_days_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_days` ADD CONSTRAINT `task_days_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_days` ADD CONSTRAINT `task_days_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_taskDayId_fkey` FOREIGN KEY (`taskDayId`) REFERENCES `task_days`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_timeSlotId_fkey` FOREIGN KEY (`timeSlotId`) REFERENCES `time_slots`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `project_modules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entry_revisions` ADD CONSTRAINT `task_entry_revisions_entryId_fkey` FOREIGN KEY (`entryId`) REFERENCES `task_entries`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entry_revisions` ADD CONSTRAINT `task_entry_revisions_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_day_transitions` ADD CONSTRAINT `task_day_transitions_taskDayId_fkey` FOREIGN KEY (`taskDayId`) REFERENCES `task_days`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_day_transitions` ADD CONSTRAINT `task_day_transitions_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_otps` ADD CONSTRAINT `password_reset_otps_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_productivity_rollups` ADD CONSTRAINT `daily_productivity_rollups_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_productivity_rollups` ADD CONSTRAINT `daily_productivity_rollups_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_productivity_rollups` ADD CONSTRAINT `daily_productivity_rollups_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `holidays` ADD CONSTRAINT `holidays_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
