#!/usr/bin/env python3
"""Capture (4.0 K7): MediaPipe's face or hand landmarker over a folder of frames.

`hdf clip --kind face <frames-dir> --name me-face` (or `--kind hands`) runs this, then turns what it writes
into a track in the store (core/face.js: the blendshapes or the finger curls a frame, 12 fps). This file only
finds them; it knows nothing about puppets.

    ffmpeg -i me.mov -vf fps=30 work/me/%04d.png
    python3 cli/track.py face work/me --fps 30 --out out/face-me-face.json
    python3 cli/track.py hands work/me --fps 30 --out out/hands-me-hands.json

Output, one entry per frame in name order, null where nothing was found:
    face:  { "fps", "w", "h", "frames": [ { "jawOpen": 0.12, ... the 52 blendshapes } | null ] }
    hands: { "fps", "w", "h", "frames": [ [ { "x", "label", "score", "lm": [[x, y, z] x 21] }, ... ] | null ] }
x and y as fractions of the image; a hand's x is its wrist's, so core/face.js tells the hands apart by where
they are in the picture (MediaPipe's own Left and Right assume a mirrored selfie picture; they are kept as
`label` for the curious).

Needs mediapipe (`python3 -m pip install mediapipe`) and the model file, looked for at --model, then
$HDF_FACE_MODEL / $HDF_HAND_MODEL, then handdrawn/.cache/<model>:

    curl -L -o handdrawn/.cache/face_landmarker.task \\
      https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
    curl -L -o handdrawn/.cache/hand_landmarker.task \\
      https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task

Exit codes: 3 no mediapipe, 4 no model, 2 no frames.
"""
import argparse, glob, json, os, sys

MODELS = {
    'face': ('face_landmarker.task', 'HDF_FACE_MODEL', 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'),
    'hands': ('hand_landmarker.task', 'HDF_HAND_MODEL', 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task'),
}
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, '..', '.cache')

ap = argparse.ArgumentParser()
ap.add_argument('kind', choices=sorted(MODELS)); ap.add_argument('frames')
ap.add_argument('--fps', type=float, default=30, help='the frames\' rate (as ffmpeg extracted them)')
ap.add_argument('--model', default=None); ap.add_argument('--out', default=None, help='default: stdout')
a = ap.parse_args()

try:
    import mediapipe as mp
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
except ImportError:
    sys.stderr.write('track: needs mediapipe (with its Tasks API) in this python (%s): python3 -m pip install mediapipe\n' % sys.executable)
    sys.exit(3)

files = sorted(set(f for ext in ('png', 'jpg', 'jpeg') for f in glob.glob(os.path.join(a.frames, '*.' + ext))))
if not files:
    sys.stderr.write('track: no frames (png or jpg) in %s\n' % a.frames); sys.exit(2)

name, env, url = MODELS[a.kind]
model = next((m for m in [a.model, os.environ.get(env), os.path.join(CACHE, name)] if m and os.path.exists(m)), None)
if not model:
    sys.stderr.write('track: the %s landmarker needs its model file:\n  mkdir -p %s && curl -L -o %s \\\n    %s\n(or --model <file.task> / %s)\n'
                     % (a.kind, CACHE, os.path.join(CACHE, name), url, env))
    sys.exit(4)

base = mpt.BaseOptions(model_asset_path=model)
out, W, H = [], 0, 0
if a.kind == 'face':
    opts = vision.FaceLandmarkerOptions(base_options=base, running_mode=vision.RunningMode.VIDEO, num_faces=1, output_face_blendshapes=True)
    make = vision.FaceLandmarker.create_from_options
else:
    opts = vision.HandLandmarkerOptions(base_options=base, running_mode=vision.RunningMode.VIDEO, num_hands=2)
    make = vision.HandLandmarker.create_from_options

with make(opts) as lm:
    for k, f in enumerate(files):
        img = mp.Image.create_from_file(f); W, H = img.width, img.height
        res = lm.detect_for_video(img, int(round(k * 1000 / a.fps)))
        if a.kind == 'face':
            bs = res.face_blendshapes[0] if res.face_blendshapes else None
            out.append({c.category_name: round(c.score, 4) for c in bs} if bs else None)
        else:
            hands = []
            for i, pts in enumerate(res.hand_landmarks or []):
                cat = res.handedness[i][0] if res.handedness and i < len(res.handedness) and res.handedness[i] else None
                hands.append({'x': round(pts[0].x, 5), 'label': cat.category_name if cat else '', 'score': round(cat.score, 3) if cat else 0,
                              'lm': [[round(p.x, 5), round(p.y, 5), round(p.z, 5)] for p in pts]})
            out.append(hands or None)

found = sum(1 for f in out if f)
sys.stderr.write('track: %d of %d frames have %s (%dx%d, model %s)\n' % (found, len(out), 'a face' if a.kind == 'face' else 'a hand', W, H, os.path.basename(model)))
text = json.dumps({'fps': a.fps, 'w': W, 'h': H, 'frames': out}, separators=(',', ':'))
if a.out:
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, 'w').write(text)
else:
    sys.stdout.write(text)
