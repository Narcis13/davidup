# davidup — SaaS Readiness Audit

Auditor lens: business / ops / security / scalability / compliance.
Code grounded to the tree at `apps/editor/` + `src/` on branch `editor-implementation`.
Sibling audits (engine, MCP, editor app) cover the *internal* quality of each layer;
this one asks the orthogonal question: **what would have to be true for this to bill 100 paying customers?**

---

## TL;DR readiness score

| Dimension | Stars | One-line verdict |
|---|---|---|
| Tenancy model | ☆☆☆☆☆ (0/5) | Single-process, single-project, OS-user level. No tenant concept exists in code. |
| Authentication | ★☆☆☆☆ (1/5) | Adonis auth scaffolded (users table, scrypt, session guard). Zero login / register / logout routes; zero auth middleware on any HTTP route. |
| Authorization | ☆☆☆☆☆ (0/5) | No ownership check anywhere — every endpoint operates on the *global* in-memory `projectStore`. |
| Asset storage | ★★☆☆☆ (2/5) | Hash-named, idempotent, extension+size validated. No MIME magic-byte check, no decompression-bomb cap, no AV, no S3 abstraction, no per-tenant prefix. |
| Render pipeline | ★☆☆☆☆ (1/5) | In-process, no queue, no concurrency limit, no per-tenant fairness, no meter, no timeout, no cancel after start. |
| MCP exposure | ★☆☆☆☆ (1/5) | Stdio only, runs as the OS user. No auth, no rate limit, no scope. Any agent attached to the process owns the project. |
| Observability | ★☆☆☆☆ (1/5) | Pino logs to stdout. No metrics, no traces, no Sentry hook, no audit table, no request-id correlation. |
| Security headers | ★★★☆☆ (2.5/5) | XFO=DENY, HSTS, CSRF on session routes — but CSP disabled and `/api/*` exempt from CSRF. CORS origin = `[]` (default-deny) is fine for now. |
| Compliance / legal | ★☆☆☆☆ (1/5) | No ToS, no privacy policy, no DPA, no data export, no delete-me path, font-licensing story unstated. |
| Deployment | ★☆☆☆☆ (1/5) | `node ace serve` works locally. No Dockerfile, no CI workflow, no migration story for skia-canvas native build in containers, APP_KEY committed in `.env.example`. |

**Aggregate readiness for a hosted multi-tenant product: ~10%.** The engine and the
authoring surface are largely production-quality for a *local* tool. The SaaS-shell
layer below them — auth, tenancy, storage, queue, billing, ops — is essentially
unstarted, by deliberate v1.0 scope choice (PRD §03 explicitly defers it to v2.0).
That's a defensible position, but it means the gap to "alpha customers" is wide and
the gap to "public launch" is multi-quarter.

---

## Tenancy model today

**What exists:**
- A single global singleton at `apps/editor/app/services/project_store.ts:325` — `projectStore` — holds *one* `LoadedProject` in memory for the entire process.
- The active project is selected by setting `DAVIDUP_PROJECT=/absolute/path` in the environment before boot (`apps/editor/start/preload_project.ts:22`) or by POSTing to `/api/project` after boot.
- The global library lives at `~/.davidup/library/` (or `$DAVIDUP_LIBRARY`) — *one* per OS user (`apps/editor/app/services/global_library_root.ts:60`).
- All on-disk state — project files, library, renders, recents, editor state — is rooted at directories on the local filesystem chosen by whoever boots the process.
- SQLite DB lives at `app.tmpPath('db.sqlite3')` — one file per app instance (`apps/editor/config/database.ts:11`).
- One `users` table exists (`apps/editor/database/migrations/1778780645125_create_users_table.ts`) with `email`, `password`, `full_name`. No `organization_id`, no `tenant_id`, no `owner_id` foreign keys anywhere.

**What does not exist:**
- No `Organization` / `Tenant` / `Workspace` model.
- No `Project` row in the database — projects are *folders on disk*, not database entities. The system has zero awareness of "who owns this project" because there is no model to attach ownership to.
- No quota tracking (storage MB, render minutes, asset count, MCP calls).
- No mapping between an HTTP session and a project. The currently-loaded project is *whatever was last POSTed to `/api/project`*, regardless of who POSTed it.
- No per-user `~/.davidup/` segregation — every user of a hypothetical hosted instance would share the same global library root.

**Implication.** The tenancy model is not "incomplete multi-tenant" — it's "explicitly single-tenant, designed for `npx davidup edit .`". Adding multi-tenancy is not a config flip; it's a re-modeling of state: project must become a row, the store must become a per-tenant cache, the library must become a per-tenant root, the renders dir must be a tenant-prefixed object key.

---

## Security findings

### 1. CRITICAL — No authentication on any HTTP route
- **Where:** `apps/editor/start/routes.ts` (entire file), `apps/editor/start/kernel.ts:48-51`.
- **Detail:** The `auth` and `guest` named middleware are *defined* but never *applied* to any route. There are also no `/login` / `/register` / `/logout` routes — the auth scaffolding is unwired UI.
- **Attack:** Anyone who can reach the HTTP port reads/writes the loaded project, lists the library, uploads assets, starts renders, and (when `DAVIDUP_MCP_STDIO=1`) drives the MCP surface via the same process.
- **Fix (private alpha):** Add login + magic-link flow, apply `middleware.auth()` to every `/api/*` route, gate `/editor` and `/project-files/*` behind the same.

### 2. CRITICAL — Server-Side Request Forgery (SSRF) via asset `src`
- **Where:** `src/assets/node.ts:41-50` — `NodeAssetLoader.fetchImage` passes `asset.src` verbatim to skia-canvas `loadImage()`. skia-canvas accepts plain `http(s)://` URLs and resolves them server-side.
- **Detail:** A composition can declare `{ type: "image", src: "http://169.254.169.254/latest/meta-data/..." }`. When the engine renders, the server fetches that URL with the server's network identity.
- **Attack:** Any user who can submit a composition (today: anyone with HTTP access; in SaaS: any authenticated tenant) can pivot through the render worker to hit the cloud metadata endpoint, internal services, the local Redis, the local Postgres, etc.
- **Fix:** Reject any non-relative, non-`global:`, non-`data:` `asset.src` in `validateComposition` *and* in the MCP `register_asset` tool. If remote URLs are needed, fetch through an allowlisted proxy with a private-IP block.

### 3. HIGH — `APP_KEY` committed to `.env.example` (and `.env`)
- **Where:** `apps/editor/.env:5` and `apps/editor/.env.example:5` — both contain literal `APP_KEY=zKXHe-Ahdb7aPK1ylAJlRgTefktEaACi`.
- **Detail:** This key signs cookies and encrypts session payloads. Anyone who pulls the repo can forge session cookies for any deployment that boots from this env file.
- **Fix:** Rotate the key, scrub git history, change `.env.example` to `APP_KEY=` placeholder, add a pre-commit `git-secrets` hook, ensure the deploy generates a fresh key per environment.

### 4. HIGH — CSRF disabled for all `/api/*` routes
- **Where:** `apps/editor/config/shield.ts:22` — `exceptRoutes: (ctx) => ctx.request.url().startsWith('/api/')`.
- **Detail:** Every mutating editor action (commands, renders, project switching, asset upload) goes through `/api/*` and bypasses CSRF entirely. With cookie-based session auth on the same origin this is a CSRF goldmine.
- **Attack scenario:** Authenticated user visits `evil.com`, which `<form action="https://app/api/project" method=POST>` switches their session to an attacker-controlled project path, or POSTs `/api/command` to corrupt their composition.
- **Fix:** Switch `/api/*` to require either (a) bearer-token auth (no cookies → no CSRF) or (b) keep CSRF on with the XSRF cookie pattern Adonis already supports.

### 5. HIGH — `POST /api/project` accepts any filesystem path
- **Where:** `apps/editor/app/controllers/projects_controller.ts:45-74` + `apps/editor/app/services/project_paths.ts:33-78`.
- **Detail:** The `guardProjectDirectory` helper blocks `/etc`, `/proc`, `/sys`, `/Library/Keychains`, `..` segments, and control chars — but not the user's `~/.ssh`, `~/Library/Application Support`, anything under `/tmp`, or any other directory containing `composition.json`. In a hosted setting where this process runs as a service user, an attacker who reaches the HTTP port can read any directory the service user owns by pointing `directory` at it and then reading `/project-files/*`.
- **Attack:** `POST /api/project {"directory":"/home/davidup-svc/.aws"}` → if `~/.aws/composition.json` happens not to exist it 404s, but `GET /project-files/credentials` would succeed once any project under that parent is loaded *only if* it contains a composition. Stronger attack: drop a malicious `composition.json` into a writable location, point the store there, then exfiltrate sibling files through `/project-files/*`.
- **Fix:** Multi-tenant model: each project must live under `<tenants>/<tenantId>/projects/<projectId>/`, the controller must accept `projectId` (not a raw path), and `project_paths.ts` must verify the resolved root sits inside the tenant's root.

### 6. HIGH — `/project-files/*` and `/library-files/*` serve arbitrary file types unauthenticated
- **Where:** `apps/editor/app/controllers/editor_controller.ts:203-240` + `:163-195`.
- **Detail:** Path-traversal *is* blocked (`relative(root, target).startsWith('..')`), so the files served are guaranteed to live under `project.root` / library root. But:
  1. No auth — anyone with the URL gets the content.
  2. `extToContentType()` maps `.json` to `application/json` — so `composition.json` and `library/index.json` are downloadable. With no tenancy, that means anyone gets every loaded user's project.
  3. SVG is served as `image/svg+xml` with no sanitisation — an attacker who can upload an SVG can host stored XSS at a URL on the editor's origin.
- **Fix:** Require auth + project ownership, strip SVG `<script>` (or serve all SVG with `Content-Disposition: attachment` + `Content-Security-Policy: sandbox`), block `composition.json` from this route (it's served by `/api/composition-source` with controlled shape anyway).

### 7. HIGH — Asset upload: no MIME magic-byte verification, no decompression-bomb cap
- **Where:** `apps/editor/app/services/asset_pipeline.ts:120-137`, `apps/editor/app/controllers/assets_controller.ts:5-22`.
- **Detail:** File type is decided by extension first, declared Content-Type second. There's no magic-byte sniff (e.g., `.png` upload that is actually a 1MB-compressed-to-100GB ZIP bomb wrapped in a PNG header). No `image-bomb` mitigation — `skia.loadImage` happily decodes a 60000×60000 PNG and OOMs the process. No antivirus scan. No quota.
- **Limits in play:** `50mb` size cap (`assets_controller.ts:57`), bodyparser multipart limit `20mb` (`config/bodyparser.ts:56`) — note the mismatch; bodyparser caps at 20MB so the per-file 50MB is unreachable for now.
- **Fix:** Add `file-type` sniff (read first 4KB, verify magic against `mediaType`). Reject images whose decoded W×H > 64 megapixels. Run uploads through ClamAV (or a hosted-AV API) for video/audio. Add per-tenant storage quota.

### 8. HIGH — No rate limiting anywhere
- **Where:** No middleware exists. Grep for `rate`, `throttle`, `quota` in `apps/editor/` returns zero hits.
- **Attack:** A single client can hammer `POST /api/renders` to start an arbitrary number of in-process renders (DoS the box's CPU), or hammer `POST /api/assets` to fill disk.
- **Fix:** Adonis 6 has `@adonisjs/limiter` — wire it on `/api/command`, `/api/renders`, `/api/assets`, `/api/library/thumbnail` with per-IP and per-tenant limits.

### 9. HIGH — Render worker is unbounded and in-process
- **Where:** `apps/editor/app/workers/render_worker.ts:212-292` + `apps/editor/app/controllers/renders_controller.ts:62-118`.
- **Detail:** `renderJobs.add(job); void job.run()` — a render fires immediately, no semaphore, no queue, no max-concurrency. A 30-minute 4K render at 60fps will hold the event loop's I/O bandwidth and a CPU core for 30 minutes. The retained-jobs cap is 32 (`render_worker.ts:303`) but that's a memory cap, not a concurrency cap.
- **No timeout:** A pathological composition that loops or stalls ffmpeg will never be killed.
- **No cancel after start:** `abort()` only sets a flag — the underlying `renderToFile` call has no `AbortSignal` (acknowledged in the comment at `:160-162`).
- **Fix:** Move renders to a BullMQ queue (Redis required), cap concurrency = `min(cpus, 2)` per node, hard-timeout per job (configurable; 10× expected wall-clock is reasonable), implement an `AbortSignal` plumbed into `renderToFile` so a cancel actually kills ffmpeg + skia.

### 10. MEDIUM — Path traversal hardening relies on string comparison without trailing-sep normalization
- **Where:** `apps/editor/app/controllers/renders_controller.ts:344-350` — `target.startsWith(inside + '/')`. On Windows the separator is `\`, so this check is platform-fragile.
- **Detail:** `path.relative` + `..`-prefix check elsewhere is the correct pattern (`editor_controller.ts:222-227`). The renders shell endpoint uses a different idiom and would not catch a Windows traversal that resolves to `C:\projectroot\renders\..\..\` style.
- **Fix:** Use the `relative()` pattern everywhere; or short-circuit with `path.sep`.

### 11. MEDIUM — `POST /api/renders/shell` spawns `open` on macOS
- **Where:** `renders_controller.ts:316-371`.
- **Detail:** A clear "this is a local dev affordance" — opens Finder/QuickTime on the *server's* desktop session. In a hosted deploy this is nonsense (no desktop). Filename is constrained to a basename within `renders/`, which limits injection to that subset. But it's still a surface that must be gated off entirely in production builds.
- **Fix:** Drop the endpoint in production; or feature-flag behind `NODE_ENV=development`.

### 12. MEDIUM — Content-Security-Policy disabled
- **Where:** `apps/editor/config/shield.ts:8-12` — `csp: { enabled: false }`.
- **Detail:** No CSP means the SVG-served-as-image-svg-xml vector in finding #6 has no second line of defence.
- **Fix:** Enable a `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`, `img-src 'self' data: blob:`, `style-src 'self' 'unsafe-inline'` (Vue scoped styles need it) report-only CSP first, then enforce.

### 13. MEDIUM — Session cookie store is in-cookie
- **Where:** `apps/editor/config/session.ts:37` — `store: env.get('SESSION_DRIVER')` and `env.ts:26` enum is `['cookie', 'memory']`.
- **Detail:** The cookie store means the full session payload lives in the client's cookie, signed with `APP_KEY`. That's fine for a single-server private alpha. For multi-node SaaS you need server-side sessions (Redis store) or stateless JWT — neither is wired.
- **Fix:** Add `@adonisjs/redis` + a `redis` session store before going multi-node.

### 14. LOW — User model has no email-verification, no password reset, no 2FA hooks
- **Where:** `apps/editor/app/models/user.ts` + the lone migration.
- **Detail:** Just `id, full_name, email, password, timestamps`. No `email_verified_at`, no `password_reset_tokens` table, no `magic_link_tokens`, no `mfa_secret`.
- **Fix:** Standard Adonis verify-email package, password-reset routes, and (for a video product) eventually 2FA.

### 15. LOW — `extName` mapping treats unknown as octet-stream — fine, but no `X-Content-Type-Options: nosniff` on streamed files
- **Where:** `editor_controller.ts:243-271`. Shield's `contentTypeSniffing: { enabled: true }` only applies to its own middleware path, not to `response.stream`.
- **Fix:** Set `X-Content-Type-Options: nosniff` and `Content-Disposition: attachment` for unknown extensions.

---

## Scalability concerns

### Single in-memory composition is the entire system
The whole editor runtime is one `ProjectStore` singleton (`project_store.ts:325`) holding a single `LoadedProject` (one composition, one library attachment, one defaults snapshot, one source map). Today: switching projects is `load(newDir)` — it `flush()`es the prior writes, aborts in-flight renders, detaches the library, and swaps the field. For multi-tenant SaaS this entire model has to invert: the store becomes a *per-project-LRU cache* keyed by tenant + project id, and the controllers stop referencing a global singleton.

**Touch-points to change:** every controller imports `projectStore` directly (`grep -rn "import projectStore" apps/editor/app/controllers/` → 6 files). Each will need to resolve "current project for this request" from session + URL param. Estimated work: a week of focused refactor + comprehensive tests, because the command bus + MCP bridge + render worker + library index all couple to the singleton.

### Render worker pins the web server
Renders run *in the same Node process that serves HTTP* (`render_worker.ts:13-21` calls this out as an explicit v1.0 tradeoff). At 100 concurrent active editors, even one ongoing render starves the event loop's ability to flush SSE progress for everyone else. The "between frames yield" pattern keeps SSE alive *for that one render*, not for unrelated traffic. ffmpeg + skia native calls are off the loop, but `canvas.toBuffer('raw')` is a blocking-from-the-loop's-perspective call that holds for tens of ms per frame.

**At 100 editors, 1000 editors:** No chance on one box. Need:
- Separate `editor-web` and `render-worker` deployments (different Docker images, same codebase).
- BullMQ queue between them; web puts a job → worker pops it; SSE proxies progress from worker via Redis pub/sub.
- skia-canvas cold-start matters: ~300ms native-init + font scan on first render per worker process. Pre-warm by running a 1×1 render on boot.

### SQLite for the SaaS DB
`config/database.ts` uses `better-sqlite3` against `tmpPath('db.sqlite3')`. That's perfect for v1.0 local. For SaaS you need Postgres (the vision docs already pin this), per-tenant connection pooling, and a real migration path. The current schema is one table; the migration story is "we'll add tables when we have models" — fine, but no migration discipline (versioning, naming, atomic up/down) is exercised yet.

### Library index does fs.watch on every attach
`library_index.ts` (not read in full but the API at `attachGlobal`, `attach`, etc.) holds inotify watchers on the project and global library directories. In a hosted environment with 1000 active projects you cannot keep 2000 active watchers; this becomes an LRU + on-demand-scan problem. Same for `recents.ts` and `editor_state.ts` which write to `~/.davidup/state.json` — a per-OS-user file that all tenants would share.

### MCP bridge couples 1-to-1 with the loaded project
`mcp_bridge.ts` (read partially) constructs one `DavidupServer` per process and routes through the same `commandBus` + `projectStore` singleton. Hosting MCP means moving from stdio to HTTP-SSE transport (the MCP spec supports it) *and* multi-projecting the bridge. A single shared bridge cannot serve multiple tenants safely.

### Render output directory bloat
Renders write to `<project>/renders/<timestamp>.mp4` and never get garbage-collected. For a hosted product this is a storage leak — 100 users × 10 renders/day × 50MB = 50GB/day on disk, with no expiry. The cap on the in-memory job registry (32) doesn't touch the files.

---

## Compliance / legal gaps

1. **No Terms of Service, no Privacy Policy, no Data Processing Agreement.** Standard B2B-SaaS gate.
2. **GDPR data-subject hooks missing.** No export endpoint (would dump a tenant's projects + renders + library to a zip), no delete-me endpoint (would purge SQLite rows + filesystem + S3). Both need to exist before a single EU user signs up; for B2B these are SLA items in the DPA.
3. **DMCA / takedown surface.** No mechanism to flag a render or asset, no abuse@ address, no Trust & Safety queue. A hosted video product *will* be used to render copyrighted content; you need a takedown form and a record of action.
4. **Font licensing.** The engine ships `skia-canvas` (which carries its own font handling) but the editor's scaffolded projects can reference any local font. There's no font-license registry — a tenant can upload a font they don't own, embed it in a rendered video they then distribute, and you (the host) are in the chain of distribution. Need either: (a) host-curated font catalog with explicit licenses, or (b) explicit Terms language placing license obligation on the tenant, plus a font-source-tracking field on `FontAsset`.
5. **AI-generated content provenance.** Davidup's pitch is "agents author video". For EU AI Act compliance (and platform credibility) you'll want C2PA-style provenance: render-time metadata indicating "this clip was AI-authored, by tenant T, via MCP session S". The engine has no such metadata pass today.
6. **Subprocessor list.** None published. SaaS RFPs ask for it; Hetzner/AWS/whoever you pick, Stripe, Sentry, your AV provider, your email provider — all need listing.
7. **SOC2 / ISO27001 posture.** Zero. No access logs (see Observability), no change-management process, no incident-response playbook. Not a v1 alpha blocker, becomes a blocker around your first enterprise prospect.

---

## Cost & metering

Today: zero. No counter increments anywhere. No `render_minutes`, no `storage_bytes`, no `mcp_calls`, no `egress_bytes`. The render worker has `frameCount` and `durationMs` in its `done` event (`render_worker.ts:101-109`) but those values are not persisted anywhere — they're consumed by the SSE client and then discarded.

**To bill customers you need (in build order):**
1. A `usage_events` append-only table — `{ tenant_id, kind, qty, occurred_at, meta }`. One row per render done, per upload completed, per MCP call dispatched, per 24h-aggregated storage scan.
2. A meter writer at the relevant code points:
   - `render_worker.ts` `done` handler → `usage_events('render_seconds', durationMs/1000)`.
   - `asset_pipeline.ts:548` after `writeIndexAtomic` → `usage_events('storage_bytes', size, delta=true)`.
   - `mcp_bridge.ts` router enter → `usage_events('mcp_call', 1, meta={tool})`.
3. A daily roll-up job that aggregates `usage_events` into `tenant_usage_daily` for dashboarding.
4. A pricing model + Stripe wiring. Stripe `Meter` (the 2024+ usage-based product) maps cleanly: one meter per event kind, push aggregated counts every hour.
5. Pre-flight quota checks on the hot path — *before* starting a render, look up the tenant's plan limit and reject with 402 if exceeded.

Estimated work for v0 metering (no UI, just data + Stripe push): one focused week. UI for "you've used X of Y this month": another week.

---

## Roadmap to private alpha (5–10 tenants)

Goal: a friend-of-founder cohort can sign up, edit one project each, render to MP4, can't trivially break each other. Acceptable to be rough.

1. **Add login/logout/register routes** (1d). `/login`, `/register`, `/logout`. Magic-link is fine; you can defer password reset to public launch.
2. **Apply `auth` middleware to every existing `/api/*` route** (½d). Including `/editor`, `/project-files/*`, `/library-files/*`. Verify with a functional test that every controller returns 401 unauthenticated.
3. **Introduce `Project` model + migration** (1d). Columns: `id, owner_user_id, slug, name, fs_root, created_at, updated_at`. The `fs_root` is server-controlled, computed as `<DATA_ROOT>/users/<userId>/projects/<projectId>/`.
4. **Refactor `projectStore` to a per-(user+project) cache** (3d). Replace the singleton with a Map keyed by `${userId}:${projectId}`; controllers resolve current project from URL param + session, fall back to 404. This is the riskiest item — touches the command bus + MCP bridge + render worker + library index.
5. **Tenant-scope `~/.davidup/`** (1d). The global library becomes per-user: `<DATA_ROOT>/users/<userId>/library/`. Recents + editor_state become DB rows, not `~/.davidup/*.json` files.
6. **Rotate `APP_KEY`, scrub history, add per-env key** (½d).
7. **SSRF fix on `asset.src`** (½d). Block `http(s)://`, `file://`, anything other than relative, `data:`, and `global:` in the validator. Add a test.
8. **Re-enable CSRF on `/api/*`** OR switch to bearer-token auth (1d). Pick one. With session cookies + Inertia, CSRF-with-XSRF-cookie is the easier path.
9. **Render-job concurrency cap + timeout** (1d). `pLimit(2)` per process, default `RENDER_TIMEOUT_MS=600000`, reject with 503 when full.
10. **Per-tenant disk quota** (1d). Daily du-style scan, store in `tenant_usage_daily.storage_bytes`. Block uploads when over.
11. **MIME magic-byte sniff on uploads** (½d). `file-type` package, reject mismatch.
12. **Hard image-decode cap** (½d). Reject `loadImage` results with `width*height > 64_000_000`.
13. **Stripe Meter wiring for render-seconds + storage** (3d). One product, two meters. No invoice UI yet.
14. **Privacy Policy + ToS pages** (½d). Two markdown pages from a template, lawyer review later.
15. **Sentry hook + request-id middleware** (½d). `@sentry/node`, capture every `response.status >= 500`.
16. **Dockerfile** (1d). Multi-stage; the skia-canvas native build needs `libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev` on Debian; the resulting image is ~600MB. Pre-build skia-canvas in the builder stage; copy `node_modules` into runtime.
17. **Provision Hetzner CX32 + Coolify (or Caddy + systemd)** (1d). Single-node deploy.
18. **Smoke-test runbook + on-call alert** (½d). PagerDuty/Healthchecks.io for `/health`.

**Wall-clock for one developer: ~3 weeks.** Faster with help; slower if the projectStore refactor (item 4) uncovers state leaks in the command bus or MCP bridge.

---

## Roadmap to public launch (1000+ tenants)

After private alpha is stable, in rough priority order:

1. **Split web ↔ render-worker into two deploys.** BullMQ + Redis. Web pushes jobs, worker pops them, web subscribes to Redis pub/sub for progress relay. This unblocks horizontal scaling of either tier independently.
2. **Migrate SQLite → Postgres.** Lucid supports both; the migration is straightforward but exercise the upgrade once on a snapshot.
3. **Move assets and renders to object storage (R2 or S3).** Abstract `asset_pipeline.ts` and `render_worker.ts` over a `Storage` interface; local-disk implementation for dev, S3 for prod. Sign download URLs (presigned URLs, 15min TTL) instead of streaming through the app.
4. **Replace `library/index.json` per-project files with DB rows.** The current fs.watch architecture cannot survive multi-node — there's no shared filesystem in the cluster.
5. **Per-tenant Redis-backed sessions.** Switch session driver from `cookie` to `redis`.
6. **Hosted MCP endpoint.** Today MCP is stdio-only. Either: (a) HTTP-SSE MCP transport per tenant with bearer-token auth (cleanest), or (b) per-tenant ephemeral MCP processes provisioned on demand (scales worse but is closer to today's code).
7. **Rate limiting + abuse mitigation.** `@adonisjs/limiter` on every mutating endpoint + per-tenant render-minutes guardrails. Add a Cloudflare WAF in front.
8. **GDPR data-export and delete-me flows.** Self-serve, surfaced in account settings.
9. **DMCA takedown form + abuse@ inbox + Trust & Safety queue.** A simple ticketing system (Linear or a dedicated table) suffices initially.
10. **Provenance metadata.** Bake C2PA assertions into rendered MP4s (`xmpMetadata` + signed assertion). Tooling: `c2pa-node`.
11. **AV scan on uploads.** ClamAV daemon or a hosted scan-API (e.g., Cloudmersive). Quarantine on positive.
12. **Backup strategy.** Postgres point-in-time (Hetzner managed Postgres or self-managed `pgBackRest`), R2 cross-region replication for assets/renders, ~30 day retention. Documented restore drill.
13. **Observability stack.** Pino → Loki, OpenTelemetry traces → Tempo, Prometheus metrics. Grafana dashboards for: render queue depth, p95 render latency, MCP error rate, per-tenant storage.
14. **SOC2-readiness primitives.** Change-management via PR review, deploy log, access log of who-touched-prod, secrets rotation calendar.
15. **CSP (enforced), HSTS preload, HTTP/3 termination at edge.**
16. **Public docs site, status page, marketing site.** Outside scope of this audit, but on the path.
17. **A real font catalog with license records.** Curate, host, attribute.

**Wall-clock for the public-launch increment: 3–5 months at one engineer + occasional contractors.** The biggest unknown is render-farm economics (see vision doc §R2) — if you under-price render minutes you bleed; if you over-price you don't compete. Build the meter early, set conservative initial limits, raise them as data comes in.

---

## High-leverage moves

In order of *value delivered per day of work*, the moves that pay the most:

### 1. The projectStore-to-per-tenant refactor unlocks half the alpha roadmap
Items 4, 5, 9, 10 in the alpha roadmap all sit on top of a non-global project store. Until that lands, every other change is a layer on a wobbly base. **Do it first.** Once `projectStore` becomes `projectStore.for(userId, projectId)`, the auth wiring becomes trivial and the quota story becomes "one row in `tenant_usage_daily`".

### 2. Adding auth to every `/api/*` endpoint is a one-day spike with outsized risk-reduction
The auth middleware *exists*. The session config *exists*. The hash config *exists*. The reason the system is wide open is one line of code per route. The cost-benefit ratio of doing this today vs after item 1 is small enough that you can do it now and accept the brittleness while the refactor lands.

### 3. The SSRF fix is two lines of validator code and removes the worst credential-exfil vector
A regex on `asset.src` in `validateComposition` that rejects `^https?:` (and `^file:`, `^ftp:`, `^gopher:` for taste) plus a matching MCP-tool guard closes a class of attacks the rest of the system has no defence against. Two lines, four tests.

### 4. A Dockerfile + a CI pipeline are the bridge between "works on my machine" and "anyone can ship a fix"
Right now, `bun install && bun run build && node ace serve` on the founder's MacBook is the deploy pipeline. The skia-canvas native build in Linux containers is the *first* thing to debug — better to do it in calm conditions now than under launch pressure later. Day-one Dockerfile + a GitHub Actions workflow that runs typecheck + tests buys real velocity once you have collaborators.

### 5. A `usage_events` append-only table now is cheap; retrofitting metering after launch is expensive
The metering schema is the kind of cross-cutting concern that *will* require touching every controller and worker. Adding it while there are only 5 places that need to write to it is hours of work; adding it later when there are 30 places is days.

### 6. The MCP hosted-endpoint story is what makes davidup a moat
Per the SaaS vision doc, "agents author against the same library, the same brand kit, the same render farm" is the differentiator. **Hosted MCP-over-HTTP with per-tenant auth is the singular feature that turns davidup from "an editor with an LLM plugin" into "an agent-native platform"** — it's also the riskiest piece because MCP-over-HTTP transport is newer and the auth story for it is less travelled. Plan to spend two focused weeks here once items 1-5 are in.

### 7. Defer everything else
- Don't build a marketplace until you have paying tenants.
- Don't build collaboration until you have tenants asking for it.
- Don't build mobile until desktop revenue is profitable.
- Don't build SOC2 until you're talking to enterprise prospects.
- Don't build Postgres migration until SQLite has actually run out of room (it won't, for the first 100 tenants).

**The risk of premature platformification is the dominant risk for this project right now.** The engine is good. The editor is good. The hard part is converting that quality into per-user value at a price someone will pay, and the SaaS shell needed to do that is much smaller than the SaaS shell the vision document hints at. Build the alpha shell. Ship to ten paying users. Let their behaviour pick the next ten items, not this audit.

---

## Closing assessment

**This is not "vibe-coded for a demo".** The engine, the editor server, the MCP bridge, and the precompile pipeline are deliberate, tested, well-documented code with internal consistency (see the inline comments referencing audit findings like D11, the explicit single-tenant scope in the PRD, the path-guard module factored to a single source of truth). The author knew they were building a single-user local tool and did so cleanly.

**The SaaS gap is deliberate, not accidental.** The vision document at `vision/davidup-saas-vision.html` and the PRD at `vision/davidup-v1.0-editor-prd.md` both call out v2.0 as the multi-tenant turn. The current codebase honours that scope honestly — it does not pretend to be SaaS-ready and it does not hide its single-user assumptions.

**The cost to close the gap is real but bounded.** 3 weeks to alpha, 3-5 months to public launch, for a single engineer. The largest single risk inside that window is the `projectStore`-to-per-tenant refactor — not because it's hard in isolation, but because the singleton coupling has metastasised across the command bus, MCP bridge, render worker, and library index, and each coupling is a place a tenant could leak into another's state if the refactor is incomplete.

**If I had to issue one recommendation:** spend the next two weeks rewriting `apps/editor/app/services/project_store.ts` and every importer of it into a tenant-aware façade. Don't add auth yet, don't add billing yet, don't add the Dockerfile yet. The store refactor is the keystone — every other SaaS-ification item is a brick that needs it to be in place. Once the store knows about tenants, the rest is straightforward.
