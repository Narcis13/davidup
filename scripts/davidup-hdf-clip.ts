// A davidup video item played from a handdrawn film (hand-drawn film 3.0, S16).
//
// Renders the film the item names and points the item's video asset at the
// mp4 (copied to `<project>/assets/hdf/`, registered through `register_asset`
// so its duration and size are probed). The item itself is left alone: it
// keeps its box, timing and fit, and plays the new clip.
//
// With --alpha (hand-drawn film 4.0, D1) the film is drawn on no stock and
// encoded with its transparency (ProRes 4444 .mov, or VP9 .webm with
// `--alpha webm`, which the editor's browser preview can also play): the
// clip is an overlay, and whatever lies under the item shows around the
// drawing. register_asset probes the alpha plane, so the render keeps it.
//
// Cues both ways (4.0 D4): the film is rendered with `--cues-from <this composition> --at <item>`, so a
// film that cuts to marks (`atMark('drop')`, `marksNamed('beat')`) lands its cuts on this composition's
// audio-track beats and markers, in the item's own seconds; and the film's chapters are written back as
// composition markers (`source: "hdf:<item>"`, replaced on every run), which the editor draws on its
// ruler. --no-cues does neither.
//
// The item names its film in its `name` — `hdf:<film>`, the film's name (RE-13: looked up in
// handdrawn/films/, then beside composition.json, then handdrawn/work/<film>/) or a path — or the film
// comes from --film:
//
//   "fox": { "type": "video", "asset": "fox-clip", "name": "hdf:fox-and-teapot", ... }
//
// USAGE
//   bun run scripts/davidup-hdf-clip.ts <composition.json> <item-id> [--film <film.js|name>] [--look <preset>]
//
// FLAGS
//   --film      the film, when the item's name does not say it
//   --look      a look preset, modifiers too ('paperInk~hand:test')
//   --alpha     draw on no stock and keep the transparency: mov (default) or webm
//   --frames N  render the first N drawn frames only
//   --no-cues   no marks for the film and no chapter markers back
//   --dry-run   say what it would render and rewrite; renders nothing, writes nothing
//   --help      this text

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  alphaCodec, BridgeError, chapterMarkers, describe, filmCues, filmPath, frameCount, parseArgs, registerFiles, renderFilm,
  runMain, shown, writeMarkers,
} from "./hdf-bridge.ts";

const USAGE = `usage: bun run scripts/davidup-hdf-clip.ts <composition.json> <item-id>
         [--film <film.js|name>] [--look <preset>] [--alpha [mov|webm]] [--frames N] [--no-cues] [--dry-run]
`;

const PREFIX = "hdf:";

async function main(): Promise<number> {
  const { args, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || args.length !== 2) {
    (flags.help ? process.stdout : process.stderr).write(USAGE);
    return flags.help ? 0 : 2;
  }
  const [file, itemId] = [resolve(args[0]!), args[1]!];
  const doc = JSON.parse(readFileSync(file, "utf8"));
  const item = doc?.items?.[itemId];
  if (!item) throw new BridgeError(`${shown(file)} has no item '${itemId}'`);
  if (item.type !== "video") throw new BridgeError(`item '${itemId}' is a ${item.type}, not a video`);

  const named = typeof item.name === "string" && item.name.startsWith(PREFIX) ? item.name.slice(PREFIX.length).trim() : "";
  const ref = typeof flags.film === "string" ? flags.film : named;
  if (!ref) {
    throw new BridgeError(`item '${itemId}' names no film: give it a name '${PREFIX}<film>' or pass --film <film.js|name>`);
  }
  const path = filmPath(ref, process.cwd(), [dirname(file)]);
  const look = typeof flags.look === "string" ? flags.look : undefined;
  const frames = frameCount(flags.frames);
  const alpha = alphaCodec(flags.alpha);
  const cues = flags["no-cues"] === true ? {} : { cuesFrom: file, at: itemId };
  const source = `hdf:${itemId}`;

  if (flags["dry-run"] === true) {
    const was = doc.assets.find((a: { id?: string }) => a?.id === item.asset);
    process.stdout.write(
      `${itemId} (asset ${item.asset}${was ? `, now ${was.src}` : ", not registered yet"})` +
        ` <- hdf render ${shown(path)}${look ? ` --look ${look}` : ""}${frames !== undefined ? ` --frames ${frames}` : ""}${alpha ? ` --alpha ${alpha}` : ""}` +
        `${cues.cuesFrom ? ` --cues-from ${shown(file)} --at ${itemId}\n  chapters -> composition markers (source ${source})` : ""}\n`,
    );
    return 0;
  }

  const clip = await renderFilm(path, { look, frames, alpha, ...cues });
  const [{ asset, warnings }] = await registerFiles(file, [{ id: item.asset, type: "video", file: clip }]);
  let marked = "";
  if (cues.cuesFrom) {
    const c = await filmCues(path, { look, ...cues });
    const n = writeMarkers(file, source, chapterMarkers(c, item, source));
    const used = c.marks.length ? `${c.marks.length} marks read, ` : "";
    marked = `  ${used}${n} chapter marker${n === 1 ? "" : "s"} (source ${source})\n`;
  }
  process.stdout.write(
    `${shown(file)}\n  ${itemId} plays ${describe(asset!)}\n${marked}${warnings.map((w) => `  warning: ${w}\n`).join("")}`,
  );
  return 0;
}

runMain(main);
