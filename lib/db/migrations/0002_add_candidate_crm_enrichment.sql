ALTER TABLE lead_candidates
  ADD COLUMN IF NOT EXISTS crm_enrichment jsonb,
  ADD COLUMN IF NOT EXISTS crm_enriched_at timestamptz,
  ADD COLUMN IF NOT EXISTS relevance_confidence text NOT NULL DEFAULT 'insufficient';