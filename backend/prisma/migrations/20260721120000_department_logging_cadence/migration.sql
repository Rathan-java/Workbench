-- The logging cadence becomes department configuration.
--
-- Defaults reproduce exactly what every department does today (a 10:00-18:00 day
-- in 60-minute blocks), so this migration changes no behaviour on its own. The
-- grid is still driven by the time_slots rows; these columns are the input a
-- rebuild is generated from.
ALTER TABLE `departments`
  ADD COLUMN `slotIntervalMinutes` INT NOT NULL DEFAULT 60,
  ADD COLUMN `dayStartMinute`      INT NOT NULL DEFAULT 600,
  ADD COLUMN `dayEndMinute`        INT NOT NULL DEFAULT 1080,
  ADD COLUMN `breakStartMinute`    INT NULL,
  ADD COLUMN `breakEndMinute`      INT NULL;

-- Backfill each department's real working day from the slots it already has, so
-- the settings screen opens showing the truth rather than the default. Overtime
-- columns are excluded: they sit beyond the working day by definition, and
-- including them would make every rebuild grow the day by an hour.
UPDATE `departments` d
JOIN (
  SELECT
    `departmentId`,
    MIN(`startMinute`) AS dayStart,
    MAX(`endMinute`)   AS dayEnd,
    MIN(`endMinute` - `startMinute`) AS interval_minutes
  FROM `time_slots`
  WHERE `isActive` = 1 AND `isOvertime` = 0
  GROUP BY `departmentId`
) s ON s.`departmentId` = d.`id`
SET
  d.`dayStartMinute`      = s.dayStart,
  d.`dayEndMinute`        = s.dayEnd,
  d.`slotIntervalMinutes` = GREATEST(s.interval_minutes, 15);

-- And the existing break block, where one is defined.
UPDATE `departments` d
JOIN (
  SELECT `departmentId`, MIN(`startMinute`) AS bs, MAX(`endMinute`) AS be
  FROM `time_slots`
  WHERE `isActive` = 1 AND `isBreak` = 1
  GROUP BY `departmentId`
) b ON b.`departmentId` = d.`id`
SET d.`breakStartMinute` = b.bs, d.`breakEndMinute` = b.be;
