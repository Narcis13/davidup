// A handdrawn film into a davidup project (hand-drawn film 3.0, S16).
//
// Renders the film with `hdf render`, draws the model sheet of every store
// puppet the film reads (`hdf sheet store <id> --poses`), copies them into
// `<project>/assets/hdf/` and registers them through `register_asset`:
//
//   hdf-<film>[-<look>]   video   the render (with its score when it has one)
//   hdf-<puppet>-model    image   the puppet's model sheet
//
// Re-running replaces those assets in place. Place the video with `add_video`
// (or the editor) like any other clip.
//
// USAGE
//   bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir|name> [--look <preset>]
//
// FLAGS
//   --project   a davidup project directory, or a project's name in the
//               editor's recents list
//   --look      a look preset, modifiers too ('paperInk~hand:test')
//   --frames N  render the first N drawn frames only
//   --no-sheets skip the puppets' model sheets
//   --dry-run   print the assets it would register; renders nothing, writes nothing
//   --help      this text

import {
  BridgeError, describe, filmInfo, filmPath, frameCount, modelSheet, parseArgs, projectRoot,
  registerFiles, renderFilm, runMain, shown, slug, type Planned,
} from "./hdf-bridge.ts";
import { join } from "node:path";

const USAGE = `usage: bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir|name>
         [--look <preset>] [--frames N] [--no-sheets] [--dry-run]
`;

async function main(): Promise<number> {
  const { args, flags } = parseArgs(process.argv.slice(2));
  if (flags.help || args.length !== 1) {
    (flags.help ? process.stdout : process.stderr).write(USAGE);
    return flags.help ? 0 : 2;
  }
  const look = typeof flags.look === "string" ? flags.look : undefined;
  const frames = frameCount(flags.frames);
  const dry = flags["dry-run"] === true;
  if (typeof flags.project !== "string" && !dry) throw new BridgeError("--project <dir|name> is required (or --dry-run)");
  const root = typeof flags.project === "string" ? projectRoot(flags.project) : null;

  const path = filmPath(args[0]!);
  const film = await filmInfo(path, look);
  const n = frames === undefined ? film.n : Math.min(frames, film.n);
  const videoId = `hdf-${slug(film.variant)}`;
  const puppets = flags["no-sheets"] === true ? [] : film.puppets;

  if (dry) {
    process.stdout.write(
      [
        `${film.name}: ${n} frames${root ? ` -> ${shown(root)}` : ""}`,
        `${videoId}  video  hdf render ${shown(path)}${look ? ` --look ${look}` : ""}${frames !== undefined ? ` --frames ${frames}` : ""}`,
        ...puppets.map((p) => `hdf-${slug(p)}-model  image  hdf sheet store ${p} --poses`),
      ].join("\n") + "\n",
    );
    return 0;
  }

  const planned: Planned[] = [{ id: videoId, type: "video", file: await renderFilm(path, { look, frames }) }];
  for (const p of puppets) planned.push({ id: `hdf-${slug(p)}-model`, type: "image", file: await modelSheet(p) });
  const done = await registerFiles(join(root!, "composition.json"), planned);
  const lines = done.flatMap(({ asset, warnings }) => [describe(asset), ...warnings.map((w) => `  warning: ${w}`)]);
  process.stdout.write(`${shown(join(root!, "composition.json"))}\n${lines.map((l) => `  ${l}`).join("\n")}\n`);
  return 0;
}

runMain(main);
