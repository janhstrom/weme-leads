# Consuming WeMe Earth Tones in web apps

Read `artifacts/weme-earth-tones/docs/AGENTS.md` first. This guide covers
React/Vite and other shadcn/Tailwind web consumers. If the app already contains
a local theme or component library, also read
`artifacts/weme-earth-tones/docs/migrating-web.md` before writing UI.

## Theme

Import this package's theme once from the app's main CSS:

```css
@import "@workspace/weme-earth-tones/styles.css";
```

`styles.css` already imports Tailwind, its plugins, and this package's token
theme. It also registers this package's component sources. Do not add a separate
Tailwind import or a `node_modules` source path in a Tailwind v4 consumer.
Tailwind v3 consumers keep their existing `@tailwind` directives and add
`node_modules/@workspace/weme-earth-tones/src/components` to `content`.

## Typography

The system uses **Nunito** for interface and body text. Load it once in the
consumer's HTML entry (or with the app's preferred font-loading mechanism):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  rel="stylesheet"
  href="https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,200..1000;1,200..1000&display=swap"
/>
```

## Components and helpers

Import every provided primitive, `cn`, and toast API directly from this package:

```tsx
import { Button } from "@workspace/weme-earth-tones/components/ui/button";
import { cn } from "@workspace/weme-earth-tones/lib/utils";
import {
  toast,
  useToast,
} from "@workspace/weme-earth-tones/hooks/use-toast";
```

Use the package component whenever it provides the required family. Keep
product-specific compositions in the app, but compose them from package
primitives rather than recreating those primitives locally.

The packaged `Toaster` and toast hook share one in-memory store. Do not call a
local toast hook while rendering the packaged `Toaster`.

## Verify

After wiring the workspace dependency, import and render
`@workspace/weme-earth-tones/components/ui/button`. Run the app's typecheck
and dev server. The import must resolve and the Button must use this package's
theme before broader UI work begins.

## Ongoing rules

- Keep one source of theme variables.
- Import package-provided primitives and helpers from the package path.
- Add reusable product-agnostic components to this package first.
- For a non-shadcn app, use the tokens as the source of truth and adapt existing
  components to the token CSS variables without copying token values.
