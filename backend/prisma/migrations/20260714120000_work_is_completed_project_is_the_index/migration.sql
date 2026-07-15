-- ============================================================================
--  An entry is a record of work ALREADY DONE, and PROJECT is its index.
--
--  WHAT THIS DOES
--    · drops task_entries.status    — every logged hour is completed work
--    · drops task_entries.priority  — an hour you have already lived cannot be
--                                     re-prioritised
--    · drops task_entries.moduleId + the project_modules table entirely
--    · makes task_entries.projectId NOT NULL
--    · drops the six status counters from daily_productivity_rollups
--
--  THE DANGEROUS STEP, AND WHY IT IS ORDERED THE WAY IT IS
--  `MODIFY projectId ... NOT NULL` is not safe on its own. Every hour logged
--  before today has projectId = NULL. Run the ALTER first and MySQL does not
--  refuse — in a non-strict session it quietly rewrites those NULLs to '', a
--  project id that matches nothing, and the foreign key we add at the end then
--  fails on data we have already corrupted. Months of work, orphaned, by an
--  ALTER that "succeeded".
--
--  So the backfill comes FIRST:
--    1. give every department an "Internal / Non-project" project
--    2. point every orphaned hour at its own department's one
--    3. only then tighten the column and add the FK
--
--  Step 3 is now provably a no-op on data: there is nothing left to break.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Drop the FKs we are about to replace. project_modules goes with them.
-- ---------------------------------------------------------------------------
ALTER TABLE `project_modules` DROP FOREIGN KEY `project_modules_projectId_fkey`;
ALTER TABLE `task_entries`   DROP FOREIGN KEY `task_entries_moduleId_fkey`;
ALTER TABLE `task_entries`   DROP FOREIGN KEY `task_entries_projectId_fkey`;

-- ---------------------------------------------------------------------------
-- 1. Every department gets its catch-all project.
--
--    projectId is about to become mandatory. A mandatory field with no honest
--    answer is worse than no field: the two-hour all-hands, the day of
--    interviews, the incident that belonged to nothing — people will either
--    attribute them to a real project (poisoning that project's numbers) or
--    skip the hour entirely (poisoning compliance). Give them somewhere true
--    to put it.
--
--    The id is derived from the department id, so this is deterministic and
--    re-runnable rather than depending on a UUID function.
-- ---------------------------------------------------------------------------
ALTER TABLE `projects` ADD COLUMN `isInternal` BOOLEAN NOT NULL DEFAULT false;

INSERT INTO `projects`
  (`id`, `departmentId`, `code`, `name`, `description`, `status`, `isInternal`, `createdAt`, `updatedAt`)
SELECT
  CONCAT('internal_', d.`id`),
  d.`id`,
  'INTERNAL',
  'Internal / Non-project',
  'Meetings, admin, training, interviews, support — work that genuinely belongs to no project. Every department has exactly one.',
  'ACTIVE',
  true,
  NOW(3),
  NOW(3)
FROM `departments` d
WHERE NOT EXISTS (
  SELECT 1 FROM `projects` p
  WHERE p.`departmentId` = d.`id` AND p.`code` = 'INTERNAL'
);

-- ---------------------------------------------------------------------------
-- 2. Adopt the orphans. Each entry already carries a denormalised departmentId,
--    so every one of them has a home to go to.
-- ---------------------------------------------------------------------------
UPDATE `task_entries` e
JOIN `projects` p
  ON p.`departmentId` = e.`departmentId`
 AND p.`code` = 'INTERNAL'
SET e.`projectId` = p.`id`
WHERE e.`projectId` IS NULL;

-- ---------------------------------------------------------------------------
-- 3. NOW it is safe. There are no NULLs left, so this ALTER cannot corrupt a
--    row and the FK below cannot fail.
-- ---------------------------------------------------------------------------
DROP INDEX `task_entries_priority_workDate_idx` ON `task_entries`;
DROP INDEX `task_entries_status_workDate_idx` ON `task_entries`;

ALTER TABLE `task_entries`
  DROP COLUMN `moduleId`,
  DROP COLUMN `priority`,
  DROP COLUMN `status`,
  MODIFY `projectId` VARCHAR(191) NOT NULL;

CREATE INDEX `task_entries_projectId_userId_idx` ON `task_entries`(`projectId`, `userId`);

-- RESTRICT, not SET NULL: the column is NOT NULL now, so a project with hours
-- behind it must not be deletable. The service archives instead.
ALTER TABLE `task_entries`
  ADD CONSTRAINT `task_entries_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

DROP TABLE `project_modules`;

-- ---------------------------------------------------------------------------
-- 4. The rollup's six status counters were six copies of the same number the
--    moment status stopped existing. Replaced with the one aggregate that a
--    raw hour count cannot give you: how many distinct projects a person was
--    pulled across in a day.
-- ---------------------------------------------------------------------------
ALTER TABLE `daily_productivity_rollups`
  DROP COLUMN `blocked`,
  DROP COLUMN `completed`,
  DROP COLUMN `inProgress`,
  DROP COLUMN `notStarted`,
  DROP COLUMN `onHold`,
  DROP COLUMN `testing`,
  ADD COLUMN `projectsTouched` INTEGER NOT NULL DEFAULT 0;
