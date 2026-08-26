ALTER TABLE "lead_monitoring_run_items"
  ADD COLUMN IF NOT EXISTS "checked_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;