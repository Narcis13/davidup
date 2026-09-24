#!/usr/bin/env python3
"""Subtitles for how-ai-learns from the film's cues (hdf cues: every spoken word with its film time and voice).
A cue per sentence (or per 42-character line pair), Bit's and the fox's lines marked with who speaks.
Usage: python3 make-srt.py <cues.json> <out.srt>"""
import json, sys

cues = json.load(open(sys.argv[1]))
WHO = {'bit': 'Bit', 'fox': 'Fox'}
def stamp(t):
    ms = int(round(t * 1000)); h, ms = divmod(ms, 3600000); m, ms = divmod(ms, 60000); s, ms = divmod(ms, 1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'
# group the words into sentences, never across two recordings
groups, cur = [], []
for w in cues['words']:
    if cur and (w['voice'] != cur[-1]['voice'] or cur[-1]['text'][-1] in '.!?' or len(' '.join(x['text'] for x in cur + [w])) > 84):
        groups.append(cur); cur = []
    cur.append(w)
if cur: groups.append(cur)
# short sentences of the same recording that follow each other closely share a cue ("Pointy ears. Fur.")
merged = []
for gr in groups:
    prev = merged[-1] if merged else None
    text = ' '.join(x['text'] for x in gr)
    if prev and prev[-1]['voice'] == gr[0]['voice'] and gr[0]['t0'] - prev[-1]['t1'] < 0.9 and len(' '.join(x['text'] for x in prev)) + len(text) < 60:
        prev.extend(gr)
    else:
        merged.append(list(gr))
def wrap(text, n=42):
    if len(text) <= n: return text
    words, best = text.split(), None
    for i in range(1, len(words)):
        a, b = ' '.join(words[:i]), ' '.join(words[i:])
        score = max(len(a), len(b))
        if best is None or score < best[0]: best = (score, a + '\n' + b)
    return best[1]
out = []
for k, gr in enumerate(merged):
    t0, t1 = gr[0]['t0'], gr[-1]['t1'] + 0.35
    nxt = merged[k + 1][0]['t0'] if k + 1 < len(merged) else t1
    t1 = max(min(t1, nxt - 0.05), t0 + 0.9)
    who = WHO.get(gr[0]['voice'].split('-')[0])
    text = ' '.join(x['text'] for x in gr)
    out.append(f"{k + 1}\n{stamp(t0)} --> {stamp(t1)}\n{wrap((who + ': ' if who else '') + text)}\n")
open(sys.argv[2], 'w').write('\n'.join(out))
print(f'{sys.argv[2]}: {len(out)} cues')
