---
name: External evidence checks
description: Reliability constraint for validating public signal sources.
---

Public evidence URL checks must use a hard request timeout and fail the individual source explicitly rather than keeping dashboard requests open indefinitely.

**Why:** Publisher sites can accept a connection but never return headers, which previously held the API request open for minutes during pilot seeding.

**How to apply:** Keep URL availability checks bounded across the whole request, including any HEAD-to-GET fallback, and make seed/import flows skip or report unavailable sources without blocking unrelated signal data.