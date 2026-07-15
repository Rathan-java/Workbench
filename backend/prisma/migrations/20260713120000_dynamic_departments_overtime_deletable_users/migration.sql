-- DropForeignKey
ALTER TABLE `task_day_transitions` DROP FOREIGN KEY `task_day_transitions_actorId_fkey`;

-- DropForeignKey
ALTER TABLE `task_entries` DROP FOREIGN KEY `task_entries_createdById_fkey`;

-- DropForeignKey
ALTER TABLE `task_entries` DROP FOREIGN KEY `task_entries_updatedById_fkey`;

-- DropForeignKey
ALTER TABLE `task_entry_revisions` DROP FOREIGN KEY `task_entry_revisions_actorId_fkey`;

-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `dedupeKey` VARCHAR(160) NULL;

-- AlterTable
ALTER TABLE `task_day_transitions` ADD COLUMN `actorName` VARCHAR(160) NULL,
    MODIFY `actorId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `task_entries` MODIFY `createdById` VARCHAR(191) NULL,
    MODIFY `updatedById` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `task_entry_revisions` ADD COLUMN `actorName` VARCHAR(160) NULL,
    MODIFY `actorId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `time_slots` ADD COLUMN `isOvertime` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX `notifications_dedupeKey_key` ON `notifications`(`dedupeKey`);

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_entry_revisions` ADD CONSTRAINT `task_entry_revisions_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_day_transitions` ADD CONSTRAINT `task_day_transitions_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

