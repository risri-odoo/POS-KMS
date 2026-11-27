CREATE TYPE "public"."resolution_type" AS ENUM('posted_manually', 'collected_otherwise', 'written_off', 'duplicate_or_error');--> statement-breakpoint
ALTER TYPE "public"."outbox_status" ADD VALUE 'resolved';--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "resolution_type" "resolution_type";--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "resolved_by" varchar(100);--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "last_retry_by" varchar(100);--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "last_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "last_retry_note" text;