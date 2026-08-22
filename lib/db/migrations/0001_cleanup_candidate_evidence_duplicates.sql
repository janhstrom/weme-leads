-- Run this file once in each environment BEFORE:
--   pnpm --filter @workspace/db run push
--
-- Run 0001_report_candidate_evidence_duplicates.sql first for a read-only
-- report of the rows that will be collapsed.
--
-- The transaction below archives every non-canonical row (the oldest id is
-- canonical), then removes only those rows from the live table. All source
-- fields remain available in lead_candidate_evidence_duplicates.

BEGIN;

CREATE TABLE IF NOT EXISTS lead_candidate_evidence_duplicates (
  id serial PRIMARY KEY,
  original_evidence_id integer NOT NULL,
  canonical_evidence_id integer NOT NULL,
  candidate_id integer NOT NULL,
  title text NOT NULL,
  url text NOT NULL,
  source_type text NOT NULL,
  published_at date NOT NULL,
  excerpt text NOT NULL,
  verification_status text NOT NULL,
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_candidate_evidence_duplicates_candidate_url_idx
  ON lead_candidate_evidence_duplicates (candidate_id, url);
CREATE INDEX IF NOT EXISTS lead_candidate_evidence_duplicates_original_idx
  ON lead_candidate_evidence_duplicates (original_evidence_id);

-- Archive duplicate rows only once. The NOT EXISTS guard makes reruns safe.
INSERT INTO lead_candidate_evidence_duplicates (
  original_evidence_id,
  canonical_evidence_id,
  candidate_id,
  title,
  url,
  source_type,
  published_at,
  excerpt,
  verification_status,
  verified_at,
  created_at
)
SELECT duplicate.id,
       canonical.canonical_id,
       duplicate.candidate_id,
       duplicate.title,
       duplicate.url,
       duplicate.source_type,
       duplicate.published_at,
       duplicate.excerpt,
       duplicate.verification_status,
       duplicate.verified_at,
       duplicate.created_at
FROM lead_candidate_evidence AS duplicate
JOIN (
  SELECT candidate_id, url, min(id) AS canonical_id
  FROM lead_candidate_evidence
  GROUP BY candidate_id, url
  HAVING count(*) > 1
) AS canonical
  ON canonical.candidate_id = duplicate.candidate_id
 AND canonical.url = duplicate.url
WHERE duplicate.id <> canonical.canonical_id
  AND NOT EXISTS (
    SELECT 1
    FROM lead_candidate_evidence_duplicates AS archived
    WHERE archived.original_evidence_id = duplicate.id
  );

DELETE FROM lead_candidate_evidence AS duplicate
USING (
  SELECT candidate_id, url, min(id) AS canonical_id
  FROM lead_candidate_evidence
  GROUP BY candidate_id, url
  HAVING count(*) > 1
) AS canonical
WHERE duplicate.candidate_id = canonical.candidate_id
  AND duplicate.url = canonical.url
  AND duplicate.id <> canonical.canonical_id;

COMMIT;

-- Verify that the unique index can now be created:
-- SELECT candidate_id, url, count(*)
-- FROM lead_candidate_evidence
-- GROUP BY candidate_id, url
-- HAVING count(*) > 1;
-- (This must return zero rows.)