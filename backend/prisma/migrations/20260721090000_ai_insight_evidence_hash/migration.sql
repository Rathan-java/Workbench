-- A fingerprint of the substantive evidence behind a finding, so a later run can
-- tell "nothing has changed since I judged this" from "this needs judging again".
-- Nullable: rows written before this column existed have no fingerprint, and are
-- correctly treated as "unknown", i.e. re-analysed.
ALTER TABLE `ai_insights`
  ADD COLUMN `evidenceHash` VARCHAR(64) NULL;
