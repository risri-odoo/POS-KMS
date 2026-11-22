CREATE TYPE "public"."verification_status" AS ENUM('verified', 'unverified');--> statement-breakpoint
CREATE TYPE "public"."parked_reason" AS ENUM('no_in_house_guest', 'stay_ended', 'needs_verification', 'wrong_property', 'haip_rejected');--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "haip_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "haip_folio_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "verification_status" "verification_status";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "verified_guest_name" varchar(120);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "haip_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "haip_folio_id" uuid;--> statement-breakpoint
ALTER TABLE "haip_post_outbox" ADD COLUMN "parked_reason" "parked_reason";--> statement-breakpoint
-- Backfill (hand-written): parked rows that HAIP rejected because the room had no in-house guest
-- (the text the current Retry guard matches, apps/api/src/haip/no-in-house-guard.ts) get the new reason.
-- Only rows still parked; posted rows are left alone.
UPDATE "haip_post_outbox"
   SET "parked_reason" = 'no_in_house_guest'
 WHERE "status" IN ('needs_attention', 'failed')
   AND "last_error" LIKE '%is vacant or has no in-house reservation%';

