// Cues both ways (hand-drawn film 4.0, D4) — a davidup composition whose music
// carries its beats as markers, and a handdrawn film cut to them.
//
//   node examples/hdf-cues/build.mjs
//
// 1. Makes a 12 s, 128 bpm music bed with ffmpeg (a kick on every beat, a hat
//    between, a chord from the drop on beat 12) and a 10 s, 1080×1080
//    composition: the bed as an audio track whose `markers` are its beats (in
//    source seconds) and its drop, and a video item `film` two beats in that
//    names its film, `hdf:on-beat`.
// 2. Runs the bridge, as a user would:
//      bun run scripts/davidup-hdf-clip.ts composition.json film
//    which renders handdrawn/films/on-beat.js with `--cues-from composition.json
//    --at film` (its cuts go on the bars, it turns on the drop), registers the
//    clip, and writes the film's two chapters back as composition markers.
// 3. Renders the composition with davidup (output/hdf-cues.mp4, the bed muxed).
// 4. Checks it: every cut of the film, on the composition timeline, is within
//    half a drawn frame (1/24 s) of a beat, and the composition's markers are
//    the film's chapters where the film plays them. Exits 1 if not.
//
// Nothing it writes is committed (see .gitignore). Open the folder in the
// editor to see the chapters as flags on the ruler and the beats on the track.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const BPM = 128, BEAT = 60 / BPM, DROP = 12, LEN = 12, W = 1080, DUR = 10, AT = 2 * BEAT;

function run(cmd, args, cwd = REPO) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) { process.stderr.write(`${cmd} ${args.join(" ")} failed\n${r.stdout ?? ""}`); process.exit(1); }
  return r.stdout;
}

// 1. The bed. Each beat a kick (a 55 Hz sine falling off fast), a hat half-way between, and from the drop a
// minor chord under it all, so the drop is heard.
mkdirSync(join(HERE, "assets"), { recursive: true });
mkdirSync(join(HERE, "output"), { recursive: true });
const b = BEAT.toFixed(6), drop = (DROP * BEAT).toFixed(6);
const kick = `sin(2*PI*55*mod(t,${b}))*exp(-18*mod(t,${b}))`;
const hat = `(random(0)-0.5)*0.5*exp(-60*mod(t+${b}/2,${b}))`;
const chord = `gte(t,${drop})*0.12*(sin(2*PI*220*t)+sin(2*PI*261.63*t)+sin(2*PI*329.63*t))`;
run(process.env.FFMPEG ?? "ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
  `aevalsrc='0.7*(${kick})+${hat}+${chord}':s=44100:d=${LEN}`, "-ac", "2", join(HERE, "assets", "music.wav")]);

// A marker for every beat the track plays (it ends with the composition): one past it would be W_MARKER_OUTSIDE.
const beats = Array.from({ length: Math.ceil(DUR / BEAT) }, (_, k) => ({ t: +(k * BEAT).toFixed(6), name: "beat" }));
const doc = {
  version: "0.1",
  composition: { width: W, height: W, fps: 30, duration: DUR, background: "#f4f1ea" },
  assets: [{ id: "music", type: "audio", src: "assets/music.wav", duration: LEN }],
  layers: [{ id: "film", z: 0, opacity: 1, blendMode: "normal", items: ["film"] }],
  items: {
    film: {
      type: "video", asset: "hdf-on-beat", name: "hdf:on-beat", width: W, height: W, start: +AT.toFixed(6),
      fit: "contain", loop: false,
      transform: { x: W / 2, y: W / 2, scaleX: 1, scaleY: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, opacity: 1 },
    },
  },
  tweens: [],
  audio: [{ id: "music", asset: "music", start: 0, end: DUR, fadeOut: 0.5, markers: [...beats, { t: +drop, name: "drop" }] }],
};
const file = join(HERE, "composition.json");
writeFileSync(file, JSON.stringify(doc, null, 1) + "\n");
process.stdout.write(`${file}  ${BPM} bpm, ${beats.length} beat markers, the drop at ${(+drop).toFixed(3)}s, film at ${AT.toFixed(3)}s\n`);

// 2. The bridge: the film rendered to the beats, its chapters written back.
process.stdout.write(run("bun", ["run", "scripts/davidup-hdf-clip.ts", file, "film"]));

// 3. davidup renders it.
const mp4 = join(HERE, "output", "hdf-cues.mp4");
run("bun", ["run", "src/cli/bin.ts", "render", file, "-o", mp4]);
process.stdout.write(`${mp4}\n`);

// 4. The check.
const cues = JSON.parse(readFileSync(join(REPO, "handdrawn", "out", "on-beat-cues.json"), "utf8"));
const after = JSON.parse(readFileSync(file, "utf8"));
let ok = true;
process.stdout.write("\ncut      composition  nearest beat  off\n");
for (const t of cues.cuts) {
  const at = AT + t, near = beats.reduce((a, m) => (Math.abs(m.t - at) < Math.abs(a.t - at) ? m : a));
  const off = at - near.t, good = Math.abs(off) <= 1 / 24 + 1e-6;
  ok &&= good;
  process.stdout.write(`${t.toFixed(3)}s   ${at.toFixed(3)}s       ${near.t.toFixed(3)}s        ${(off * 1000).toFixed(1)} ms${good ? "" : "  (off the beat)"}\n`);
}
process.stdout.write("\nmarker        composition  chapter\n");
const marks = (after.composition.markers ?? []).filter((m) => m.source === "hdf:film");
for (const c of cues.chapters) {
  const m = marks.find((x) => x.name === c.title), want = +(AT + c.t0).toFixed(6);
  const good = !!m && Math.abs(m.t - want) < 1e-6;
  ok &&= good;
  process.stdout.write(`${c.title.padEnd(13)} ${m ? `${m.t.toFixed(3)}s` : "missing"}       ${c.n} at ${c.t0.toFixed(3)}s in the film${good ? "" : "  (wrong)"}\n`);
}
const { validateComposition } = await import("../../dist/schema/index.js");   // npm run build first
const v = validateComposition(after);
ok &&= v.valid && v.warnings.length === 0;
process.stdout.write(`\nvalidate: ${v.errors.length} errors, ${v.warnings.length} warnings${v.warnings.map((w) => `\n  ${w.code} ${w.message}`).join("")}\n`);
process.stdout.write(ok ? "\nthe film's cuts are on the music's beats, and the composition shows its chapters\n" : "\nFAILED\n");
process.exit(ok ? 0 : 1);
