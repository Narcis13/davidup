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

`KINDS`, `MEDIA`, `LICENCES`, `mediaOf(kind)` and `validate(id, entry, { fields })` describe the record;
`readShelf(root)` reads one shelf. Plain ESM, zero dependencies, types in `index.d.ts`.

Tests: `npm test` here (`node --test`). `tests/assets/assetlib.test.ts` in the root holds `LICENCES`
equal to davidup's `ASSET_LICENCES`.
