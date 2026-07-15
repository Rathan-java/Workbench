-- A name is whatever the person says it is.
--
-- lastName was NOT NULL, which forced every mononymous employee — a single legal
-- name, common across South India and much of the world — to invent a second
-- one. That invented value then rode along in every report, email and export.
--
-- Widening NOT NULL to NULL never touches existing rows: every current lastName
-- is a valid nullable value. This is a pure relaxation, safe on any data.
ALTER TABLE `users` MODIFY `lastName` VARCHAR(80) NULL;
