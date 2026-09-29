# assetlib

One asset library for davidup and hdf. The plan is `docs/asset-library-plan.md`.

An asset is a content-addressed blob with a record: what it is, where it came from, what it is for.
The library is a set of directories, not a service. Each directory is a *shelf*:

```
<shelf>/catalogue.json        id -> entry, one entry per line, ids sorted
<shelf>/blobs/<sha>.<ext>     payloads, named by the sha256 of their bytes
<shelf>/thumbs/<sha>.png      previews, regenerable
<shelf>/src/                  sources worth keeping
```

Shelves are searched in order: `project` (`<project>/assets`), `user` (`$DAVIDUP_ASSETS`, else
`~/.davidup/assets`), `house` (`$DAVIDUP_HOUSE`, else `handdrawn/assets` until H4 moves it to
`<repo>/assets`). When two shelves hold the same id, the earlier one wins and the record lists the
others in `shadowed`.

```js
import { openLibrary, standardShelves } from 'assetlib';

const lib = openLibrary({ shelves: standardShelves({ project: 'my-film' }) });
lib.get('teapot');                // { ...entry, id, media, shelf, shadowed }
lib.locate('teapot');             // { id, shelf, root, entry, path, thumb, shadowed }
lib.resolve('sha:9f2c1a3b4c5d');  // a blob's path, by any 12+ hex prefix of its sha
```

Writes go through one door and are validated before anything touches the disk:

```js
const out = await lib.put('user', { id: 'paper-warm', kind: 'stock', name: 'Warm paper', tags: ['paper'],
  licence: 'own', credit: '', source: '', box: [0, 0, 2048, 2048] }, bytes, { probes });
out.warnings;                     // a probe the host did not give, or one that failed
lib.move('paper-warm', 'house');  // blob, thumb and entry; refuses a target holding the id with other bytes
lib.remove('paper-warm');         // and its blob and thumb, when nothing else on the shelf shares them
lib.gc({ dry: true });            // orphan blobs and stale thumbs
```

`put` hashes with sha256 and derives `media`, `ext` (by the bytes' magic), `bytes`, `added` and a raster's
header size and alpha; the caller's fields win over anything derived except those four. Heavier facts come from
the host's `probes` (`probeVideo`, `probeAudio`, `fontMeta`, `pixels`, `extractFrame`), each optional; davidup's
ffprobe results are read as they are. `shelf.put` is the same without probes, and synchronous.

A raster's pixels (`pixels`) and a video's frame at 1 s (`extractFrame`, half way through a shorter video; the
default one runs ffmpeg, `$FFMPEG`) give the pixel facts (plan D6, `image.js`): `colours` (the top 8 swatches
by area, hdf's quantiser), `dark` (the mean luma, counted by alpha, under 0.4) and `room`, the busy-ness of
each third of the frame as the share of its pixels on an edge (`{ tl, t, tr, l, c, r, bl, b, br }`, 0..1),
found on the frame averaged down to 128 px so grain and noise do not count and a cutout's outline does. Under
0.2 a third is quiet enough to letter on. `lib.refresh(id, { probes, force })` measures a record already on a
shelf that lacks them (`asset facts`); the bytes are untouched.

Search is local, ranked and explained (plan §4, `search.js`):

```js
const out = lib.search({ q: 'warm paper', media: 'raster', dark: false, limit: 12 });
out.count; out.total;             // records matching, records searched
out.facets;                       // { kind, media, shelf, licence, tags } over every match (the whole library when none)
out.hits[0];                      // { id, shelf, score, why: ['id: warm', 'id: paper'], record, path, thumb }
```

Words are folded (case, diacritics), stop words dropped, and each is a prefix of a record word. A record scores
its best field per word (id 6, name 5, tags 4, desc 2, credit, source, kind, licence 1), 0.6 of that for a word
found through `synonyms.json` (`dog` finds `animal`), and 10 more when the query is its id; ties go to the
newest, then the id. Filters: `kind media shelf tags licence alpha minW minH aspect secMin secMax dark hue
room`. `dark` is the record's own (measured at put), else the mean CIE lightness of its `colours` under 50;
`hue` is the dominant swatch's band (`warm`, `cool`, `neutral`, or `red` ... `pink`); `room` names thirds
(`tl` ... `br`) or sides (`top bottom left right`) whose every cell must be under 0.2. A query with only
filters lists by kind, then id, or the quietest first when it asks for `room`. `openLibrary({ rank })`
takes a host scorer (an embedding, later) with the same result shape.

Every record can be looked at (plan A4, `preview.js`). A host registers a previewer per kind; anything
without one gets a card drawn here with no dependency (its first colour as the field, kind and id lettered in
a built-in bitmap font, size or length, licence, palette strip):

```js
const lib = openLibrary({ shelves, previewers: { cutout: { name: 'hdf', version: 1, render: (file, record, { width }) => pngBytes } } });
const pv = await lib.preview('teapot');   // { path: thumbs/<sha>.png, png, by: 'hdf@1', cached, warnings }
const sheet = await lib.sheet(['teapot', 'cup', 'fox'], { cols: 3, out: 'candidates.png' });   // one PNG, id captions
```

Thumbs live at `<shelf>/thumbs/<sha>.png` (a machine-wide cache in the temp dir when the shelf is read-only)
and carry their tag in a PNG text chunk, `assetlib: preview 1 <by>`. A cached thumb answers while it was drawn
under this `PREVIEW_VERSION` and: it is a card, no previewer is registered for the kind and the record would
letter the same card; or it is a host's picture, unless it is the registered previewer's own at another version.
So a card gives way to a previewer registered later, and two apps sharing a shelf keep each other's pictures.
A previewer that throws or returns no PNG gives the card and a warning, and is asked again next time.

Previewers come from hosts (plan H3, `hosts.js`): an app that draws some kinds is an ES module whose default
export is `{ name, previewers }`. `loadHosts()` loads the known ones (hdf's `handdrawn/cli/host.mjs`, when it
is next to this package) and the modules `$ASSETLIB_HOSTS` names (`-` first: those alone), so the `asset` bin
and davidup draw hdf's pictures without importing hdf, and draw cards when it is not there:

```js
const { previewers, hosts, warnings } = await loadHosts();
const lib = openLibrary({ previewers });   // what the `asset` bin does for `thumb` and `sheet`
```

A host may also lend `addAsset` its side of a kind (plan D3): `adds: { kind: () => Promise<{ derive, fields,
probes }> }`, loaded on the first add of that kind. `addHost(adds, kind)` turns it into addAsset's `host`, and
addAsset loads it itself when given `host.adds`. hdf lends `hdf import`'s side, so the `asset` bin and
davidup's `add_asset` trace a cutout's silhouette and lint a puppet as `hdf import` does.

Every search hit carries `use`: the exact call that brings the record into each app, or null where the app
cannot take it (plan A5, `use.js`). The agent copies it; it does not translate.

```js
lib.use('teapot');
// { davidup: { tool: 'register_asset', args: { id: 'teapot', type: 'image', src: 'asset:teapot@611b2de0b430',
//                  credit: 'Teapot, ca. 1755. The Metropolitan Museum of Art, Open Access (CC0)', licence: 'CC0' } },
//   hdf: { assets: ['teapot'], code: "fromStore(['teapot'])",
//          take: "photo(pin(fromStore(['teapot'])['teapot'], { x: 540, y: 540, h: 420 }))",
//          look: 'doodlePastel~from:teapot' } }
```

davidup takes image, cutout and stock as `image`, video as `video`, audio and sample as `audio`, font as `font`
(with its `family`), by an `asset:<id>@<sha12>` src; the record's credit (when not empty), licence and an
image's sprite `sheet` are copied into the args. A puppet, hand or motif is offered through a record made from
it (`made.from` names it: a puppet's sprite sheet, else an image; a hand's font; a motif's image), with `via`
naming that record; with none, and for a clip, davidup's is null. `lib.made(id)` lists what was made from an id.
hdf takes its seven kinds: `assets` for the film, `code` to read it, `take` to put it to work (a cutout placed,
`actorOf(puppet(id))`, `clipFromStore(id)`, `voice(id, 0)`, the record for a stock or a motif) and `look` for
a hand (`~hand:`) or a cutout's colours (`~from:`); a record off the house shelf is read with `{ from }`. A
font is handed to `hdf hand --font` as `cli`. The house-shelf calls are run in hdf by `test/use.test.js`.

A record's own fields change in place, validated, without touching the blob; the fields the bytes decide
(`kind media sha ext bytes`) are refused, and a null removes a field:

```js
lib.update('teapot', { tags: ['met', 'kitchen'], desc: 'Silver teapot, three-quarter view' });
```

`check(lib)` (`check.js`) lists what is wrong with the shelves, each finding `{ level, rule, shelf, id, detail }`:
errors (`id` outside the rule, `invalid` entry, missing `blob`, a blob whose bytes miss its `sha`), warnings
(`sha1` entries from before H1, `licence` unknown, CC-BY with no `credit`, `duplicate` bytes across shelves, `shadow`,
`orphan` blob) and notes (no `thumb`, `desc` or `tags`). With `legacy: <root>` (`asset check --legacy`: davidup's
old library, `$DAVIDUP_LIBRARY` else `~/.davidup/library`) it also notes each file in `<root>/assets` and
`<root>/fonts` whose bytes are on no shelf, with the `asset add` line that puts it on the user's pool (D5).

## The `asset` CLI

The library from a terminal (plan A6, `cli.js`; the root package's `asset` bin):

```
asset find warm paper --media raster        ranked hits, why each matched; with none, what the library has
asset show teapot                           record, shelves, blob, thumb, made from / into, the use block
asset add paper.png --kind stock --name "Warm paper" --licence own --tags paper,warm
asset tag teapot +kitchen -object           asset desc teapot "Silver teapot, three-quarter view"
asset rm teapot    asset mv teapot --to house    asset gc --dry
asset find --dark --room top               dark, a quiet top third for a headline; quietest first
asset facts --all [--force]                 colours, dark and room for records that lack them (D6)
asset thumb teapot | --all                  asset sheet teapot cup fox --out candidates.png
asset ls --shelf house                      asset check [--legacy]    (exits 1 on an error)
asset migrate --sha256 house [--dry]        rehash a shelf written with sha1 (H1)
```

`--project <dir>` opens `<dir>/assets` as the project shelf; `$DAVIDUP_ASSETS` and `$DAVIDUP_HOUSE` move the
other two. Writes go to `--shelf`, else the project, else the user's pool. `--json` prints what a verb found.
`asset add` reads what the payload says by itself: a raster's header and (for a PNG) its colours, a WAV's
length, a TrueType/OpenType/WOFF font's family, weight, style and glyphs, a JSON kind's own counts and box, a
video or other audio through `ffprobe` (`$FFPROBE`) when it is there (`probe.js`). What only hdf can work out (a
cutout's silhouette, a puppet's box from its parts) comes from the host (the bin finds hdf's `adds`) or from
`--with '<json>'`. `main(argv, host)` is the whole CLI; a host passes its `probes`, `previewers`, per-kind
`derive` and `fields`, or `adds`.
`run(verb, argv, host)` is one verb without the printing (`{ code, data, text, warnings }`, `data` being what
`--json` prints), on `host.library` when the host opened its own; `addAsset(lib, { bytes, file, entry, shelf },
host)` is `add` for a host that already holds the bytes. hdf's `find`, `import`, `remove` and `gc` are these
since H2: `hdf find fox --json` prints what `asset find fox --json` prints.

`migrateSha256(shelf, { dry })` (`migrate.js`, `asset migrate --sha256`) rehashes a shelf written with sha1:
each blob is renamed by the sha256 of the same bytes, except a JSON payload naming another blob of the shelf by
its sha1, which is rewritten to name its sha256 and hashed after. New blobs are written before the catalogue,
old ones removed after it; it returns `map` (sha1 -> sha256) for whatever outside the shelf names a sha. hdf's
house shelf was migrated in H1.

`KINDS`, `MEDIA`, `LICENCES`, `mediaOf(kind)` and `validate(id, entry, { fields })` describe the record;
`readShelf(root)` reads one shelf. Plain ESM, zero dependencies, types in `index.d.ts`.

Tests: `npm test` here (`node --test`). `tests/assets/assetlib.test.ts` in the root holds `LICENCES`
equal to davidup's `ASSET_LICENCES`.
