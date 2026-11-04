CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`language` text NOT NULL,
	`redacted_messages` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "conversations_status_check" CHECK("conversations"."status" IN ('OPEN', 'CLOSED', 'HANDED_OFF'))
);
--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`resource_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "idempotency_keys_scope_check" CHECK("idempotency_keys"."scope" IN ('ORDER', 'DOCUMENT_UPLOAD'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_keys_unique` ON `idempotency_keys` (`owner_id`,`scope`,`key`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`order_id` text NOT NULL,
	`template_code` text NOT NULL,
	`params` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_order_index` ON `notifications` (`order_id`);--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`type` text NOT NULL,
	`stage` text,
	`reason_code` text,
	`new_date` text,
	`occurred_on` text NOT NULL,
	`simulated` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_events_type_check" CHECK("order_events"."type" IN ('ORDER_PLACED', 'STAGE_ADVANCED', 'DELAY_MARKED', 'PAYMENT_FAILED', 'PAYMENT_CONFIRMED', 'ORDER_CANCELLED')),
	CONSTRAINT "order_events_simulated_check" CHECK("order_events"."simulated" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `order_events_order_index` ON `order_events` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`kyc_application_id` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`placed_on` text NOT NULL,
	`plan` text NOT NULL,
	`delay` text,
	`payment_status` text NOT NULL,
	`amount_due_inr` integer NOT NULL,
	`monthly_total_inr` integer NOT NULL,
	`setup_total_inr` integer NOT NULL,
	`contract_months` integer NOT NULL,
	`activated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kyc_application_id`) REFERENCES `kyc_applications`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" IN ('ACTIVE', 'CANCELLED')),
	CONSTRAINT "orders_stage_check" CHECK("orders"."stage" IN ('ORDER_PLACED', 'KYC_CONFIRMED', 'PAYMENT_CONFIRMED', 'INSTALL_SCHEDULED', 'INSTALLING', 'ACTIVATED')),
	CONSTRAINT "orders_payment_status_check" CHECK("orders"."payment_status" IN ('PENDING', 'FAILED', 'PAID'))
);
--> statement-breakpoint
CREATE INDEX `orders_owner_index` ON `orders` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_live_quote_unique` ON `orders` (`quote_id`) WHERE "orders"."status" <> 'CANCELLED';--> statement-breakpoint
CREATE TABLE `payment_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`outcome` text NOT NULL,
	`amount_inr` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "payment_attempts_outcome_check" CHECK("payment_attempts"."outcome" IN ('SUCCESS', 'FAILED'))
);
--> statement-breakpoint
CREATE INDEX `payment_attempts_order_index` ON `payment_attempts` (`order_id`);--> statement-breakpoint
CREATE TABLE `quote_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`quote_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`unit_price_inr` integer NOT NULL,
	`monthly_inr` integer NOT NULL,
	`setup_inr` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quote_lines_quantity_check" CHECK("quote_lines"."quantity" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quote_lines_quote_product_unique` ON `quote_lines` (`quote_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`city_tier` integer,
	`employee_count` integer,
	`num_sites` integer,
	`gstin_status` text NOT NULL,
	`fibre_available` integer,
	`monthly_total_inr` integer NOT NULL,
	`setup_total_inr` integer NOT NULL,
	`contract_months` integer NOT NULL,
	`install_days` integer NOT NULL,
	`saved_at` text,
	`accepted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "quotes_status_check" CHECK("quotes"."status" IN ('DRAFT', 'SAVED', 'ACCEPTED', 'NEEDS_ACCEPTANCE')),
	CONSTRAINT "quotes_gstin_status_check" CHECK("quotes"."gstin_status" IN ('ACTIVE', 'CANCELLED', 'SUSPENDED', 'NONE', 'UNKNOWN')),
	CONSTRAINT "quotes_fibre_check" CHECK("quotes"."fibre_available" IS NULL OR "quotes"."fibre_available" IN (0, 1)),
	CONSTRAINT "quotes_money_check" CHECK("quotes"."monthly_total_inr" >= 0 AND "quotes"."setup_total_inr" >= 0)
);
--> statement-breakpoint
CREATE INDEX `quotes_owner_index` ON `quotes` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `simulation_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "simulation_flags_id_check" CHECK("simulation_flags"."id" IN ('REGISTRY_OUTAGE')),
	CONSTRAINT "simulation_flags_enabled_check" CHECK("simulation_flags"."enabled" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_ref` text NOT NULL,
	`action` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text,
	`request_id` text,
	`metadata` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_object_index` ON `audit_log` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `consents` (
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
	CONSTRAINT "consents_purpose_check" CHECK("consents"."purpose_id" IN ('advisor_profile', 'kyc_verification', 'service_updates', 'marketing')),
	CONSTRAINT "consents_status_check" CHECK("consents"."status" IN ('GRANTED', 'DECLINED', 'WITHDRAWN', 'ERASURE_PENDING', 'ERASED', 'EXPIRED')),
	CONSTRAINT "consents_channel_check" CHECK("consents"."channel" IN ('WEB', 'SESSION_MERGE'))
);
--> statement-breakpoint
CREATE INDEX `consents_subject_purpose_index` ON `consents` (`subject_ref`,`purpose_id`);--> statement-breakpoint
CREATE TABLE `otp_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`phone_hash` text NOT NULL,
	`phone_last4` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "otp_challenges_attempts_check" CHECK("otp_challenges"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_ref` text NOT NULL,
	`status` text NOT NULL,
	`phone_hash` text,
	`phone_last4` text,
	`phone_verified_at` text,
	`merged_into_owner_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merged_into_owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "owners_status_check" CHECK("owners"."status" IN ('ANONYMOUS', 'VERIFIED', 'MERGED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_subject_ref_unique` ON `owners` (`subject_ref`);--> statement-breakpoint
CREATE UNIQUE INDEX `owners_phone_hash_unique` ON `owners` (`phone_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`ended_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_owner_index` ON `sessions` (`owner_id`);--> statement-breakpoint
CREATE TABLE `kyc_applications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`status` text NOT NULL,
	`verdict` text,
	`bundle_needs_gstin` integer NOT NULL,
	`gstin_confirmed` integer NOT NULL,
	`contact_name_source` text,
	`sealed_identity` text,
	`quote_change` text,
	`assessed_at` text,
	`verified_at` text,
	`erased_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "kyc_applications_status_check" CHECK("kyc_applications"."status" IN ('OPEN', 'WITHDRAWN', 'ERASED')),
	CONSTRAINT "kyc_applications_contact_source_check" CHECK("kyc_applications"."contact_name_source" IN ('OWNER', 'LEAD_PREFILL')),
	CONSTRAINT "kyc_applications_verdict_check" CHECK("kyc_applications"."verdict" IN ('VERIFIED', 'RETAKE', 'NEEDS_CONFIRMATION', 'VERIFICATION_PENDING', 'MANUAL_REVIEW', 'REJECTED')),
	CONSTRAINT "kyc_applications_flags_check" CHECK("kyc_applications"."bundle_needs_gstin" IN (0, 1) AND "kyc_applications"."gstin_confirmed" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `kyc_applications_owner_index` ON `kyc_applications` (`owner_id`,`id`);--> statement-breakpoint
CREATE INDEX `kyc_applications_quote_index` ON `kyc_applications` (`quote_id`);--> statement-breakpoint
CREATE TABLE `kyc_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`application_id` text NOT NULL,
	`check_id` text NOT NULL,
	`severity` text NOT NULL,
	`outcome` text NOT NULL,
	`on_fail` text NOT NULL,
	`sealed_evidence` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`application_id`) REFERENCES `kyc_applications`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kyc_checks_check_id_check" CHECK("kyc_checks"."check_id" IN ('GST_DOCUMENT', 'GST_FORMAT', 'GST_FOUND', 'GST_STATUS', 'GST_NAME', 'GST_ADDRESS', 'GST_STATE', 'UDYAM_PRESENT', 'UDYAM_NAME', 'UDYAM_DATE', 'UDYAM_ACTIVITY', 'ADDRESS_DOCUMENT', 'ADDRESS_MATCH', 'ADDRESS_AGE', 'BILL_NAME', 'SIGNATORY_DOCUMENT', 'SIGNATORY_NAME', 'SIGNATORY_VALID', 'SIGNATORY_BUSINESS')),
	CONSTRAINT "kyc_checks_severity_check" CHECK("kyc_checks"."severity" IN ('HARD', 'SOFT', 'ADVISORY')),
	CONSTRAINT "kyc_checks_outcome_check" CHECK("kyc_checks"."outcome" IN ('PASS', 'FAIL', 'SKIPPED', 'PENDING')),
	CONSTRAINT "kyc_checks_on_fail_check" CHECK("kyc_checks"."on_fail" IN ('REJECTED', 'RETAKE', 'NEEDS_CONFIRMATION', 'MANUAL_REVIEW', 'NONE'))
);
--> statement-breakpoint
CREATE INDEX `kyc_checks_application_index` ON `kyc_checks` (`application_id`);--> statement-breakpoint
CREATE TABLE `kyc_documents` (
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
	CONSTRAINT "kyc_documents_type_check" CHECK("kyc_documents"."document_type" IN ('GST_CERTIFICATE', 'UDYAM_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF')),
	CONSTRAINT "kyc_documents_detected_type_check" CHECK("kyc_documents"."detected_type" IN ('GST_CERTIFICATE', 'UDYAM_CERTIFICATE', 'SIGNATORY_ID', 'ADDRESS_PROOF')),
	CONSTRAINT "kyc_documents_quality_check" CHECK("kyc_documents"."quality" IN ('OK', 'BLURRED', 'UNREADABLE', 'WRONG_TYPE'))
);
--> statement-breakpoint
CREATE INDEX `kyc_documents_application_index` ON `kyc_documents` (`application_id`,`document_type`);--> statement-breakpoint
CREATE TABLE `gst_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`trade_name` text NOT NULL,
	`constitution` text NOT NULL,
	`principal_place_of_business` text NOT NULL,
	`state` text NOT NULL,
	`registration_date` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "gst_registry_status_check" CHECK("gst_registry"."status" IN ('Active', 'Cancelled', 'Suspended'))
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`created_date` text NOT NULL,
	`lead_source` text NOT NULL,
	`business_name` text NOT NULL,
	`business_type` text NOT NULL,
	`segment` text NOT NULL,
	`city` text NOT NULL,
	`city_tier` integer NOT NULL,
	`state` text NOT NULL,
	`preferred_language` text NOT NULL,
	`employee_count` integer NOT NULL,
	`num_sites` integer NOT NULL,
	`gstin` text,
	`udyam_number` text,
	`contact_name` text NOT NULL,
	`contact_role` text NOT NULL,
	`stage_reached` text NOT NULL,
	`outcome` text NOT NULL,
	`drop_reason` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `leads_gstin_index` ON `leads` (`gstin`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`unit` text NOT NULL,
	`price_min_inr` integer NOT NULL,
	`price_max_inr` integer NOT NULL,
	`setup_inr` integer NOT NULL,
	`min_contract_months` integer NOT NULL,
	`city_tiers` text NOT NULL,
	`min_employees` integer NOT NULL,
	`min_sites` integer NOT NULL,
	`requires_gstin` integer NOT NULL,
	`requires_one_of` text NOT NULL,
	`install_days` integer NOT NULL,
	`target_segments` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "products_price_range_check" CHECK("products"."price_min_inr" <= "products"."price_max_inr"),
	CONSTRAINT "products_requires_gstin_check" CHECK("products"."requires_gstin" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `udyam_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`enterprise_name` text NOT NULL,
	`enterprise_type` text NOT NULL,
	`major_activity` text NOT NULL,
	`nic_description` text NOT NULL,
	`state` text NOT NULL,
	`city` text NOT NULL,
	`date_of_registration` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
