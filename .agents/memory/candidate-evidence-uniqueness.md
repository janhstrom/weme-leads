---
name: Candidate evidence uniqueness
description: Safe rollout of the candidate/evidence URL uniqueness rule across environments
---

The candidate/evidence URL uniqueness rule requires a preflight report and an archival cleanup before the database schema is pushed. The cleanup keeps the oldest live evidence row and archives every additional row with its complete source metadata.

**Why:** PostgreSQL cannot create the unique index while historical duplicate rows exist, and deleting duplicates directly would discard source history.

**How to apply:** Run the read-only report first in both dev and production, review its output, then run the transactional cleanup and verify zero duplicate groups before running the schema push.