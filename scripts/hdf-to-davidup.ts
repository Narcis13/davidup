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
//   hdf-<hand>-font       font    with --fonts (4.0 D3): the hand the film
//                                 letters in (or the hands named) as a
//                                 TrueType font (`hdf hand --export-ttf`),
//                                 family `hdf-<hand>`, for add_text's `font`
//
// A sheet, sprite or font drawn from a store entry carries that entry's
// `credit` and `licence` (RE-14); the render, which is the film's own, none.
//
// Cues both ways (4.0 D4): the render reads the project's composition as its marks (`--cues-from`), in
// the seconds of the video item that plays `hdf-<film>` (--at, or the one item that plays it), so a film
// cut to `atMark`/`marksNamed` lands on the project's beats and markers; and for every video item that
// plays the film, its chapters become composition markers (`source: "hdf:<item>"`). --no-cues does
// neither.
//
// Re-running replaces those assets in place. Place the video with `add_video`
// (or the editor) like any other clip.
//
// USAGE
//   bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir|name> [--look <preset>]
//   bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir> --sprites [--no-video] [--no-sheets]
//   bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir> --fonts [--no-video] [--no-sheets]
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
//   --fonts [a,b]  the film's hand as a font, or the hands named (store ids,
//               or house)
//   --no-video  skip the render (sprites and fonts only)
//   --at <item> the video item whose seconds the film's marks are in (default: the one item playing
//               hdf-<film>, else composition seconds)
//   --no-cues   no marks from the composition and no chapter markers back
//   --dry-run   print the assets it would register; renders nothing, writes nothing
//   --help      this text

import {
  BridgeError, chapterMarkers, describe, filmCast, filmCues, filmHand, filmInfo, filmPath, frameCount, handFont, modelSheet, parseArgs, projectRoot,
  registerFiles, renderFilm, runMain, shown, slug, spriteSheet, storeCredit, writeMarkers, type CueOpts, type Planned,
} from "./hdf-bridge.ts";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const USAGE = `usage: bun run scripts/hdf-to-davidup.ts <film.js|name> --project <dir|name>
         [--look <preset>] [--frames N] [--no-sheets] [--sprites [a,b]] [--states s] [--h px] [--fonts [a,b]] [--no-video]
         [--at <item>] [--no-cues] [--dry-run]
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

  // The video items that play the film's render, by id (4.0 D4).
  const compFile = root ? join(root, "composition.json") : null;
  const doc = compFile && existsSync(compFile) ? JSON.parse(readFileSync(compFile, "utf8")) : null;
  const players = Object.entries((doc?.items ?? {}) as Record<string, { type?: string; asset?: string; start?: number; end?: number; trimIn?: number }>)
    .filter(([, it]) => it?.type === "video" && it.asset === videoId);
  const at = typeof flags.at === "string" ? flags.at : players.length === 1 ? players[0]![0] : undefined;
  if (at !== undefined && !doc?.items?.[at]) throw new BridgeError(`--at: the composition has no item '${at}'`);
  const cues: CueOpts = flags["no-cues"] === true || !compFile ? {} : { cuesFrom: compFile, ...(at ? { at } : {}) };

  const fonts = flags.fonts === undefined ? [] : flags.fonts === true ? [await filmHand(path, look)] : String(flags.fonts).split(",").filter(Boolean);

  if (dry) {
    process.stdout.write(
      [
        `${film.name}: ${n} frames${root ? ` -> ${shown(root)}` : ""}`,
        ...(video ? [`${videoId}  video  hdf render ${shown(path)}${look ? ` --look ${look}` : ""}${frames !== undefined ? ` --frames ${frames}` : ""}${cues.cuesFrom ? ` --cues-from ${shown(cues.cuesFrom)}${at ? ` --at ${at}` : ""}` : ""}`] : []),
        ...(video && cues.cuesFrom ? players.map(([id]) => `chapters -> composition markers at ${id} (source hdf:${id})`) : []),
        ...puppets.map((p) => `hdf-${slug(p)}-model  image  hdf sheet store ${p} --poses`),
        ...sprites.map((p) => `hdf-${slug(p)}-sprite  image  hdf sprite ${p} --film ${shown(path)} --alpha${states ? ` --states ${states}` : ""}`),
        ...fonts.map((h) => `hdf-${slug(h)}-font  font  hdf hand --export-ttf ${h}  (family hdf-${slug(h)})`),
      ].join("\n") + "\n",
    );
    return 0;
  }

  const planned: Planned[] = video ? [{ id: videoId, type: "video", file: await renderFilm(path, { look, frames, ...cues }) }] : [];
  // A sheet, a sprite or a font drawn from a store entry carries its credit and licence (RE-14).
  for (const p of puppets) planned.push({ id: `hdf-${slug(p)}-model`, type: "image", file: await modelSheet(p), ...storeCredit(p) });
  for (const p of sprites) {
    const s = await spriteSheet(p, { film: path, look, states, h });
    planned.push({ id: `hdf-${slug(p)}-sprite`, type: "image", file: s.png, sheet: s.sheet, ...storeCredit(p) });
  }
  for (const h of fonts) planned.push({ id: `hdf-${slug(h)}-font`, type: "font", file: await handFont(h), family: `hdf-${slug(h)}`, ...storeCredit(h) });
  if (!planned.length) throw new BridgeError("nothing to register (--no-video with no sheets, no --sprites and no --fonts)");
  const done = await registerFiles(join(root!, "composition.json"), planned);
  const lines = done.flatMap(({ asset, warnings }) => [describe(asset), ...warnings.map((w) => `  warning: ${w}`)]);
  if (video && cues.cuesFrom && players.length) {
    const c = await filmCues(path, { look, ...cues });
    for (const [id, item] of players) {
      const n = writeMarkers(join(root!, "composition.json"), `hdf:${id}`, chapterMarkers(c, item, `hdf:${id}`));
      lines.push(`${id}: ${n} chapter marker${n === 1 ? "" : "s"} (source hdf:${id})`);
    }
  }
  process.stdout.write(`${shown(join(root!, "composition.json"))}\n${lines.map((l) => `  ${l}`).join("\n")}\n`);
  return 0;
}

runMain(main);
