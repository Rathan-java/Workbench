-- WHO IS ON A PROJECT.
--
-- Until now nobody belonged to a project: people belonged to departments and
-- teams, projects belonged to departments, and the only trace of who worked on
-- what was whoever happened to have logged an hour. That answers a question
-- about the past; it cannot say who is ON Schoolmate before the first hour is
-- logged, and it cannot be corrected when it is wrong.
CREATE TABLE `project_members` (
  `id`        VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `userId`    VARCHAR(191) NOT NULL,
  `addedById` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `project_members_projectId_userId_key`(`projectId`, `userId`),
  INDEX `project_members_userId_idx`(`userId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_members`
  ADD CONSTRAINT `project_members_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `project_members_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `project_members_addedById_fkey` FOREIGN KEY (`addedById`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- BACKFILL, so the feature is true on the day it ships rather than presenting
-- every existing project as unstaffed.
--
-- Two sources of the same fact, both stronger than a guess: somebody who has
-- logged hours against a project has demonstrably worked on it, and somebody
-- holding an assignment on it has demonstrably been put on it. The internal
-- "Non-project" catch-all is excluded — everyone logs to it, so treating that
-- as membership would make every employee a member of it and mean nothing.
INSERT IGNORE INTO `project_members` (`id`, `projectId`, `userId`, `addedById`, `createdAt`)
SELECT UUID(), t.`projectId`, t.`userId`, NULL, NOW(3)
FROM (
  SELECT DISTINCT e.`projectId`, e.`userId`
  FROM `task_entries` e
  JOIN `projects` p ON p.`id` = e.`projectId`
  WHERE e.`userId` IS NOT NULL AND p.`isInternal` = 0
  UNION
  SELECT DISTINCT a.`projectId`, a.`assigneeId` AS `userId`
  FROM `assignments` a
  JOIN `projects` p ON p.`id` = a.`projectId`
  WHERE a.`assigneeId` IS NOT NULL AND p.`isInternal` = 0
) t;
