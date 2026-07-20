-- Project MODULES (the parts a project is made of, each with its own status)
-- and AI_INSIGHTS (what the two-hourly analyser concluded, written down before
-- anyone is notified).
--
-- Entirely additive: two new tables, one nullable column on assignments, and
-- two enum values appended. Nothing existing is altered or dropped, so there is
-- no path here that can lose a row.
-- AlterTable
ALTER TABLE `assignments` ADD COLUMN `moduleId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `notifications` MODIFY `type` ENUM('MISSED_HOURLY_UPDATE', 'TEAM_COMPLIANCE_ALERT', 'DAILY_SUMMARY', 'TASK_APPROVED', 'TASK_REJECTED', 'TASK_EDITED_BY_LEAD', 'TASK_ASSIGNED', 'ASSIGNMENT_DUE_SOON', 'ASSIGNMENT_OVERDUE', 'ASSIGNMENT_SUBMITTED', 'ASSIGNMENT_COMPLETED', 'ASSIGNMENT_REOPENED', 'AI_WORK_ALIGNMENT', 'ACCOUNT', 'SYSTEM') NOT NULL;

-- CreateTable
CREATE TABLE `project_modules` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `description` TEXT NULL,
    `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'PENDING',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `project_modules_projectId_status_idx`(`projectId`, `status`),
    UNIQUE INDEX `project_modules_projectId_name_key`(`projectId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ai_insights` (
    `id` VARCHAR(191) NOT NULL,
    `windowStart` DATETIME(3) NOT NULL,
    `windowEnd` DATETIME(3) NOT NULL,
    `departmentId` VARCHAR(191) NOT NULL,
    `teamId` VARCHAR(191) NULL,
    `userId` VARCHAR(191) NULL,
    `userName` VARCHAR(160) NULL,
    `assignmentId` VARCHAR(191) NULL,
    `kind` ENUM('MISALIGNED', 'IDLE', 'LOW_SUBSTANCE', 'AT_RISK', 'ON_TRACK') NOT NULL,
    `severity` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'INFO',
    `alignmentScore` INTEGER NULL,
    `finding` TEXT NOT NULL,
    `recommendation` TEXT NULL,
    `evidence` JSON NULL,
    `model` VARCHAR(64) NOT NULL,
    `dedupeKey` VARCHAR(190) NULL,
    `acknowledgedById` VARCHAR(191) NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ai_insights_dedupeKey_key`(`dedupeKey`),
    INDEX `ai_insights_departmentId_createdAt_idx`(`departmentId`, `createdAt`),
    INDEX `ai_insights_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `ai_insights_kind_severity_idx`(`kind`, `severity`),
    INDEX `ai_insights_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `project_modules` ADD CONSTRAINT `project_modules_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignments` ADD CONSTRAINT `assignments_moduleId_fkey` FOREIGN KEY (`moduleId`) REFERENCES `project_modules`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_insights` ADD CONSTRAINT `ai_insights_departmentId_fkey` FOREIGN KEY (`departmentId`) REFERENCES `departments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_insights` ADD CONSTRAINT `ai_insights_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_insights` ADD CONSTRAINT `ai_insights_assignmentId_fkey` FOREIGN KEY (`assignmentId`) REFERENCES `assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ai_insights` ADD CONSTRAINT `ai_insights_acknowledgedById_fkey` FOREIGN KEY (`acknowledgedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
