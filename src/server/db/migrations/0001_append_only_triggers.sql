-- consents and audit_log are append-only, per CLAUDE.md. Enforced in the database, so no code path can edit history.
CREATE TRIGGER `consents_no_update` BEFORE UPDATE ON `consents`
BEGIN
  SELECT RAISE(ABORT, 'consents is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `consents_no_delete` BEFORE DELETE ON `consents`
BEGIN
  SELECT RAISE(ABORT, 'consents is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_update` BEFORE UPDATE ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_log_no_delete` BEFORE DELETE ON `audit_log`
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
