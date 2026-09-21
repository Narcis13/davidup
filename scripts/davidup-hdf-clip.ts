// A davidup video item played from a handdrawn film (hand-drawn film 3.0, S16).
//
// Renders the film the item names and points the item's video asset at the
// mp4 (copied to `<project>/assets/hdf/`, registered through `register_asset`
// so its duration and size are probed). The item itself is left alone: it
// keeps its box, timing and fit, and plays the new clip.
//
// The item names its film in its `name` — `hdf:<film>`, a film in
// handdrawn/films/ or a path — or the film comes from --film:
//
//   "fox": { "type": "video", "asset": "fox-clip", "name": "hdf:fox-and-teapot", ... }
//
// USAGE
//   bun run scripts/davidup-hdf-clip.ts <composition.json> <item-id> [--film <film.js|name>] [--look <preset>]
//
// FLAGS
//   --film      the film, when the item's name does not say it
//   --look      a look preset, modifiers too ('paperInk~hand:test')
//   --frames N  render the first N drawn frames only
//   --dry-run   say what it would render and rewrite; renders nothing, writes nothing
//   --help      this text

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BridgeError, describe, filmPath, frameCount, parseArgs, registerFiles, renderFilm, runMain, shown,
} from "./hdf-bridge.ts";

const USAGE = `usage: bun run scripts/davidup-hdf-clip.ts <composition.json> <item-id>
         [--film <film.js|name>] [--look <preset>] [--frames N] [--dry-run]
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
  const path = filmPath(ref);
  const look = typeof flags.look === "string" ? flags.look : undefined;
  const frames = frameCount(flags.frames);

  if (flags["dry-run"] === true) {
    const was = doc.assets.find((a: { id?: string }) => a?.id === item.asset);
    process.stdout.write(
      `${itemId} (asset ${item.asset}${was ? `, now ${was.src}` : ", not registered yet"})` +
        ` <- hdf render ${shown(path)}${look ? ` --look ${look}` : ""}${frames !== undefined ? ` --frames ${frames}` : ""}\n`,
    );
    return 0;
  }

  const mp4 = await renderFilm(path, { look, frames });
  const [{ asset, warnings }] = await registerFiles(file, [{ id: item.asset, type: "video", file: mp4 }]);
  process.stdout.write(
    `${shown(file)}\n  ${itemId} plays ${describe(asset!)}\n${warnings.map((w) => `  warning: ${w}\n`).join("")}`,
  );
  return 0;
}

runMain(main);
