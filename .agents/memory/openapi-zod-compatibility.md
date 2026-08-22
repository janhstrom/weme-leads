---
name: OpenAPI Zod compatibility
description: Compatibility constraint for API code generation in this workspace.
---

Avoid `type: integer` and URI-formatted strings in the OpenAPI contract while the generated validation package resolves to Zod 3. The current Orval output maps these to Zod 4-only helpers, which breaks the shared-library typecheck.

**Why:** The project uses an Orval generator configuration that emits `zod.int()` and `zod.url()` for those OpenAPI constructs, but the installed Zod package does not expose those helpers.

**How to apply:** Use `type: number` for numeric API fields and ordinary `type: string` for URL fields unless the workspace's Zod/codegen versions have been upgraded and a full generated-library typecheck confirms support.

The generated Zod API currently overlaps with the generated types barrel for inline request schemas. Keep the codegen post-step that limits the public `lib/api-zod/src/index.ts` export to `generated/api`, then run the shared-library typecheck.

**Why:** Re-exporting both generated barrels can produce duplicate export errors even when the generated schemas themselves are valid.

**How to apply:** Do not remove the API-spec codegen post-step that rewrites the generated barrel after Orval runs. Verify `pnpm -w run typecheck:libs` whenever the OpenAPI contract or codegen setup changes.