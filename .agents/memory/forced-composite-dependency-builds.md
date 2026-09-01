---
name: Forced composite dependency builds
description: TypeScript incremental-build behavior for consumer checks that depend on generated composite declarations.
---

When a leaf package typecheck depends on generated declarations from a composite project, force-build that dependency before checking the consumer. TypeScript can trust an existing `.tsbuildinfo` record even when the declaration output is missing or no longer reflects the source.

**Why:** A normal `tsc --build` may report success without recreating deleted declaration output, causing the following consumer check to fail with misleading stale-reference errors.

**How to apply:** Chain `tsc --build <dependency> --force` before the leaf package's no-emit typecheck, especially for generated API libraries.