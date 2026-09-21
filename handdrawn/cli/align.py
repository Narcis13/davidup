#!/usr/bin/env python3
"""Word timing from a recording (4.0 V2): a transcriber's words with their start and end, as JSON.

`hdf align <id>` runs this on the sample's wav and lays the words it prints onto the copy (core/align.js
fitWords), so the transcriber's spelling never reaches the film. This file only transcribes.

    python3 cli/align.py work/line1.wav --text "The moon does not make its own light." --model base.en

Output: [ { "text", "t0", "t1" } ], seconds from the start of the file, in spoken order.

Needs faster-whisper (`python3 -m pip install faster-whisper`) or whisper-timestamped; the first one found is
used. The model is fetched on first use and cached by the library. Exits 3 when neither is installed, so the
caller can fall back to its estimate.
"""
import argparse
import json
import sys


def faster(path, text, model, lang):
    from faster_whisper import WhisperModel
    m = WhisperModel(model, device="cpu", compute_type="int8")
    segs, _ = m.transcribe(path, word_timestamps=True, language=lang, initial_prompt=text or None, beam_size=5)
    return [{"text": w.word.strip(), "t0": round(w.start, 3), "t1": round(w.end, 3)} for s in segs for w in (s.words or [])]


def timestamped(path, text, model, lang):
    import whisper_timestamped as wt
    audio = wt.load_audio(path)
    got = wt.transcribe(wt.load_model(model, device="cpu"), audio, language=lang, initial_prompt=text or None)
    return [{"text": w["text"].strip(), "t0": round(w["start"], 3), "t1": round(w["end"], 3)} for s in got["segments"] for w in s.get("words", [])]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wav")
    ap.add_argument("--text", default="", help="the copy, a hint for spelling (the timing comes from the audio)")
    ap.add_argument("--model", default="base", help="a whisper model name (base, small, base.en, ...)")
    ap.add_argument("--lang", default=None, help="language code (en, ro, ...); detected when omitted")
    a = ap.parse_args()
    for name, fn in (("faster_whisper", faster), ("whisper_timestamped", timestamped)):
        try:
            __import__(name)
        except ImportError:
            continue
        json.dump(fn(a.wav, a.text, a.model, a.lang), sys.stdout)
        sys.stdout.write("\n")
        return 0
    sys.stderr.write("align.py: neither faster-whisper nor whisper-timestamped is installed "
                     "(python3 -m pip install faster-whisper, or HDF_PYTHON=<venv>/bin/python)\n")
    return 3


if __name__ == "__main__":
    sys.exit(main())
