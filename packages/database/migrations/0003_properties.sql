CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"currency_code" char(3) NOT NULL,
	"timezone" varchar(64) NOT NULL,
	"haip_api_key_env" varchar(100),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "properties_currency_code_format" CHECK ("properties"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "properties_haip_api_key_env_format" CHECK ("properties"."haip_api_key_env" IS NULL OR "properties"."haip_api_key_env" ~ '^HAIP_KEY_[A-Z0-9_]+$')
);
