# The Asset Library: one store for davidup and hdf

A plan for a single, searchable asset library that both apps read and write,
that an agent can query before it composes, and that we can grow with assets
made in house. Written 2026-09-24 against `034b90b` (hdf 4.0 complete with W3,
rough edges RE4-1..RE4-6 closed; davidup v1.3 with L-1, B-5..B-8 and
RE-14 closed). Nothing here is built.

Same shape as `hand-drawn-film-v4-plan.md`: one session per block, a
done-when, one commit `assets: <id> <title>`, both test suites green
(`npm test` in the root, `npm test` in `handdrawn/`), hdf goldens holding for
every film a session does not name, `tests/mcp/manifest.test.ts` green when
the MCP surface moves.

---

## 0. The verdict

**Doable: yes, and most of it exists in one of the two apps already.**

hdf has the right substrate and davidup has the right hooks. hdf's store
(`handdrawn/core/assets.js`) is content-addressed, carries a closed licence,
a credit, a source, tags, and per-kind derived facts (silhouette, palette,
word timing, mouth shapes), validates every payload against its kind before
it writes, and is what the skill tells the agent to search before drawing.
davidup has the hashing upload pipeline, ffprobe, thumbnail rendering, a
two-root shadowing rule (project beats global), an `fs.watch` catalog, an
MCP tool pattern with injected deps, and a `scheme:` prefix in asset srcs
that the loaders, the CLI and the editor already honour.

What neither has: **one library**. Today there are five places an asset can
live (`handdrawn/assets`, `~/.davidup/library/{assets,fonts}`,
`<project>/library/assets`, `<project>/assets/hdf`, and paths relative to a
composition), three record shapes, two hashes (sha1 in hdf, sha256 in the
editor), no search worth the name on either side (both are AND-substring,
unranked), no previews for most kinds, provenance on the davidup side only as two
optional fields on the composition asset (RE-14), and
no way for a davidup composition to use a Met cutout that hdf already holds
or for an hdf film to use a paper texture the editor uploaded.

**Recommended: yes, with one thesis and one discipline.**

The thesis: *an asset is a content-addressed blob with a record that says
what it is, where it came from, what it is for, and how each app takes it.*
The record is the product. Search ranks records; previews draw records; the
agent reads records and gets, in the same answer, the exact call that brings
the asset into a composition or a film.

The discipline: **the library is a directory, not a service.** A shelf is a
folder with `catalogue.json`, `blobs/` and `thumbs/`. Three shelves are
searched in order: the open project, the user's `~/.davidup/assets`, and the
repo's `assets/` (the house shelf, in git). No database, no daemon, no cloud
call in this version. The north-star doc
(`ultrathink-and-brainstorm-with-fluttering-rain.md`) keeps its embeddings,
graph and flywheel as a later layer *on top of* this catalogue; this plan is
its phase 1, done in a way both apps share.

---

## 1. Where it stops today (audit)

Each row is a fact of the code, with where to look.

| area | davidup today | hdf today | consequence |
|---|---|---|---|
| identity | composition `assets[]` keyed by a per-composition `id` with a `src` path (`src/schema/zod.ts:276`); editor uploads hash with sha256 (`apps/editor/app/services/asset_pipeline.ts:490`); hand-authored srcs never hashed | `catalogue.json` id → entry with `sha` (sha1) and `blobs/<sha>.<ext>` (`core/assets.js:1-9`) | the same PNG is two things in the two apps and three things across projects |
| record | image/font/audio/video with ffprobe facts only; `library/index.json` entries come in two flavours (hand `{id,name,url}` and pipeline `{id:hash,kind,hash,size,...}`), and cards read `raw.type` while uploads write `kind` (`LibraryCard.vue:136`, `useLibraryDrag.ts`) | seven kinds, closed `LICENCES`, credit, source, tags, desc, per-kind fields (`core/assets.js:39-63`) | a davidup asset can carry `credit` and `licence` (RE-14) but no source, tags or desc, and a library entry carries none of them; an uploaded video loses its badge and drops onto the stage as a sprite |
| search | `list_library` substring over id/name/description (`library_index.ts search`), editor-hosted only (`requireLibraryControls`) | `hdf find` AND-substring over id/name/tags/desc/credit/source, no rank, exact `--kind` only (`core/assets.js:265-271`) | an agent asking for "warm paper" or "a dog" gets nothing unless the word is literally in the record |
| previews | `library_thumbnail.ts` renders every asset as an image sprite at t=0.5, resolves global items against the *project* root, falls back to a placeholder | `hdf sheet store <id>` per kind (puppet, hand, motif, cutout) written to gitignored `assets/sheets/` | no preview for audio, video or font in the MCP path; hdf sheets are not reachable from davidup |
| resolution | `global:` → `~/.davidup/library`, `bundled:` → package fonts, else raw path (`src/assets/node.ts:218`); ffprobe in `register_asset` probes the raw relative path; nothing checks a file exists | `fromStore(ids)` reads the store next to the package or `{id, from}` (`cli/load.mjs:26-44`); `peek()` for looks | a composition moved to another machine finds nothing; a typo'd src registers fine and fails at render |
| provenance | optional `credit` + `licence` on every composition asset, same enum as hdf (`ASSET_LICENCES`, `src/schema/zod.ts`, RE-14), `W_ASSET_CREDIT` when CC-BY/CC-BY-SA has no credit; nothing on library entries or uploads | licence, credit, source on every entry; lint `credit` for `unknown` | provenance is typed into each composition by hand and is lost when the same file is used in the next project |
| derived assets | hdf clips, sprites, model sheets, hand fonts copied to `<project>/assets/hdf/` by `render_hdf_clip` and `scripts/hdf-*.ts`; no record of what made them | puppets from SVG, hands from TTF, mirrors from packs: the source file is named in `file`, nothing says how to remake it | a regenerated clip is a new file with no link to the film, the look or the frames it came from |
| seed | `scripts/seed-global-library.ts` rewrites `index.json` with `assets: []`, wiping uploaded global assets; `X_profile.png` sits in `~/.davidup/library/assets` uncatalogued | `hdf import` is the only door, and `hdf photo` writes a data-URL module first | the "global pool" forgets what was put in it |
| cross-app | `render_hdf_clip` (D5) is the only bridge, one direction, by copy | `S16` scripts, one direction, by copy | a Met cutout cannot be a davidup sprite; an editor upload cannot be an hdf stock |
| agent story | README + `examples/mcp-demo.md`; `list_library` needs the editor | skill: "`hdf find` before drawing anything" (`SKILL.md:141-176`), inventory paragraph out of date | the davidup agent has no "find before placing" rule and no tool that works standalone |

---

## 2. Fixed decisions (so sessions do not re-derive them)

- **One package, `assetlib/`, plain ESM JavaScript with a hand-written
  `index.d.ts`, zero dependencies.** hdf has no build step and imports
  `.js`; davidup compiles TypeScript and would otherwise ship a stale
  `dist/` to hdf (the memory note on stale snapshots). `node:crypto` for
  hashing, header sniffing for PNG/JPEG/WebP type and dimensions (hdf's
  `imageType` in `core/assets.js:70` and the editor's `readImageDims` in
  `asset_pipeline.ts:356` are the two halves), everything heavier (ffprobe, skia, a preview renderer) is
  *injected* by the host, the way davidup injects `probeVideo`.
- **A shelf is a directory.** `<shelf>/catalogue.json` (one entry per line,
  ids sorted, as hdf writes it today), `<shelf>/blobs/<sha256>.<ext>`,
  `<shelf>/thumbs/<sha256>.png` (regenerable, gitignored on the house shelf
  except where a session says otherwise), `<shelf>/src/` for sources worth
  keeping. Nothing else.
- **Three shelves, searched in order: `project`, `user`, `house`.**
  `<project>/assets/`, `~/.davidup/assets/` (`$DAVIDUP_ASSETS` overrides),
  `<repo>/assets/` (`$DAVIDUP_HOUSE` overrides; the packaged davidup ships
  it). Same id on two shelves: the earlier shelf wins and the record carries
  `shadowed: ['house']`, exactly the editor's project-beats-global rule.
  `handdrawn/assets/` **moves** to `<repo>/assets/` in H4; until then it is
  the house shelf by path.
- **sha256, one hash.** hdf's sha1 `sha` becomes sha256 in H1; the field
  stays `sha`. Blobs are renamed, not re-encoded, so every hdf golden holds.
  `sha:<hex>` (any unambiguous prefix of 12+ hex) is accepted wherever an id
  is.
- **Ids are flat, lower-case, `/^(pack:)?[a-z0-9][a-z0-9-]*$/`**, hdf's rule
  minus the `/i`. A composition asset id and a library id are different
  namespaces: `register_asset` keeps its `id` and takes `library: '<id>'`
  (or an `asset:` src) to say which record it is.
- **The render contract does not change.** No new field on
  `src/schema/zod.ts` assets. A library reference is a src scheme,
  `asset:<id>` or `asset:<id>@<sha12>`, resolved exactly where `global:` is
  resolved today (`resolveGlobalSrc`, the browser loader, the editor's
  `rewriteAssetsForBrowser`, `resolveAssetSrcAgainst` leaves schemes alone
  already). The `@sha12` pin is optional; a mismatch is `E_ASSET_STALE`.
- **Kinds are the union of both apps; `media` is the axis apps filter on.**
  `image, video, audio, font` (davidup's four) and `cutout, clip, puppet,
  hand, stock, motif, sample` (hdf's seven). Each kind has one `media`:
  `raster` (image, cutout, stock), `video`, `audio` (audio, sample), `font`,
  `vector` (motif), `data` (clip, puppet, hand). A davidup agent asking for
  `media: raster` gets cutouts; an hdf film asking for `kind: stock` gets
  only paper.
- **Provenance is mandatory.** `licence` stays hdf's closed enum
  (`CC0 | CC-BY | CC-BY-SA | OFL | PD | own | unknown`); `unknown` is
  accepted with a warning and flagged by `asset check`. `credit` and
  `source` are strings, empty allowed for `own`. `assetlib`'s `LICENCES`
  and davidup's `ASSET_LICENCES` (RE-14) are one list: a test asserts
  they are equal. `use.davidup.args` copies the record's `credit` and
  `licence` into the composition asset, so `W_ASSET_CREDIT` and a
  credits card work without the agent typing them.
- **A made asset says how it was made.** `made: { tool, from: [ids], args,
  at }` on any record produced by our own tools (`hdf render`, `hdf sprite`,
  `hdf hand --export-ttf`, a davidup render, a synth sample). `asset remake
  <id>` re-runs it. The house shelf is partly generated and git holds the
  recipe; blobs over 5 MB on the house shelf must be `made` (gitignored,
  regenerable) or go through git-lfs, decided per session.
- **Search is local, ranked, faceted, explainable, and has one seam.** Field
  weights and a synonym table in this version; `openLibrary({ rank })` takes
  a ranker so embeddings can slot in later without a new tool.
- **Previews are a contract, not a renderer.** `assetlib` owns the thumb
  path and the cache rule (sha + preview version); each host registers
  `previewers[kind]`. hdf registers its sheet makers, davidup its
  `renderPreviewFrame` path, `assetlib` itself draws the fallback card
  (kind, id, dimensions, licence) with no dependency.
- **Every search result carries `use`.** For each app that can take the
  record, the exact call: `davidup: { tool: 'register_asset', args }` and
  `hdf: { assets: [id], code: "fromStore(['teapot'])" }`. The agent copies,
  it does not translate.
- **davidup tools work standalone.** The library is a directory, so
  `search_assets` and friends live on the plain `davidup mcp` server too,
  not behind `requireLibraryControls`. `list_library` keeps templates,
  behaviors and scenes; its `asset` and `font` kinds are served from the
  library from D2 on.
- **No database, no daemon, no cloud in this version.** Catalogues are
  small (hdf: 35 entries, 40 KB); a full scan ranks in microseconds. The
  north-star's SQLite + vectors is a later layer that *indexes* these
  catalogues; it must never become the source of truth.

---

## 3. The model

### 3.1 The record

```jsonc
{
  "id": "teapot",                 // flat id, unique per shelf
  "kind": "cutout",               // one of the eleven
  "media": "raster",              // derived from kind, stored for filters
  "name": "Teapot",
  "desc": "Silver teapot, three-quarter view, on white",   // one line, searchable
  "tags": ["met", "object", "kitchen", "silver"],
  "licence": "CC0", "credit": "Teapot, ca. 1860. The Met, Open Access", "source": "https://…",
  "sha": "9f2c…64hex", "ext": "webp", "bytes": 41210,
  "added": "2026-09-24", "by": "hdf import",               // when and which door
  "w": 815, "h": 739, "box": [0, 0, 815, 739], "alpha": true,
  "colours": [{ "hex": "#dbdddf", "area": 0.26 }, …],      // top 8, every raster/video
  "sil": { … },                                             // cutout only (as today)
  "made": null,                                             // or { tool, from, args, at }
  "rel": { "from": ["fox-svg"], "variants": ["teapot-hi"] } // optional links between ids
}
```

Common envelope: `id kind media name desc tags licence credit source sha
ext bytes added by`. Per-kind fields are hdf's today (`SCHEMAS` in
`core/assets.js:55-63`) plus davidup's ffprobe facts on `video` (`sec fps w h
alpha codec audio`) and `audio` (`sec rate channels codec`), and `family
weight style glyphs` on `font`. `colours` and `alpha` are computed for every
raster and for a video's representative frame at import, so "dark background
with room for text" is a filter, not a guess.

### 3.2 Kinds

| kind | media | payload | comes from | davidup takes it as | hdf takes it as |
|---|---|---|---|---|---|
| image | raster | png/jpg/webp | upload, import, render | sprite | stock, doodle backdrop |
| cutout | raster (alpha) | webp/png + sil | `hdf photo`, import | sprite | cutout |
| stock | raster | webp/png | import, `made` (generated paper) | sprite (background) | paper stock |
| video | video | mp4/mov/webm | upload, import, `made` (hdf render, davidup render) | video item, audio source | (later: rotoscope source) |
| audio | audio | mp3/wav/m4a/ogg/aac | upload, import, `made` (synth) | audio track | sample without timing |
| sample | audio | wav + align/mouth | `hdf align`, `say`, import | audio track | narration, lip sync |
| font | font | ttf/otf/woff2 + family | seed, upload, `made` (hand → ttf) | font asset | `hdf hand --font` source |
| hand | data | json glyphs | `hdf hand` | (via made font) | look `~hand:<id>` |
| puppet | data | json | `hdf svg`, `hdf stick`, `hdf sketch`, workbench, mirrors | (via made sprite sheet) | `puppet(id)` |
| clip | data | json poses | `hdf clip`, roto | – | `clipFromStore(id)` |
| motif | vector | json ops | `hdf svg --motif` | (via made image) | motif |

Where davidup "takes it via made", the derivation is a record of its own on
the same shelf with `made.from: [id]`, so `asset show fox` lists the sprite
sheet and the model sheet made from it and `search_assets` can answer "a
character I can drop on the stage" with the sheet.

### 3.3 Shelves and shadowing

```
<project>/assets/      project  — what this piece brought in; travels with the project
~/.davidup/assets/     user     — the user's own pool across projects; absorbs ~/.davidup/library/{assets,fonts}
<repo>/assets/         house    — in git; hdf's store today; where in-house production lands
```

`openLibrary({ shelves })` reads all catalogues once, builds one id map
(first shelf wins, `shadowed` filled) and one sha map (every shelf holding the
bytes). `resolve(id)` returns the winning blob path; `resolve('sha:…')` any
holder. Writes name a shelf; the default is `project` when one is open, else
`user`. `move(id, shelf)` is the editor's *promote* generalised.

### 3.4 Identity and pins

A record's identity is its `sha`. Two imports of the same bytes on one shelf
are one blob and one entry (hdf's rule). The same bytes on two shelves are two
entries that `asset check` reports as duplicates and `move` collapses. A
composition may pin: `asset:teapot@9f2c1a3b4c5d` renders only that blob and
errors `E_ASSET_STALE` if `teapot` now points elsewhere; without the pin the
id follows the record, which is what a project wants while it is being made.

---

## 4. Search

### 4.1 The query

```jsonc
{ "q": "warm paper texture",                   // free text, optional
  "kind": ["stock", "image"], "media": "raster", "shelf": ["house", "user"],
  "tags": ["paper"], "licence": ["CC0", "own", "PD"],
  "alpha": true, "minW": 1920, "aspect": "16:9", "secMin": 3, "secMax": 30,
  "dark": true, "hue": "warm",                  // from colours
  "limit": 12, "facets": true }
```

Every filter is optional. `q` is tokenised, diacritics folded, each token
matched as a prefix against a field index built once per `openLibrary`.

### 4.2 Ranking

Score per record = Σ over tokens of the best field hit, weighted: id 6, name
5, tags 4, desc 2, credit and source 1, kind and licence 1; an exact id match
adds 10; a token that only matches through the synonym table
(`assetlib/synonyms.json`: `dog → animal`, `paper → stock texture`, `voice →
sample narration`, `character → puppet`) scores at 0.6 of its field weight.
Ties break on `added` descending then id. No token match and no filter hit
means the record is out; a query with filters only lists the filter's hits
sorted by kind then id. Deterministic, so a test can pin an order.

`openLibrary({ rank })` lets a host replace the scorer with one that has seen
an embedding; the result shape does not change.

### 4.3 The result

```jsonc
{ "count": 3, "total": 41,
  "facets": { "kind": { "stock": 2, "image": 1 }, "licence": { "own": 3 }, "tags": { "paper": 3, "warm": 2 } },
  "hits": [ {
      "record": { … },
      "shelf": "house", "path": "/…/assets/blobs/9f2c….webp", "thumb": "/…/assets/thumbs/9f2c….png",
      "why": ["name: paper", "tags: warm", "colours: warm"],
      "use": {
        "davidup": { "tool": "register_asset", "args": { "id": "paper-warm", "type": "image", "src": "asset:paper-warm@9f2c1a3b4c5d" } },
        "hdf":     { "assets": ["paper-warm"], "code": "fromStore(['paper-warm'])", "look": "paperInk~stock:paper-warm" } } } ] }
```

Facets let the agent narrow in one more call instead of paging. `why` is the
actual field hits, so the agent can tell a lucky substring from a real match.

---

## 5. The package `assetlib` (A)

Layout:

```
assetlib/
  index.js         openLibrary, KINDS, MEDIA, LICENCES, validate, sha
  catalogue.js     read/write one shelf, the line format, orphans
  record.js        schemas per kind, validators, media of kind
  search.js        tokeniser, field index, scorer, facets, synonyms.json
  preview.js       thumb paths, cache rule, fallback card (pure pixels, no skia)
  use.js           the `use` block per app
  image.js         PNG/JPEG/WebP type + header dims (from core/assets.js imageType), colours quantiser (from cli/photo.mjs)
  cli.js           `asset` binary
  index.d.ts
  test/            node --test
```

### A1. Read a shelf

*The catalogue as it is, through one door.*

`readShelf(root)` returns `{ root, name, entries: Map, ids, entry(id),
blobPath(e), thumbPath(e), has, orphans() }`, reading hdf's format unchanged
(sha1 accepted on read, flagged by `check`). `KINDS`, `MEDIA`, `LICENCES`,
`mediaOf(kind)`, `validate(id, entry)` moved from `core/assets.js` with the
four davidup kinds added. `openLibrary({ shelves: [{name, root}] })` merges
shelves with shadowing. **Done when** `assetlib/test/read.test.js` opens
`handdrawn/assets` and a fixture project shelf, `get('teapot')` is the hdf
entry, a shadowed id reports both shelves, and an unknown id errors naming
the shelves searched.

### A2. Write: put, remove, gc, move

*One way in, one way out.*

`put(shelf, entry, bytes)` hashes with sha256, validates, derives `media`,
`bytes`, `added`, dims and `colours` for rasters (the `colours()` quantiser from
`handdrawn/cli/photo.mjs:183`, moved), writes the blob if new, writes
the catalogue atomically (temp + rename, hdf's `save()` format). `remove(id)`
and `gc()` as hdf's today; `move(id, toShelf)` copies blob + thumb + entry
and removes from the source, refusing when the target has the id with a
different sha. Injected probes: `{ probeVideo, probeAudio, fontMeta }`
optional; a missing probe leaves the fields empty and returns a warning
string (davidup's `register_asset` rule). **Done when** put is idempotent
(same bytes → one blob, entry replaced), a bad licence and a missing kind
field refuse before any write, `move` round-trips a cutout between two
temp shelves and `gc` reports nothing after.

### A3. Search

*Ranked, faceted, explainable.*

`search(query)` per §4: tokeniser with diacritic folding, prefix index over
the weighted fields, synonyms, filters (kind, media, shelf, tags, licence,
alpha, minW/minH, aspect within 2 %, secMin/secMax, dark from mean luminance
of `colours`, hue from the dominant swatch's hue band), facets, `why`.
**Done when** a fixture catalogue of 30 records gives pinned orders for
`"paper"`, `"warm paper"`, `"dog"` (via synonym), `{ media: 'raster', alpha:
true }`, and `{ q: 'fox', kind: ['puppet'] }`; facets add up to `count`;
a query with no hits returns `hits: []` and the facets of the whole shelf
set, so the agent sees what exists.

### A4. Previews

*Every record can be looked at.*

`preview(id, { previewers })` returns the cached thumb path when
`thumbs/<sha>.png` exists and its header comment version matches, else calls
`previewers[kind]` (host-registered, returns PNG bytes 480 px wide), else
draws the fallback card: a coloured field from `colours[0]`, the kind and id
lettered with a tiny built-in bitmap font, dimensions and licence. `sheet(ids,
{ cols })` tiles previews into one contact sheet PNG with id captions, the
image an agent asks for when it wants to compare candidates in one look.
**Done when** the fallback card renders for every kind with no previewer,
a registered previewer is used and cached by sha, and a 12-id contact sheet
is 3×4 with captions.

### A5. The `use` block

*The result is the call.*

`use.js` builds per record: `davidup` when the kind maps to a davidup asset
type (image, cutout, stock → `image`; video → `video`; audio, sample →
`audio`; font → `font`; puppet/hand/motif → `null` unless a `made` sprite
sheet, font or image exists, in which case that record's id is offered),
with `src: 'asset:<id>@<sha12>'`; `hdf` for every kind hdf reads
(`fromStore` line, and the look modifier for `hand`, `stock`, `motif`).
**Done when** a fixture of one record per kind produces the expected `use`
for each, and a puppet with a made sheet offers the sheet.

### A6. The `asset` CLI

*The library from a terminal.*

`asset find <words> [--kind --media --shelf --tags --licence --alpha --min-w
--aspect --json]`, `asset show <id>` (record, shelves, thumb path, what was
made from it, what it was made from), `asset add <file> --kind --name
[--licence --credit --source --tags --desc --shelf]`, `asset tag <id> +tag
-tag`, `asset desc <id> "<line>"`, `asset rm <id>`, `asset mv <id> --to
<shelf>`, `asset gc [--dry]`, `asset thumb <id|--all>`, `asset sheet <ids…>`,
`asset ls [--shelf]`, `asset check` (licence unknown, missing blob, orphan,
duplicate sha across shelves, missing thumb, sha1 entries, id not matching
the rule, desc empty). Root `package.json` gets `"bin": { "asset":
"assetlib/cli.js" }`. **Done when** `assetlib/test/cli.test.js` covers each
verb on a temp shelf, and `asset check` on `handdrawn/assets` prints the
real findings (the two puppets with empty tags, `test` hand's licence, the
sha1 entries).

---

## 6. davidup adoption (D)

### D1. The `asset:` src scheme

*A composition names a record, not a path.*

`resolveGlobalSrc` (`src/assets/node.ts:218`) learns `asset:<id>[@sha12]`
via `openLibrary` with the standard shelves (project from `DAVIDUP_PROJECT`
or the composition's directory when it holds `assets/catalogue.json`);
`E_ASSET_STALE` on a pin mismatch, `E_ASSET_MISSING` naming the shelves on a
miss. The browser loader maps it to `/asset-files/<shelf>/<sha>.<ext>`; the
editor serves that route from the three shelves and
`rewriteAssetsForBrowser` passes the scheme through. `register_asset` with
an `asset:` src fills the ffprobe fields from the record instead of probing.
`validate` gains an existence check for `asset:` and `global:` srcs
(`W_ASSET_FILE_MISSING`, a warning, since a remote render may hold the
file). **Done when** `tests/assets/node.test.ts` resolves a fixture shelf,
a pinned stale id errors, `davidup render` of a composition using
`asset:teapot` produces a frame (integration test next to
`renderGlobalAssets.integration.test.ts`), and the editor plays it.

### D2. MCP: search and read

*The standalone server can search.*

New tools on `TOOLS`, no editor required: `search_assets` (the §4 query, the
§4 result with `use`), `get_asset { id }` (record + shelves + made-from +
made), `get_asset_preview { id | ids, sheet? }` (base64 PNG; `ids` returns
the contact sheet). `list_library` serves `asset` and `font` items from the
library (`url` becomes the `asset:` src) so existing agents keep working.
`server.json`, README count, `examples/mcp-demo.md`, `manifest.test.ts`
updated (memory note: three places). **Done when** `tests/mcp/assets.test.ts`
searches a fixture shelf through `dispatchTool`, the preview returns a PNG
for a cutout and a contact sheet for three ids, and the manifest test is
green with the new count.

### D3. MCP: write and use

*One call from search hit to placed item.*

`add_asset { path | id, kind, name, licence, credit, source, tags, desc,
shelf? }` (a path is hashed and put; `id` with `shelf` moves), `tag_asset`,
`use_asset { id, as: 'sprite' | 'video' | 'audio' | 'font', place: {…} }`
which registers (`register_asset` with the record's `use.davidup.args`) and
then dispatches `add_sprite` / `add_video` / `add_audio_track` / returns the
font id for `add_text`, through `deps.call` so the editor's command bus sees
it. Sprite dimensions default to the record's `w`/`h` scaled to fit a quarter
of the stage, not the drag code's 240×240. **Done when** a test composes a
cutout, a video and a sample from three `use_asset` calls and `validate`
passes; `add_asset` refuses a licence outside the enum; the editor's
`apply_command` allow-list carries the new commands.

### D4. Derived assets land in the library

*The bridge writes records, not files.*

`render_hdf_clip` and `scripts/hdf-bridge.ts` put the clip on the project
shelf as `video` with `made: { tool: 'hdf render', from: [film's assets],
args: { film, look, ar, width, alpha } }`, sprites as `image` with `sheet`
and `made.from: [puppet]`, hand fonts as `font` with `made.from: [hand]`,
model sheets as `image`. The composition src becomes `asset:<id>@<sha12>`.
`<project>/assets/hdf/` is no longer written. **Done when**
`tests/mcp/renderHdfClip.test.ts` and `tests/cli/hdfBridge.integration.test.ts`
find the records on the project shelf, `get_asset` shows the `made` block,
and a second render of the same film with the same args replaces the entry
in place (same id, new sha).

### D5. The seed writes the user shelf

*The pool remembers.*

`scripts/seed-global-library.ts` puts the ten fonts on the user shelf
(`kind: font`, licence `OFL`, credit the foundry, `family`, `weight`) and
writes `index.json` fonts as `src: 'asset:<id>'`; it stops touching
`assets: []`. `X_profile.png` and anything else found loose in
`~/.davidup/library/{assets,fonts}` is offered for import by `asset check
--legacy`. `global:` srcs keep resolving unchanged. **Done when** a dry run
against a temp root lists ten font puts, a second run is a no-op, and
`list_fonts` shows them with `library` scope.

### D6. Palette and text-room facts

*Filters an agent actually uses.*

At `put`, every raster and every video's representative frame (first frame
at 1 s, via the injected `extractFrame`) gets `colours` (top 8 by area,
hdf's quantiser), `dark` (mean luminance < 0.4), and `room`: a 3×3 grid of
busy-ness (edge density) so "quiet top-left for a headline" is
`room.tl < 0.2`. Search filters `dark`, `hue`, `room`. **Done when** the
Met cutouts get palettes matching their current `colours`, `long.mp4`
(solid navy) is `dark: true` with `room` all zero, and `search_assets
{ dark: true, room: 'tl' }` ranks it.

---

## 7. hdf adoption (H)

### H1. `core/assets.js` on `assetlib`, sha256

*Same films, one store engine.*

`core/assets.js` keeps its exports (`fromStore`, `recordOf`, `readCatalogue`,
`search`, `KINDS`, `LICENCES`) as thin wrappers over `assetlib`, with
`ASSET_ROOT` as the `house` shelf. A migration `asset migrate --sha256
<shelf>` rehashes every blob, renames it, rewrites `sha` on the entry, the
`mirror.sha` in `packs/manifest.json` (via `hdf donate --manifest`), and any
`sha` a test names. `assets.web.js` and `cli/dev.mjs`'s `storeState` read the
same records. **Done when** all hdf tests pass, every golden holds, no sha1
entry remains (`asset check` clean on that rule), and `hdf lint` still
passes `pack-mirror` on every pack cel.

### H2. `hdf find/import/remove/gc` become `asset`

*One vocabulary in both CLIs.*

`hdf find` calls `assetlib` search and prints hdf's line (kind, licence,
what it takes, sheet, credit) plus `why`; `--look` (v3 §1.10, never built)
filters to what a look can use. `hdf import` is `asset add` with hdf's
tracing for cutouts kept; `hdf remove`, `hdf gc` delegate. Pack cels appear
in `asset find` results as their `pack:` mirrors (they are records already).
**Done when** `test/assets.test.js` and `test/cli.test.js` pass with the
delegations, `hdf find fox --json` equals `asset find fox --json` on the
house shelf, and `hdf find --look paperInk` lists stocks and hands only.

### H3. hdf previewers

*The sheets become thumbs.*

hdf registers `previewers` for `puppet` (rest pose, three views if it has
them), `hand` (a pangram), `motif`, `cutout` (the blob with a silhouette
outline), `clip` (four frames as sticks), `sample` (a waveform), `stock`
(the paper at 1:1 with a pen stroke over it). `hdf sheet store` stays for
the full model sheets. **Done when** `asset thumb --all` on the house shelf
writes a thumb for all 35 entries, none falls back, and `get_asset_preview
{ ids: [fox, teapot, hershey-script] }` from davidup returns one contact
sheet drawn by hdf's previewers.

### H4. The house shelf moves to `<repo>/assets/`

*In-house assets live at the root, in git.*

`git mv handdrawn/assets assets`; `ASSET_ROOT` points at it; `handdrawn`'s
`.gitignore` rules for `sheets/` (now `thumbs/`) move; `hdf bundle` and `hdf
dev` read the new root; `DAVIDUP_HOUSE` documented; the packaged davidup
lists `assets/catalogue.json`, `assets/blobs` in `package.json#files` with a
size budget check in `asset check --house` (no blob over 5 MB unless `made`
and gitignored). **Done when** both suites pass from a clean checkout, `npm
pack --dry-run` lists the house shelf, and a `davidup render` on a machine
with no `~/.davidup` still resolves `asset:teapot`.

### H5. The skill and the README

*The rule stays, the inventory is generated.*

`SKILL.md` "The store" section rewritten for `asset find`, `use` blocks and
shelves; the out-of-date "What it holds today" paragraph replaced by a line
telling the agent to run `asset ls --shelf house` (the inventory is now
data). `references/assets.md` updated. `handdrawn/README.md` §"The asset
store" points at `assetlib/README.md`. **Done when** the skill names no
command that does not exist and the README section is under a page.

---

## 8. The editor (E)

### E1. The Assets tab reads the library

*One catalogue behind the panel.*

`LibraryIndex` keeps templates/behaviors/scenes; `asset` and `font` items
come from `openLibrary` on the three shelves, watched with the same
`fs.watch` + 100 ms debounce on each `catalogue.json`. Cards show kind badge
from `record.kind` (the `raw.type` vs `kind` mismatch dies here), licence,
shelf, thumb from A4. Search box calls A3 with facets rendered as chips.
**Done when** `library.spec.ts` and `library_thumbnail.spec.ts` pass against
a fixture shelf, an uploaded video shows a video badge, and typing "paper"
shows facet chips.

### E2. Upload and drop

*Drop a file, get a record; drop a card, get an item.*

`POST /api/assets` becomes `put` on the project shelf (or `user` with
`target=global`), keeping the 50 MB limit and the extension list, adding the
form fields licence/credit/source/tags (licence defaults to `own` for a file
the user dropped, with the warning shown). A card dropped on the stage or a
track calls `use_asset` (D3), so every drop registers and places the right
kind. `AssetPicker.vue` lists the library, not only `composition.assets`,
and registers on pick. **Done when** `assets_upload.spec.ts` and
`library_drop.spec.ts` pass with the new paths, dropping an audio card on a
track adds an audio track, and dropping a video on the stage adds a video
item.

### E3. Promote is move

*`POST /api/library/promote` calls `move(id, 'user')`.* `promote_library_item.ts`
keeps its template/behavior/scene half. **Done when** `library_promote.spec.ts`
passes and a promoted asset's src in the open composition is rewritten from
`asset:<id>` on the project shelf to the same id on the user shelf with the
same sha (no visible change).

### E4. The record drawer

*Edit what search reads.*

Clicking a card opens a drawer: name, desc, tags (chips), licence (select),
credit, source, the thumb, what it was made from, what was made from it,
where it is used in the open composition. Edits call `tag_asset`/`asset
desc` equivalents through the command bus. **Done when** a Playwright test
edits a tag and the search box finds the asset by it within the watch
debounce.

---

## 9. In-house assets (I)

### I1. `made` and `asset remake`

*A generated asset is a recipe plus a blob.*

`made: { tool, from, args, at, version }` validated on every kind; `asset
remake <id>` dispatches on `tool` to a registered maker (`hdf render`, `hdf
sprite`, `hdf hand --export-ttf`, `davidup render`, `synth sample`, `paper`)
and replaces the blob in place, reporting whether the sha changed. `asset
check` flags a `made` record whose `from` id is missing. **Done when** a
test remakes a 6-frame hdf clip and gets the same sha (determinism), and a
remake after changing a `from` asset gets a new sha.

### I2. The first house pack

*Something worth searching for.*

Produced by our tools and committed with recipes:

- `stock`: six paper textures (warm cream, cold white, kraft, notebook
  ruled, blueprint, chalkboard) generated by a `paper` maker from hdf's
  `looks.js` stock code, 2048² webp, licence `own`.
- `sample` and `audio`: a dozen sound effects and two beds from
  `core/synth.js` (pop, boing, ding, whoosh, tick, pencil scratch, page
  turn, chalk, eraser, marker squeak; a calm bed, a bright bed), tagged
  `sfx` / `bed`.
- `font`: the four hands (`hershey-romans`, `hershey-script`,
  `hershey-cyrillic`, `test`) exported as TTF, `made.from` the hand.
- `image`: sprite sheets for the fox and octopus (`rest`, `walk`, `wave`) and
  model sheets, `made.from` the puppet.
- `image` with alpha: the seven Met cutouts are already usable as davidup
  sprites; they get `desc` lines and object tags (kitchen, armour, time,
  light, music) so they are findable.

**Done when** `asset ls --shelf house` lists them, every record has a desc
and at least three tags, `asset check --house` is clean, and the house shelf
stays under 15 MB in git (bigger `made` blobs gitignored with recipes kept).

### I3. Packs as tarballs

*Sharing is a file.*

`asset export <ids…|--shelf> --out pack.tgz` (catalogue slice + blobs +
thumbs) and `asset import pack.tgz --shelf user` (merge by sha, shadowing
rules, licence preserved). This is the "hosted asset service" of the v3
plan's §4 reduced to what git and a file can do. **Done when** a round trip
between two temp shelves is byte-identical and a conflicting id with a
different sha is reported, not overwritten.

---

## 10. Skills and docs (S)

### S1. The davidup agent story

*"Find before placing" on the davidup side.*

README's MCP section and `examples/mcp-demo.md` gain a "Bring in an asset"
walk: `search_assets` → `get_asset_preview` (contact sheet) → `use_asset`.
The eval-agent runner (`scripts/eval-agents`) gets one task that must use
the library. **Done when** the eval task passes with the tool trace showing
a search before the first `register_asset`.

### S2. Architecture and design docs

*The docs say what the code does.*

`ARCHITECTURE.md` §3.1 and §6 rewritten (assets are four types, loading
resolves `asset:`/`global:`/`bundled:`, the library package), §9 tool table
updated; `COMPOSITION_PRIMITIVES.md` §12.4 notes that library assets are
`asset:` srcs; `assetlib/README.md` written (the model, the shelves, the
CLI, the API, the `use` contract); `DAVIDUP_V1_REVIEW.md` roadmap row for
the shared brand kit points here. **Done when** every path and symbol named
in those sections exists.

---

## 11. The acceptance piece

One agent session, from the plain `davidup mcp` server (no editor), given
the brief *"a 20-second explainer opening: warm paper background, the fox
walks in, a title in a handwritten face, a pop when the title lands"*:

1. `search_assets { q: 'warm paper', media: 'raster' }` → the house stock.
2. `search_assets { q: 'fox walk', kind: ['image'] }` → the made sprite
   sheet (from the puppet); `get_asset_preview { ids }` to confirm.
3. `search_assets { q: 'handwritten', kind: ['font'] }` → `hershey-script`
   as a font.
4. `search_assets { q: 'pop', media: 'audio' }` → the sfx sample.
5. Four `use_asset` calls, `add_text`, tweens, `render_to_video`.

Acceptance: the render plays; `validate` is clean; every asset in the
composition is an `asset:` src with a pin; `get_asset` on each shows licence
and credit; deleting `~/.davidup` and rendering again from the repo checkout
gives the same hashes (everything came from the house shelf).

The mirror in hdf: `work/` film that names `paper-warm` as its stock and a
sample the editor uploaded, resolved through the project shelf.

---

## 12. Order and size

Sessions are half a day to a day each; the A track first because everything
sits on it, then H1 (the riskiest move: the hash) while the package is fresh,
then D and E in parallel, I when D4 exists, S last.

| session | title | days | needs | done |
|---|---|---|---|---|
| A1 | Read a shelf | 0.5 | – | [ ] |
| A2 | Write: put, remove, gc, move | 1 | A1 | [ ] |
| A3 | Search | 1 | A1 | [ ] |
| A4 | Previews | 1 | A1 | [ ] |
| A5 | The `use` block | 0.5 | A1 | [ ] |
| A6 | The `asset` CLI | 1 | A2 A3 A4 A5 | [ ] |
| H1 | `core/assets.js` on `assetlib`, sha256 | 1 | A2 | [ ] |
| H2 | `hdf find/import/remove/gc` become `asset` | 0.5 | A6 H1 | [ ] |
| H3 | hdf previewers | 1 | A4 H1 | [ ] |
| D1 | The `asset:` src scheme | 1 | A1 | [ ] |
| D2 | MCP: search and read | 1 | A3 A4 D1 | [ ] |
| D3 | MCP: write and use | 1 | A5 D2 | [ ] |
| D4 | Derived assets land in the library | 1 | A2 D1 H1 | [ ] |
| D5 | The seed writes the user shelf | 0.5 | A2 D1 | [ ] |
| D6 | Palette and text-room facts | 1 | A2 | [ ] |
| E1 | The Assets tab reads the library | 1 | A3 A4 D1 | [ ] |
| E2 | Upload and drop | 1 | D3 E1 | [ ] |
| E3 | Promote is move | 0.5 | E1 | [ ] |
| E4 | The record drawer | 1 | E1 D3 | [ ] |
| H4 | The house shelf moves to `<repo>/assets/` | 0.5 | H1 H2 H3 D1 | [ ] |
| I1 | `made` and `asset remake` | 1 | D4 | [ ] |
| I2 | The first house pack | 1.5 | I1 H3 H4 D6 | [ ] |
| I3 | Packs as tarballs | 0.5 | A2 | [ ] |
| H5 | The skill and the README | 0.5 | H2 H4 I2 | [ ] |
| S1 | The davidup agent story | 0.5 | D3 I2 | [ ] |
| S2 | Architecture and design docs | 0.5 | all | [ ] |

Twenty-six sessions, about 21 days. The spine (what the acceptance piece
needs) is A1 A2 A3 A5 D1 D2 D3 H1 D4 I2: ten sessions, about nine days;
everything else can follow at leisure.

Risks, named:

- **H1's hash change** touches every entry, the pack manifest and any test
  that names a sha. Mitigation: goldens hash pixels, not blobs, and the
  migration is a rename; do it in one commit with `asset check` proving no
  sha1 remains.
- **Shelf precedence surprises**: a project shelf `fox` shadowing the house
  fox silently. Mitigation: `shadowed` on the record, `asset check` reports
  every shadow, the editor card shows the shelf.
- **Editor route surface**: `/asset-files/<shelf>/<sha>` must never serve
  outside the three roots (`guardProjectDirectory` rules apply).
- **Package size**: the house shelf ships in the npm package (H4); the 15 MB
  budget in I2 and `asset check --house` hold it.

---

## 13. Not in this version

- Embeddings, vision captions, the usage graph, `resolve_assets` with
  intent, decay: the north-star doc's phases 2 to 6. This plan gives them
  the catalogue, the sha identity, the `made` provenance and the ranker seam
  they need.
- A hosted service, a marketplace, multi-machine sync. Sharing is git and
  `asset export`.
- Templates, behaviors and scenes in the asset library. They stay in
  `~/.davidup/library` and `<project>/library` under `LibraryIndex`; the
  same shelf model could hold them later, one kind each.
- Stock-footage providers (Pexels, Unsplash). An `asset add --from-url` with
  licence and credit filled from the provider is a natural I-track session
  once the record is stable.
- Removing `global:`. It keeps working; nothing new writes it.

---

## 14. Why this shape

hdf's store is the better half of what exists because it was designed around
the record: what a thing is, who made it, whether we may use it, what the
tools derived from it. davidup's library was designed around the file. The
plan takes hdf's record, davidup's hashing and probing, gives them one
package and one directory layout, and adds the two things neither has: a
search that ranks and explains, and a result that is already the next tool
call. Everything stays a folder of JSON and blobs, in git where it is ours
and in the home directory where it is the user's, so it is inspectable,
diffable and rebuildable, and the smarter layers the north-star imagines
have something solid to index.
