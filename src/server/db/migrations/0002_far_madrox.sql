PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_kyc_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`document_type` text NOT NULL,
	`quality` text NOT NULL,
	`detected_type` text,
	`sealed_fields` text,
	`storage_key` text,
	`ocr_confidence` real,
	`blur_score` real,
	`rotation_degrees` real,
	`superseded_at` text,
	`file_deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `kyc_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kyc_documents_type_check" CHECK("__new_kyc_documents"."document_type" IN ('GST_CERTIFICATE', 'UDYAM_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF')),
	CONSTRAINT "kyc_documents_detected_type_check" CHECK("__new_kyc_documents"."detected_type" IN ('GST_CERTIFICATE', 'UDYAM_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF')),
	CONSTRAINT "kyc_documents_quality_check" CHECK("__new_kyc_documents"."quality" IN ('OK', 'BLURRED', 'UNREADABLE', 'WRONG_TYPE', 'PENDING_READ'))
);
--> statement-breakpoint
INSERT INTO `__new_kyc_documents`("id", "application_id", "document_type", "quality", "detected_type", "sealed_fields", "storage_key", "ocr_confidence", "blur_score", "rotation_degrees", "superseded_at", "file_deleted_at", "created_at", "updated_at") SELECT "id", "application_id", "document_type", "quality", "detected_type", "sealed_fields", "storage_key", "ocr_confidence", "blur_score", "rotation_degrees", "superseded_at", "file_deleted_at", "created_at", "updated_at" FROM `kyc_documents`;--> statement-breakpoint
DROP TABLE `kyc_documents`;--> statement-breakpoint
ALTER TABLE `__new_kyc_documents` RENAME TO `kyc_documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `kyc_documents_application_index` ON `kyc_documents` (`application_id`,`document_type`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `facts` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `handoff_reason` text;