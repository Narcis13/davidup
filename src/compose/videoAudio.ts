// keepAudio pass (v1.1 S11) — render-time lowering of `keepAudio` video items.
//
// A video item with `keepAudio: true` wants its own nat sound in the render.
// Rather than teach every audio consumer about video items, this pass lowers
// each such item into an ordinary `audio[]` track, so the mux (and anything
// else that reads `audio[]`) sees one uniform list:
//
//   items.clip = { type: "video", asset: "broll", start: 2, end: 6,
//                  trimIn: 1, keepAudio: true, … }
//     ⇒ audio += { id: "clip__audio", asset: "broll", start: 2, end: 6,
//                  trimIn: 1 }
//
// The track's `asset` is the video asset itself; the mux reads that file's
// first audio stream (`[n:a:0]`, see drivers/node/audioMux.ts). Mirroring:
//   start / trimIn — copied verbatim
//   end            — the item's `end`, cut short where the trimmed source runs
//                    out (`start + trimOut - trimIn`) so the audio never reads
//                    past `trimOut` while the picture freezes on its last frame
//   loop           — copied; the mux bounds the repeated window to
//                    [trimIn, trimOut) by looking the item back up
//   volume         — left at the default (1)
//
// Runs on the *precompiled* composition (after scene expansion, so video items
// inside scenes are already flattened under their prefixed ids), invoked by the
// node driver's `renderToFile` right before it decides whether to mux. It is
// deliberately NOT part of `precompile()` itself: the editor keeps and saves
// the precompiled composition, and the CLI precompiles before handing off to
// `renderToFile` (which precompiles again) — either would duplicate the
// synthesised tracks into authored `audio[]`. Skipped per item when the
// clip is hidden (`visible: false` mutes it along with the picture) or when
// its asset was probed with no audio stream (`hasAudio: false` — the validator
// reports that as W_VIDEO_NO_AUDIO_STREAM; ffmpeg would otherwise fail on the
// missing stream). Returns the input untouched when no item opts in.

/** Suffix of a track synthesised from a `keepAudio` video item. */
export const VIDEO_AUDIO_TRACK_SUFFIX = "__audio";

/** Id of the audio track synthesised for video item `itemId`. */
export function videoAudioTrackId(itemId: string): string {
  return `${itemId}${VIDEO_AUDIO_TRACK_SUFFIX}`;
}

export function synthesizeVideoAudio(comp: unknown): unknown {
  if (!isPlainObject(comp) || !isPlainObject(comp.items)) return comp;

  const silentAssets = new Set<string>();
  if (Array.isArray(comp.assets)) {
    for (const a of comp.assets) {
      if (isPlainObject(a) && a.type === "video" && a.hasAudio === false) {
        silentAssets.add(String(a.id));
      }
    }
  }

  const tracks: Record<string, unknown>[] = [];
  for (const [itemId, item] of Object.entries(comp.items)) {
    if (!isPlainObject(item) || item.type !== "video" || item.keepAudio !== true) continue;
    if (item.visible === false) continue;
    if (typeof item.asset !== "string" || silentAssets.has(item.asset)) continue;
    const start = typeof item.start === "number" ? item.start : 0;
    const trimIn = typeof item.trimIn === "number" ? item.trimIn : undefined;
    const trimOut = typeof item.trimOut === "number" ? item.trimOut : undefined;
    const loop = item.loop === true;

    let end = typeof item.end === "number" ? item.end : undefined;
    if (!loop && trimOut !== undefined) {
      const sourceEnd = start + (trimOut - (trimIn ?? 0));
      end = end === undefined ? sourceEnd : Math.min(end, sourceEnd);
    }

    tracks.push({
      id: videoAudioTrackId(itemId),
      asset: item.asset,
      start,
      ...(end !== undefined ? { end } : {}),
      ...(trimIn !== undefined ? { trimIn } : {}),
      ...(loop ? { loop: true } : {}),
    });
  }
  if (tracks.length === 0) return comp;

  const existing = Array.isArray(comp.audio) ? comp.audio : [];
  const taken = new Set<unknown>(existing.filter(isPlainObject).map((t) => t.id));
  for (const t of tracks) {
    if (taken.has(t.id)) {
      throw new Error(
        `keepAudio: audio track id "${String(t.id)}" is already declared in \`audio\`; ` +
          "rename that track or drop keepAudio on the video item.",
      );
    }
  }
  return { ...comp, audio: [...existing, ...tracks] };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
