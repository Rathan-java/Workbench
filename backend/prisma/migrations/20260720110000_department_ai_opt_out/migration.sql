-- Per-department opt-out from AI analysis.
--
-- Defaults to TRUE so every existing department keeps behaving exactly as it
-- does today. Turning it off is a deliberate, audited act by Management, and it
-- stops the analyser SELECTING those people at all -- their work is never read,
-- so nothing about them can leave the network.
ALTER TABLE `departments`
  ADD COLUMN `aiAnalysisEnabled` BOOLEAN NOT NULL DEFAULT true;
