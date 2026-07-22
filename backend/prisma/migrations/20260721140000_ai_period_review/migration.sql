-- The on-demand period review: Management picks a department and a span of days
-- and asks the analyser to look at the whole period at once.
--
-- Two additions:
--   NO_PROGRESS  a finding only a period review can reach — the same work
--                described repeatedly in different words while the thing it
--                refers to has not advanced.
--   isReview     separates deliberate reviews from scheduled findings, because
--                "today is going wrong" and "this person has not moved in a
--                fortnight" are different claims and must not read as one list.
ALTER TABLE `ai_insights`
  MODIFY COLUMN `kind` ENUM('MISALIGNED','IDLE','LOW_SUBSTANCE','AT_RISK','NO_PROGRESS','ON_TRACK') NOT NULL;

ALTER TABLE `ai_insights`
  ADD COLUMN `isReview` BOOLEAN NOT NULL DEFAULT false;

-- Reviews are listed and filtered on their own; every existing row is a
-- scheduled finding, which the default already records correctly.
CREATE INDEX `ai_insights_isReview_createdAt_idx` ON `ai_insights`(`isReview`, `createdAt`);
