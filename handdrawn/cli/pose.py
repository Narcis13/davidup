#!/usr/bin/env python3
"""Motion from your phone (3.0 S15): MediaPipe's pose landmarker over a folder of frames.

`hdf clip --kind pose <frames-dir> --name me` runs this, then turns what it writes into a biped clip in the
store (core/pose.js: 33 landmarks -> the biped rig, a hull for the outline, 12 fps, the best loop). This file
only finds the landmarks; it knows nothing about rigs.

    ffmpeg -i me.mov -vf fps=30 work/me/%04d.png
    python3 cli/pose.py work/me --fps 30 --out out/pose-me.json

Output: { "fps", "w", "h", "frames": [ [[x, y, z, visibility] x 33] | null ] }, x and y as fractions of the
image, one entry per frame in name order, null where no one was found.

Needs mediapipe (`python3 -m pip install mediapipe`). A mediapipe that still has the legacy `solutions` API
carries its own model; the Tasks API needs the pose landmarker model file, looked for at --model, then
$HDF_POSE_MODEL, then handdrawn/.cache/pose_landmarker_full.task:

    curl -L -o handdrawn/.cache/pose_landmarker_full.task \\
      https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task

Exit codes: 3 no mediapipe, 4 no model, 2 no frames.
"""
import argparse, glob, json, os, sys

MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task'
HERE = os.path.dirname(os.path.abspath(__file__))

ap = argparse.ArgumentParser()
ap.add_argument('frames'); ap.add_argument('--fps', type=float, default=30, help='the frames\' rate (as ffmpeg extracted them)')
ap.add_argument('--model', default=None); ap.add_argument('--out', default=None, help='default: stdout')
a = ap.parse_args()

try:
    import mediapipe as mp
except ImportError:
    sys.stderr.write('pose: needs mediapipe in this python (%s): python3 -m pip install mediapipe\n' % sys.executable)
    sys.exit(3)

files = sorted(set(f for ext in ('png', 'jpg', 'jpeg') for f in glob.glob(os.path.join(a.frames, '*.' + ext))))
if not files:
    sys.stderr.write('pose: no frames (png or jpg) in %s\n' % a.frames); sys.exit(2)

legacy = getattr(getattr(mp, 'solutions', None), 'pose', None)
model = next((m for m in [a.model, os.environ.get('HDF_POSE_MODEL'), os.path.join(HERE, '..', '.cache', 'pose_landmarker_full.task')] if m and os.path.exists(m)), None)
if not model and legacy is None:
    sys.stderr.write('pose: this mediapipe needs the pose landmarker model file:\n  mkdir -p %s && curl -L -o %s \\\n    %s\n(or --model <file.task> / HDF_POSE_MODEL)\n'
                     % (os.path.join(HERE, '..', '.cache'), os.path.join(HERE, '..', '.cache', 'pose_landmarker_full.task'), MODEL_URL))
    sys.exit(4)

def pts(lms):
    return [[round(l.x, 5), round(l.y, 5), round(l.z, 5), round(getattr(l, 'visibility', 1.0) or 0.0, 3)] for l in lms]

out, W, H = [], 0, 0
if model:
    from mediapipe.tasks import python as mpt
    from mediapipe.tasks.python import vision
    opts = vision.PoseLandmarkerOptions(base_options=mpt.BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO, num_poses=1)
    with vision.PoseLandmarker.create_from_options(opts) as lm:
        for k, f in enumerate(files):
            img = mp.Image.create_from_file(f); W, H = img.width, img.height
            res = lm.detect_for_video(img, int(round(k * 1000 / a.fps)))
            out.append(pts(res.pose_landmarks[0]) if res.pose_landmarks else None)
else:
    import numpy as np   # mediapipe depends on it
    with legacy.Pose(static_image_mode=False, model_complexity=1, smooth_landmarks=True) as lm:
        for f in files:
            img = mp.Image.create_from_file(f); W, H = img.width, img.height
            px = img.numpy_view()
            px = np.stack([px] * 3, axis=-1) if px.ndim == 2 else px[:, :, :3]
            res = lm.process(np.ascontiguousarray(px))
            out.append(pts(res.pose_landmarks.landmark) if res.pose_landmarks else None)

found = sum(1 for f in out if f)
sys.stderr.write('pose: %d of %d frames have a pose (%dx%d, %s)\n' % (found, len(out), W, H, 'model ' + os.path.basename(model) if model else 'legacy solutions'))
text = json.dumps({'fps': a.fps, 'w': W, 'h': H, 'frames': out}, separators=(',', ':'))
if a.out:
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    open(a.out, 'w').write(text)
else:
    sys.stdout.write(text)
