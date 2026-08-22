---
name: Legacy pilot cleanup
description: Safety boundary for removing obsolete pilot source rows.
---

Legacy source cleanup must match both the retired URL and the pilot company it belonged to; matching the URL alone can delete an unrelated imported signal.

**Why:** Imported signals share the same table as seeded pilot data and may legitimately reference a generic company news landing page.

**How to apply:** When replacing seeded pilot sources, constrain deletion to the known source/company pair and leave other imported rows untouched.