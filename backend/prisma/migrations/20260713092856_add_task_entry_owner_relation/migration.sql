-- AddForeignKey
ALTER TABLE `task_entries` ADD CONSTRAINT `task_entries_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
