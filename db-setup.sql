-- Ara Workbench application database and restricted runtime user.
-- Run this manually as the Azure MySQL admin user after azure-setup.sh creates
-- the server.
--
-- Important:
-- The runtime user below is intentionally CRUD-only. Prisma migrations need DDL
-- privileges such as CREATE/ALTER/DROP/INDEX, so run migrations separately with
-- the admin account or a temporary migration user, then deploy the app with this
-- restricted user.

CREATE DATABASE IF NOT EXISTS `ara_workbench`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'ara_workbench_app'@'%'
  IDENTIFIED BY 'CHANGE_ME_STRONG_APP_USER_PASSWORD';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON `ara_workbench`.*
  TO 'ara_workbench_app'@'%';

FLUSH PRIVILEGES;

-- Optional verification:
-- SHOW GRANTS FOR 'ara_workbench_app'@'%';
