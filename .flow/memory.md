# Project memory

Durable, verified, non-obvious facts about this repo, earned during tasks.
One bullet per fact, with its consequence. Delete anything proven wrong.

- The editor app (`apps/editor`) is **pnpm, not npm** — `package-lock.json` is
  stale → editor dependency changes must update `pnpm-lock.yaml` AND the root
  `bun.lock`, or CI breaks.
- `apps/editor` links a **frozen ~May-2025 snapshot of davidup** — its tsc
  errors (AudioTrack, DOM types) are pre-existing → don't chase them as
  regressions from your change.
- The engine/editor **command schema is dual** — adding engine fields without
  updating `apps/editor/app/types/commands.ts` silently strips values → always
  update both.
- Native test deps (`skia.node`, ffmpeg) need **manual postinstall** — if
  missing, run the package install scripts; the `alpha.webm` fixture
  regenerates via `generate.sh`.
