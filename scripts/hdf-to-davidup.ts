// A handdrawn film into a davidup project (hand-drawn film 3.0, S16).
//
// Renders the film with `hdf render`, draws the model sheet of every store
// puppet the film reads (`hdf sheet store <id> --poses`), copies them into
// `<project>/assets/hdf/` and registers them through `register_asset`:
//
//   hdf-<film>[-<look>]   video   the render (with its score when it has one)
//   hdf-<puppet>-model    image   the puppet's model sheet
//   hdf-<name>-sprite     image   with --sprites (4.0 D2): each cast member as
//                                 a sprite sheet (`hdf sprite --film --alpha`),
//                                 registered with its `sheet`, so add_sprite
//                                 with `cycle: "walk"` walks it, no video
//
// Re-running replaces those assets in place. Place the video with `add_video`
// (or the editor) like any other clip.
//
// USAGE
//   bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir|name> [--look <preset>]
//   bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir> --sprites [--no-video] [--no-sheets]
//
// FLAGS
//   --project   a davidup project directory, or a project's name in the
//               editor's recents list
//   --look      a look preset, modifiers too ('paperInk~hand:test')
//   --frames N  render the first N drawn frames only
//   --no-sheets skip the puppets' model sheets
//   --sprites [a,b]  every cast member as a sprite sheet (the film's store
//               puppets and its module's `cast` export), or the ones named
//   --states s  the states each sprite draws (default idle,walk,happy)
//   --h px      a sprite frame's height (default 300)
//   --no-video  skip the render (sprites only)
//   --dry-run   print the assets it would register; renders nothing, writes nothing
//   --help      this text

import {
  BridgeError, describe, filmCast, filmInfo, filmPath, frameCount, modelSheet, parseArgs, projectRoot,
  registerFiles, renderFilm, runMain, shown, slug, spriteSheet, type Planned,
} from "./hdf-bridge.ts";
import { join } from "node:path";

const USAGE = `usage: bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir|name>
         [--look <preset>] [--frames N] [--no-sheets] [--sprites [a,b]] [--states s] [--h px] [--no-video] [--dry-run]
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
  const video = flags["no-video"] !== true;
  const states = typeof flags.states === "string" ? flags.states : undefined;
  const h = flags.h === undefined ? undefined : Number(flags.h);
  if (h !== undefined && !(h >= 16 && h <= 4096)) throw new BridgeError(`--h takes 16 to 4096 px (got ${String(flags.h)})`);
  let sprites: string[] = [];
  if (flags.sprites !== undefined) {
    const cast = await filmCast(path, look);
    sprites = flags.sprites === true ? cast : String(flags.sprites).split(",").filter(Boolean);
    const missing = sprites.filter((s) => !cast.includes(s));
    if (missing.length) throw new BridgeError(`--sprites: ${missing.join(", ")} not in ${film.name}'s cast (has ${cast.join(", ") || "none"})`);
    if (!sprites.length) throw new BridgeError(`--sprites: ${film.name} has no cast (store puppets, or a \`cast\` export)`);
  }

  if (dry) {
    process.stdout.write(
      [
        `${film.name}: ${n} frames${root ? ` -> ${shown(root)}` : ""}`,
        ...(video ? [`${videoId}  video  hdf render ${shown(path)}${look ? ` --look ${look}` : ""}${frames !== undefined ? ` --frames ${frames}` : ""}`] : []),
        ...puppets.map((p) => `hdf-${slug(p)}-model  image  hdf sheet store ${p} --poses`),
        ...sprites.map((p) => `hdf-${slug(p)}-sprite  image  hdf sprite ${p} --film ${shown(path)} --alpha${states ? ` --states ${states}` : ""}`),
      ].join("\n") + "\n",
    );
    return 0;
  }

  const planned: Planned[] = video ? [{ id: videoId, type: "video", file: await renderFilm(path, { look, frames }) }] : [];
  for (const p of puppets) planned.push({ id: `hdf-${slug(p)}-model`, type: "image", file: await modelSheet(p) });
  for (const p of sprites) {
    const s = await spriteSheet(p, { film: path, look, states, h });
    planned.push({ id: `hdf-${slug(p)}-sprite`, type: "image", file: s.png, sheet: s.sheet });
  }
  if (!planned.length) throw new BridgeError("nothing to register (--no-video with no sheets and no --sprites)");
  const done = await registerFiles(join(root!, "composition.json"), planned);
  const lines = done.flatMap(({ asset, warnings }) => [describe(asset), ...warnings.map((w) => `  warning: ${w}`)]);
  process.stdout.write(`${shown(join(root!, "composition.json"))}\n${lines.map((l) => `  ${l}`).join("\n")}\n`);
  return 0;
}

runMain(main);
