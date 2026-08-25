ALTER TABLE "lead_monitoring_runs"
  ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'monitoring' NOT NULL;

ALTER TABLE "lead_monitoring_run_items"
  ADD COLUMN IF NOT EXISTS "outcome" text;

CREATE INDEX IF NOT EXISTS "lead_monitoring_runs_kind_started_idx"
  ON "lead_monitoring_runs" USING btree ("kind", "started_at");