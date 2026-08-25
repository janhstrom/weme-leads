---
name: Vite build environment
description: Manual Vite production builds in this workspace require artifact runtime variables.
---

Manual Vite builds in this workspace require both `PORT` and `BASE_PATH` to be set explicitly; the managed workflow supplies them automatically.

**Why:** Running the package build directly without these variables fails while loading the Vite configuration, before application code is compiled.

**How to apply:** Use the managed workflow for normal verification, or set an appropriate local `PORT` and `BASE_PATH=/` when running a manual production build.