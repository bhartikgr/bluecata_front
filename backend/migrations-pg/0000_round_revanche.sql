CREATE TABLE "announcement_reads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"announcement_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_chain_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text,
	"table_name" text NOT NULL,
	"verified_count" integer DEFAULT 0 NOT NULL,
	"broken_count" integer DEFAULT 0 NOT NULL,
	"broken_first_id" text,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text NOT NULL,
	"details_json" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"target_id" text,
	"payload_json" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "bridge_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"aggregate_kind" text NOT NULL,
	"envelope_json" text NOT NULL,
	"hmac" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_retry_at" integer,
	"enqueued_at" text NOT NULL,
	"delivered_at" text,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "captable_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"seq" integer NOT NULL,
	"ts" text NOT NULL,
	"invitation_id" text NOT NULL,
	"round_id" text NOT NULL,
	"company_id" text NOT NULL,
	"investor_id" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"shares" text NOT NULL,
	"state" text NOT NULL,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"reconcile_primary" text,
	"reconcile_ref" text,
	"reconcile_match" integer DEFAULT 1 NOT NULL,
	"compliance_hold" integer DEFAULT 0 NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "chapter_announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"pinned" integer DEFAULT 0 NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"expires_at" text,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "chapter_leaderboard_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"period" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"data" text DEFAULT '[]' NOT NULL,
	"generated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "chapter_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"uploader_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"resource_type" text DEFAULT 'link' NOT NULL,
	"url" text NOT NULL,
	"file_size_bytes" integer,
	"mime_type" text,
	"tags" text DEFAULT '[]' NOT NULL,
	"visibility" text DEFAULT 'members' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"flag_reason" text,
	"flagged_by_user_id" text,
	"flagged_at" text,
	"download_count" integer DEFAULT 0 NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"city" text,
	"status" text DEFAULT 'active' NOT NULL,
	"admin_user_id" text,
	"partner_org_id" text,
	"membership_fee_annual_minor" integer DEFAULT 0,
	"dsc_quorum_pct" integer DEFAULT 50 NOT NULL,
	"founded" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "collective_apps" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"payload_json" text NOT NULL,
	"submitted_at" text NOT NULL,
	"reviewed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "collective_billing_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"billing_id" text NOT NULL,
	"event_type" text NOT NULL,
	"stripe_event_id" text NOT NULL,
	"raw_payload" text NOT NULL,
	"processed_at" text NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collective_channel_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"author_kind" text DEFAULT 'user' NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'public_to_collective' NOT NULL,
	"liked_by_json" text DEFAULT '[]' NOT NULL,
	"comments_json" text DEFAULT '[]' NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"share_count" integer DEFAULT 0 NOT NULL,
	"topics_json" text,
	"media_urls_json" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"edited_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "collective_memberships" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tier" text DEFAULT 'standard' NOT NULL,
	"activated_at" text NOT NULL,
	"activated_by" text NOT NULL,
	"deactivated_at" text,
	"deactivated_by" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "collective_memberships_billing" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"user_id" text NOT NULL,
	"tier" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"stripe_price_id" text,
	"current_period_start" integer,
	"current_period_end" integer,
	"cancel_at_period_end" integer DEFAULT 0 NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "collective_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"anonymity_level" text DEFAULT 'public' NOT NULL,
	"notify_on_dsc_score" integer DEFAULT 1 NOT NULL,
	"notify_on_deal_room_update" integer DEFAULT 1 NOT NULL,
	"deal_room_visibility" text DEFAULT 'visible' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "collective_waitlist" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text NOT NULL,
	"company_id" text,
	"payload" text NOT NULL,
	"chapter_hint" text,
	"status" text DEFAULT 'waitlist' NOT NULL,
	"created_at" text NOT NULL,
	"reviewed_at" text,
	"reviewed_by" text,
	"deleted_at" text,
	"chapter_id" text
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"sector" text,
	"stage" text,
	"hq" text,
	"website_url" text,
	"description" text,
	"logo_url" text,
	"founded" text,
	"employees" integer,
	"is_demo" integer DEFAULT 0 NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "company_members" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"title" text,
	"tenant_id" text,
	"consortium_partner_id" text,
	"is_active" integer DEFAULT 1 NOT NULL,
	"joined_at" text,
	"last_active_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "company_profile_extended" (
	"company_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"profile_json" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "consortium_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"expected_chapter_id" text,
	"contact_name" text NOT NULL,
	"contact_email" text NOT NULL,
	"contact_phone" text,
	"organization_name" text NOT NULL,
	"website" text,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"partner_type" text DEFAULT 'other' NOT NULL,
	"aum_range" text DEFAULT 'undisclosed' NOT NULL,
	"portfolio_company_count" integer DEFAULT 0 NOT NULL,
	"expected_chapter" text DEFAULT '' NOT NULL,
	"intro_message" text DEFAULT '' NOT NULL,
	"referred_by" text,
	"source_ip" text,
	"source_user_agent" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"reviewed_by_user_id" text,
	"review_notes" text,
	"provisioned_partner_id" text,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"reviewed_at" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"version" integer NOT NULL,
	"prev_revision_hash" text NOT NULL,
	"revision_hash" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL,
	"action" text NOT NULL,
	"snapshot_json" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text,
	"email" text,
	"phone" text,
	"region" text,
	"status" text DEFAULT 'active' NOT NULL,
	"verification" text DEFAULT 'unverified' NOT NULL,
	"metadata_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prev_revision_hash" text NOT NULL,
	"revision_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_delete_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"requested_at" text NOT NULL,
	"confirmed_at" text,
	"initiated_by_user_id" text NOT NULL,
	"reason" text,
	"records_redacted" integer DEFAULT 0 NOT NULL,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_export_log" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"exported_at" text NOT NULL,
	"format" text DEFAULT 'json' NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"request_ip" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataroom_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"company_id" text NOT NULL,
	"ts" text NOT NULL,
	"actor" text NOT NULL,
	"actor_id" text NOT NULL,
	"action" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"meta_json" text
);
--> statement-breakpoint
CREATE TABLE "dataroom_files" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"tenant_id" text DEFAULT 'tenant_unknown' NOT NULL,
	"folder_id" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"mime" text NOT NULL,
	"uploaded_at" text NOT NULL,
	"uploaded_by" text,
	"uploaded_by_id" text,
	"sha256" text DEFAULT '' NOT NULL,
	"watermark" integer DEFAULT 0 NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "dataroom_folders" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"is_round_folder" integer DEFAULT 0 NOT NULL,
	"round_id" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "dataroom_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"investor_id" text NOT NULL,
	"folder_id" text NOT NULL,
	"view" integer DEFAULT 0 NOT NULL,
	"download" integer DEFAULT 0 NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "dsc_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"company_id" text NOT NULL,
	"submitter_user_id" text NOT NULL,
	"tier" text NOT NULL,
	"score_json" text,
	"notes" text,
	"submitted_at" text NOT NULL,
	"created_at" text NOT NULL,
	"deleted_at" text,
	"chapter_id" text
);
--> statement-breakpoint
CREATE TABLE "dsc_pipeline" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"company_id" text NOT NULL,
	"submitted_by" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"submitted_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "dsc_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"promoted_by" text NOT NULL,
	"promoted_at" text NOT NULL,
	"demoted_at" text,
	"demoted_by" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "dsc_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"company_id" text NOT NULL,
	"round_id" text,
	"voter_user_id" text NOT NULL,
	"vote" text NOT NULL,
	"conditions" text,
	"notes" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"cast_at" text NOT NULL,
	"superseded_at" text,
	"deleted_at" text,
	"chapter_id" text
);
--> statement-breakpoint
CREATE TABLE "email_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"audience_type" text NOT NULL,
	"status" text NOT NULL,
	"html_body" text,
	"text_body" text,
	"scheduled_at" text,
	"sent_at" text,
	"recipient_count" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expert_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"question_id" text NOT NULL,
	"responder_user_id" text NOT NULL,
	"body" text NOT NULL,
	"upvote_count" integer DEFAULT 0 NOT NULL,
	"is_best_answer" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"flag_reason" text,
	"flagged_by_user_id" text,
	"flagged_at" text,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "expert_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"asker_user_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"best_answer_id" text,
	"flag_reason" text,
	"flagged_by_user_id" text,
	"flagged_at" text,
	"view_count" integer DEFAULT 0 NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "expert_reputation" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"user_id" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"questions_asked" integer DEFAULT 0 NOT NULL,
	"answers_given" integer DEFAULT 0 NOT NULL,
	"best_answers" integer DEFAULT 0 NOT NULL,
	"upvotes_received" integer DEFAULT 0 NOT NULL,
	"last_milestone_notified" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "expert_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"answer_id" text NOT NULL,
	"voter_user_id" text NOT NULL,
	"vote_type" text NOT NULL,
	"created_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "formulas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"region" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" text NOT NULL,
	"source_code" text,
	"citation_source" text,
	"citation_url" text,
	"def_hash" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_by" text NOT NULL,
	"is_built_in" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founder_collective_applications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"company_id" text NOT NULL,
	"founder_id" text NOT NULL,
	"pitch_deck_filename" text NOT NULL,
	"traction_mrr" integer DEFAULT 0 NOT NULL,
	"traction_users" integer DEFAULT 0 NOT NULL,
	"traction_growth_pct" integer DEFAULT 0 NOT NULL,
	"asks" text NOT NULL,
	"references_text" text DEFAULT '' NOT NULL,
	"cover_letter" text NOT NULL,
	"fee_acknowledged" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"submitted_at" text NOT NULL,
	"reviewed_at" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "founder_collective_nominations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"company_id" text NOT NULL,
	"founder_id" text NOT NULL,
	"vouching_investor_id" text NOT NULL,
	"pitch_summary" text NOT NULL,
	"deck_link" text,
	"supplementary_notes" text,
	"asks" text,
	"status" text DEFAULT 'pending_vouch' NOT NULL,
	"submitted_at" text NOT NULL,
	"vouched_at" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "founder_crm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"company_id" text NOT NULL,
	"investor_id" text,
	"name" text NOT NULL,
	"firm_name" text,
	"role" text,
	"email" text,
	"region" text,
	"stage" text NOT NULL,
	"ownership" text,
	"soft_circle_history" text,
	"tasks" text,
	"thread_ids" text,
	"ma_signals" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"notes_updated_at" text,
	"series" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "founder_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"usd_monthly" integer NOT NULL,
	"features_json" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text DEFAULT 'system' NOT NULL,
	"deleted_at" text,
	"billing_cycle" text,
	"annual_price_cents" integer
);
--> statement-breakpoint
CREATE TABLE "funded_queue" (
	"invitation_id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"round_id" text NOT NULL,
	"company_id" text NOT NULL,
	"investor_id" text NOT NULL,
	"amount" text NOT NULL,
	"currency" text NOT NULL,
	"shares" text NOT NULL,
	"enqueued_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investor_crm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"investor_id" text NOT NULL,
	"platform_user_id" text,
	"name" text NOT NULL,
	"role" text,
	"email" text,
	"affiliation" text,
	"stage" text NOT NULL,
	"tags" text,
	"notes" text,
	"note_log" text,
	"tasks" text,
	"starred" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"company_id" text,
	"company_name" text,
	"founder_name" text,
	"founder_email" text,
	"sector" text,
	"region" text,
	"check_size_usd" integer,
	"notes_updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "investor_nominations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"investor_user_id" text NOT NULL,
	"company_id" text NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decline_reason" text,
	"decided_at" text,
	"decided_by" text,
	"round_id" text,
	"prev_hash" text,
	"hash" text NOT NULL,
	"submitted_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "invoice_year_counter" (
	"year" integer PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"tenant_id" text DEFAULT 'tenant_unknown' NOT NULL,
	"company_id" text NOT NULL,
	"subscription_id" text DEFAULT '' NOT NULL,
	"plan_label" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"tax_minor" integer DEFAULT 0 NOT NULL,
	"total_minor" integer NOT NULL,
	"status" text NOT NULL,
	"payment_entry_id" text,
	"related_invoice_id" text,
	"issued_at" text NOT NULL,
	"paid_at" text,
	"refunded_at" text,
	"voided_at" text,
	"card_last_4" text,
	"line_items_json" text,
	"version" integer DEFAULT 1 NOT NULL,
	"prev_revision_hash" text NOT NULL,
	"revision_hash" text NOT NULL,
	"updated_at" text,
	"updated_by" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "legal_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"document_id" text NOT NULL,
	"document_version" text NOT NULL,
	"context" text NOT NULL,
	"accepted_at" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"prev_hash" text NOT NULL,
	"hash" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "message_read_receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"read_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text,
	"title" text DEFAULT '' NOT NULL,
	"participant_user_ids" text DEFAULT '[]' NOT NULL,
	"last_message_id" text,
	"last_activity_at" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text,
	"thread_id" text,
	"channel_type" text NOT NULL,
	"sender_user_id" text NOT NULL,
	"recipient_user_ids" text DEFAULT '[]' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"attachments" text DEFAULT '[]' NOT NULL,
	"read_by" text DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "_migrations_applied" (
	"key" text PRIMARY KEY NOT NULL,
	"applied_at" text NOT NULL,
	"details" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"author_user_id" text NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"body" text NOT NULL,
	"content_json" text,
	"likes" integer DEFAULT 0 NOT NULL,
	"comments" integer DEFAULT 0 NOT NULL,
	"parent_post_id" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "notification_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"audience_type" text NOT NULL,
	"status" text NOT NULL,
	"content_json" text,
	"scheduled_at" text,
	"sent_at" text,
	"recipient_count" integer,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_emails" (
	"id" text PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"html_body" text,
	"text_body" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"idempotency_key" text,
	"created_at" text NOT NULL,
	"sent_at" text,
	"error_message" text,
	"campaign_id" text
);
--> statement-breakpoint
CREATE TABLE "partner_crm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"contact_user_id" text,
	"email" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"org" text DEFAULT '' NOT NULL,
	"last_contact_at" text,
	"notes" text DEFAULT '' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "partner_deal_pipeline" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"company_id" text NOT NULL,
	"stage" text DEFAULT 'sourced' NOT NULL,
	"assigned_user_ids" text DEFAULT '[]' NOT NULL,
	"target_close_at" text,
	"notes" text DEFAULT '' NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"legacy_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "partner_deal_promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"pipeline_deal_id" text NOT NULL,
	"promotion_type" text NOT NULL,
	"company_id" text,
	"target_email" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"promoted_by" text NOT NULL,
	"promoted_at" text NOT NULL,
	"approved_at" text,
	"approved_by" text,
	"rejected_at" text,
	"rejected_by" text,
	"rejected_reason" text,
	"withdrawn_at" text,
	"withdrawn_by" text,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL,
	"is_seed" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"deleted_at" text,
	"moderation_status" text DEFAULT 'pending' NOT NULL,
	"moderated_by_user_id" text,
	"moderated_at" text,
	"moderation_notes" text
);
--> statement-breakpoint
CREATE TABLE "partner_organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"jurisdiction" text DEFAULT '' NOT NULL,
	"partner_type" text DEFAULT 'other' NOT NULL,
	"aum_range" text DEFAULT 'undisclosed' NOT NULL,
	"primary_chapter_id" text,
	"website" text,
	"logo_url" text,
	"banner_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"onboarding_state" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_portfolio_companies" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"company_id" text NOT NULL,
	"display_name" text NOT NULL,
	"stage" text DEFAULT 'seed' NOT NULL,
	"sector" text DEFAULT '' NOT NULL,
	"lead_invested_amount_minor" integer DEFAULT 0 NOT NULL,
	"first_invested_at" text,
	"notes" text DEFAULT '' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "pcrm_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"firm" text,
	"email" text,
	"linkedin" text,
	"pipeline_stage" text NOT NULL,
	"tags" text,
	"lanes" text,
	"company_id" text,
	"created_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "pcrm_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"body" text NOT NULL,
	"note_type" text NOT NULL,
	"created_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "pcrm_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"title" text NOT NULL,
	"due_date" text,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"completed_at" text,
	"created_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"prev_hash" text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"hash" text DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text DEFAULT 'system' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_models" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text NOT NULL,
	"base_price_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"features_json" text,
	"regional_multipliers_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prev_revision_hash" text NOT NULL,
	"revision_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recon_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"company_id" text NOT NULL,
	"round_id" text NOT NULL,
	"ts" text NOT NULL,
	"engine_main_json" text NOT NULL,
	"engine_ref_json" text NOT NULL,
	"diff_json" text NOT NULL,
	"actor" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "region_extensions" (
	"id" text PRIMARY KEY NOT NULL,
	"region_code" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"pricing_multiplier" double precision DEFAULT 1 NOT NULL,
	"currency_override" text,
	"config_json" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revision_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"company_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"period" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"content_json" text NOT NULL,
	"delivery_targets_json" text,
	"generated_at" text,
	"generated_by" text,
	"sent_at" text,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "round_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"investor_email" text NOT NULL,
	"investor_name" text,
	"state" text NOT NULL,
	"expires_at" text,
	"sent_at" text,
	"viewed_at" text
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"company_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"target_amount" double precision NOT NULL,
	"raised_amount" double precision DEFAULT 0 NOT NULL,
	"pre_money" double precision,
	"post_money" double precision,
	"price_per_share" double precision,
	"min_ticket" double precision,
	"close_date" text,
	"terms_summary" text,
	"lead_investor" text,
	"currency" text,
	"region" text,
	"open_date" text,
	"instrument" text,
	"extras_json" text,
	"created_at" text,
	"updated_at" text,
	"created_by" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "screening_event_attendees" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'observer' NOT NULL,
	"rsvp" text DEFAULT 'invited' NOT NULL,
	"attended" integer DEFAULT 0 NOT NULL,
	"checked_in_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screening_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"chapter_id" text NOT NULL,
	"round_id" text,
	"company_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scheduled_for" integer NOT NULL,
	"duration_minutes" integer DEFAULT 60 NOT NULL,
	"location" text,
	"event_type" text DEFAULT 'screening' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"organizer_user_id" text NOT NULL,
	"ics_uid" text NOT NULL,
	"prev_hash" text,
	"curr_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"holder_name" text NOT NULL,
	"holder_type" text NOT NULL,
	"instrument" text NOT NULL,
	"series" text,
	"shares" integer DEFAULT 0 NOT NULL,
	"price_per_share" double precision,
	"investment_amount" double precision,
	"cap" double precision,
	"discount" double precision,
	"issued_at" text,
	"shares_str" text DEFAULT '0' NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" text NOT NULL,
	"expires_at" text NOT NULL,
	"user_agent" text,
	"ip" text,
	"revoked" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soft_circles" (
	"id" text PRIMARY KEY NOT NULL,
	"round_id" text NOT NULL,
	"invitation_id" text,
	"investor_name" text NOT NULL,
	"amount" double precision NOT NULL,
	"status" text NOT NULL,
	"created_at" text NOT NULL,
	"chapter_id" text
);
--> statement-breakpoint
CREATE TABLE "spv_capital_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"spv_id" text NOT NULL,
	"sequence_no" integer NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"called_at" text NOT NULL,
	"due_at" text,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spv_commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"spv_id" text NOT NULL,
	"lp_user_id" text NOT NULL,
	"amount_minor" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"commitment_doc_url" text,
	"signed_at" text,
	"funded_at" text,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spv_distributions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"spv_id" text NOT NULL,
	"distribution_type" text DEFAULT 'dividend' NOT NULL,
	"total_minor" integer DEFAULT 0 NOT NULL,
	"distributed_at" text NOT NULL,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spv_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"spv_id" text NOT NULL,
	"security_id" text NOT NULL,
	"shares" text DEFAULT '0' NOT NULL,
	"basis_minor" integer DEFAULT 0 NOT NULL,
	"acquired_at" text,
	"status" text DEFAULT 'held' NOT NULL,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spvs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"name" text NOT NULL,
	"lead_company_id" text,
	"structure_type" text DEFAULT 'spv' NOT NULL,
	"status" text DEFAULT 'forming' NOT NULL,
	"target_minor" integer DEFAULT 0 NOT NULL,
	"committed_minor" integer DEFAULT 0 NOT NULL,
	"called_minor" integer DEFAULT 0 NOT NULL,
	"distributed_minor" integer DEFAULT 0 NOT NULL,
	"gp_user_id" text,
	"formed_at" text,
	"closes_at" text,
	"terms" text DEFAULT '{}' NOT NULL,
	"prev_hash" text,
	"curr_hash" text DEFAULT '' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"company_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"plan" text NOT NULL,
	"annual_amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"renews_on" text NOT NULL,
	"card_last4" text,
	"invoices_count" integer DEFAULT 0 NOT NULL,
	"past_due_minor" integer,
	"trial_ends_on" text,
	"version" integer DEFAULT 1 NOT NULL,
	"prev_revision_hash" text NOT NULL,
	"revision_hash" text NOT NULL,
	"updated_at" text NOT NULL,
	"updated_by" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "subscriptions_history" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"snapshot_json" text NOT NULL,
	"version" integer NOT NULL,
	"revision_hash" text NOT NULL,
	"prev_revision_hash" text NOT NULL,
	"recorded_at" text NOT NULL,
	"recorded_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"envelope_json" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"received_at" text NOT NULL,
	"processed_at" text,
	"handler" text
);
--> statement-breakpoint
CREATE TABLE "sync_inbox_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value_json" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"billing_email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"is_demo" integer DEFAULT 0 NOT NULL,
	"created_at" text,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "term_sheet_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"round_id" text NOT NULL,
	"company_id" text NOT NULL,
	"revision" integer NOT NULL,
	"saved_at" text NOT NULL,
	"saved_by" text NOT NULL,
	"payload_json" text NOT NULL,
	"prev_revision_hash" text NOT NULL,
	"revision_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credentials" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"created_at" text,
	"updated_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "user_prefs" (
	"user_id" text PRIMARY KEY NOT NULL,
	"active_tenant_id" text,
	"updated_at" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"avatar_url" text,
	"is_demo" integer DEFAULT 0 NOT NULL,
	"deleted_at" text,
	"deletion_requested_at" text,
	"deletion_token" text,
	"anonymized_at" text,
	"anonymized_by_user_id" text,
	"title" text,
	"display_name" text
);
