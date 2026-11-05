PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_ref` text NOT NULL,
	`purpose_id` text NOT NULL,
	`notice_version` text NOT NULL,
	`language` text NOT NULL,
	`status` text NOT NULL,
	`granted_at` text,
	`withdrawn_at` text,
	`channel` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "consents_purpose_check" CHECK("__new_consents"."purpose_id" IN ('advisor_profile', 'ai_chat', 'kyc_verification', 'service_updates', 'marketing')),
	CONSTRAINT "consents_status_check" CHECK("__new_consents"."status" IN ('GRANTED', 'DECLINED', 'WITHDRAWN', 'ERASURE_PENDING', 'ERASED', 'EXPIRED')),
	CONSTRAINT "consents_channel_check" CHECK("__new_consents"."channel" IN ('WEB', 'SESSION_MERGE'))
);
--> statement-breakpoint
INSERT INTO `__new_consents`("id", "subject_ref", "purpose_id", "notice_version", "language", "status", "granted_at", "withdrawn_at", "channel", "created_at", "updated_at") SELECT "id", "subject_ref", "purpose_id", "notice_version", "language", "status", "granted_at", "withdrawn_at", "channel", "created_at", "updated_at" FROM `consents`;--> statement-breakpoint
DROP TABLE `consents`;--> statement-breakpoint
ALTER TABLE `__new_consents` RENAME TO `consents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `consents_subject_purpose_index` ON `consents` (`subject_ref`,`purpose_id`);--> statement-breakpoint
-- Rebuilding the table drops its triggers, so consents is made append-only again here.
CREATE TRIGGER `consents_no_update` BEFORE UPDATE ON `consents`
BEGIN
  SELECT RAISE(ABORT, 'consents is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `consents_no_delete` BEFORE DELETE ON `consents`
BEGIN
  SELECT RAISE(ABORT, 'consents is append-only');
END;
