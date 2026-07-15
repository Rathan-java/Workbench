-- DropForeignKey
ALTER TABLE `daily_productivity_rollups` DROP FOREIGN KEY `daily_productivity_rollups_userId_fkey`;

-- DropForeignKey
ALTER TABLE `task_days` DROP FOREIGN KEY `task_days_userId_fkey`;

-- DropForeignKey
ALTER TABLE `task_entries` DROP FOREIGN KEY `task_entries_userId_fkey`;

-- AlterTable
ALTER TABLE `daily_productivity_rollups` ADD COLUMN `employeeName` VARCHAR(160) NULL,
    MODIFY `userId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `task_days` ADD COLUMN `employeeCode` VARCHAR(32) NULL,
    ADD COLUMN `employeeName` VARCHAR(160) NULL,
    MODIFY `userId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `task_entries` ADD COLUMN `employeeCode` VARCHAR(32) NULL,
    ADD COLUMN `employeeName` VARCHAR(160) NULL,
    MODIFY `userId` VARCHAR(191) NULL;

-- AddForeignKey
ALTER TABLE `task_days` ADD CONSTRAINT `task_days_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_productivity_rollups` ADD CONSTRAINT `daily_productivity_rollups_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

