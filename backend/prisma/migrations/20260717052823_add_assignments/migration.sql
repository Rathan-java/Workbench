-- AlterTable
ALTER TABLE `audit_logs` MODIFY `action` ENUM('LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'TOKEN_REFRESH', 'TOKEN_REUSE_DETECTED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'PASSWORD_CHANGED', 'PASSWORD_RESET_BY_ADMIN', 'PROFILE_UPDATED', 'AVATAR_UPLOADED', 'USER_CREATED', 'USER_UPDATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'USER_DELETED', 'ROLE_CHANGED', 'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DELETED', 'TEAM_LEAD_ASSIGNED', 'TEAM_MEMBER_ASSIGNED', 'PROJECT_CREATED', 'PROJECT_UPDATED', 'PROJECT_DELETED', 'DEPARTMENT_CREATED', 'DEPARTMENT_UPDATED', 'DEPARTMENT_DELETED', 'TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED', 'TASK_EDITED_BY_LEAD', 'TASK_DAY_SUBMITTED', 'TASK_DAY_APPROVED', 'TASK_DAY_REJECTED', 'TASK_DAY_REOPENED', 'ASSIGNMENT_CREATED', 'ASSIGNMENT_UPDATED', 'ASSIGNMENT_SUBMITTED', 'ASSIGNMENT_COMPLETED', 'ASSIGNMENT_REOPENED', 'ASSIGNMENT_CANCELLED', 'REPORT_EXPORTED', 'SETTING_UPDATED', 'RETENTION_CLEANUP') NOT NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('MISSED_HOURLY_UPDATE', 'TEAM_COMPLIANCE_ALERT', 'DAILY_SUMMARY', 'TASK_APPROVED', 'TASK_REJECTED', 'TASK_EDITED_BY_LEAD', 'TASK_ASSIGNED', 'ASSIGNMENT_DUE_SOON', 'ASSIGNMENT_OVERDUE', 'ASSIGNMENT_SUBMITTED', 'ASSIGNMENT_COMPLETED', 'ASSIGNMENT_REOPENED', 'ACCOUNT', 'SYSTEM') NOT NULL;

-- AlterTable
ALTER TABLE `task_entries` ADD COLUMN `assignmentId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `assignments` (
    `id` VARCHAR(191) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `assigneeId` VARCHAR(191) NULL,
    `assigneeName` VARCHAR(160) NULL,
    `assigneeCode` VARCHAR(32) NULL,
    `assignedById` VARCHAR(191) NULL,
    `assignedByName` VARCHAR(160) NULL,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DONE', 'CANCELLED') NOT NULL DEFAULT 'ASSIGNED',
    `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `dueDate` DATE NULL,
    `estimatedHours` INTEGER NULL,
    `submittedAt` DATETIME(3) NULL,
    `reviewedById` VARCHAR(191) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `reviewNote` TEXT NULL,
    `completedAt` DATETIME(3) NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `aiSummary` TEXT NULL,
    `aiRiskScore` INTEGER NULL,
    `createdById` VARCHAR(191) NULL,
    `updatedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `assignments_departmentId_status_idx`(`departmentId`, `status`),
    INDEX `assignments_assigneeId_status_idx`(`assigneeId`, `status`),
    INDEX `assignments_teamId_status_idx`(`teamId`, `status`),
    INDEX `assignments_projectId_idx`(`projectId`),
    INDEX `assignments_dueDate_idx`(`dueDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignment_transitions` (
    `id` VARCHAR(191) NOT NULL,
    `assignmentId` VARCHAR(191) NOT NULL,
    `from` ENUM('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DONE', 'CANCELLED') NOT NULL,
    `to` ENUM('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'DONE', 'CANCELLED') NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `actorName` VARCHAR(160) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assignment_transitions_assignmentId_createdAt_idx`(`assignmentId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `task_entries_assignmentId_workDate_idx` ON `task_entries`(`assignmentId`, `workDate`);

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_teamId_fkey` FOREIGN KEY (`teamId`) REFERENCES `teams`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_reviewedById_fkey` FOREIGN KEY (`reviewedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_transitions` ADD CONSTRAINT `assignment_transitions_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `assignments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_transitions` ADD CONSTRAINT `assignment_transitions_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
