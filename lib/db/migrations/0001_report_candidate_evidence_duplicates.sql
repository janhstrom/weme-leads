-- Read-only preflight report. Run this in dev and prod before the cleanup.
SELECT
  candidate_id,
  url,
  count(*) AS duplicate_count,
  array_agg(id ORDER BY id) AS evidence_ids
FROM lead_candidate_evidence
GROUP BY candidate_id, url
HAVING count(*) > 1
ORDER BY duplicate_count DESC, candidate_id, url;