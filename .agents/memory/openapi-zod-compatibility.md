---
name: OpenAPI Zod compatibility
description: Compatibility constraint for API code generation in this workspace.
---

Avoid `type: integer` and URI-formatted strings in the OpenAPI contract while the generated validation package resolves to Zod 3. The current Orval output maps these to Zod 4-only helpers, which breaks the shared-library typecheck.

**Why:** The project uses an Orval generator configuration that emits `zod.int()` and `zod.url()` for those OpenAPI constructs, but the installed Zod package does not expose those helpers.

**How to apply:** Use `type: number` for numeric API fields and ordinary `type: string` for URL fields unless the workspace's Zod/codegen versions have been upgraded and a full generated-library typecheck confirms support.