CREATE TABLE IF NOT EXISTS "lead_candidate_sources" (
  "id" serial PRIMARY KEY NOT NULL,
  "candidate_id" integer NOT NULL REFERENCES "lead_candidates"("id") ON DELETE cascade,
  "source_type" text NOT NULL,
  "url" text NOT NULL,
  "label" text NOT NULL,
  "is_active" text DEFAULT 'true' NOT NULL,
  "last_checked_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "lead_candidate_sources_candidate_url_unique" ON "lead_candidate_sources" USING btree ("candidate_id","url");
CREATE INDEX IF NOT EXISTS "lead_candidate_sources_candidate_idx" ON "lead_candidate_sources" USING btree ("candidate_id");

CREATE TABLE IF NOT EXISTS "lead_monitoring_runs" (
  "id" serial PRIMARY KEY NOT NULL,
  "status" text NOT NULL,
  "trigger" text NOT NULL,
  "requested_count" integer NOT NULL,
  "processed_count" integer DEFAULT 0 NOT NULL,
  "signals_created" integer DEFAULT 0 NOT NULL,
  "crm_matched_count" integer DEFAULT 0 NOT NULL,
  "crm_unresolved_count" integer DEFAULT 0 NOT NULL,
  "source_error_count" integer DEFAULT 0 NOT NULL,
  "error_summary" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "lead_monitoring_runs_status_idx" ON "lead_monitoring_runs" USING btree ("status","started_at");

CREATE TABLE IF NOT EXISTS "lead_monitoring_run_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_id" integer NOT NULL REFERENCES "lead_monitoring_runs"("id") ON DELETE cascade,
  "candidate_id" integer NOT NULL REFERENCES "lead_candidates"("id") ON DELETE cascade,
  "status" text NOT NULL,
  "brreg_status" text NOT NULL,
  "crm_status" text NOT NULL,
  "signals_created" integer DEFAULT 0 NOT NULL,
  "source_error_count" integer DEFAULT 0 NOT NULL,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "lead_monitoring_run_items_run_idx" ON "lead_monitoring_run_items" USING btree ("run_id");
CREATE INDEX IF NOT EXISTS "lead_monitoring_run_items_candidate_idx" ON "lead_monitoring_run_items" USING btree ("candidate_id","created_at");

ALTER TABLE "signalpilot_signals" ADD COLUMN IF NOT EXISTS "candidate_id" integer;
ALTER TABLE "signalpilot_signals" ADD COLUMN IF NOT EXISTS "monitoring_run_id" integer;
ALTER TABLE "signalpilot_signals" ADD COLUMN IF NOT EXISTS "signal_key" text;
ALTER TABLE "signalpilot_signals" ADD COLUMN IF NOT EXISTS "action_priority" integer DEFAULT 0 NOT NULL;
ALTER TABLE "signalpilot_signals" ADD COLUMN IF NOT EXISTS "is_actionable" boolean DEFAULT true NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "signalpilot_signals_signal_key_unique" ON "signalpilot_signals" USING btree ("signal_key");