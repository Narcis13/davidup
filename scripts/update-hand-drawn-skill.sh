#!/usr/bin/env bash
# Sync .claude/skills/hand-drawn-canvas-animation with the upstream copy at
# https://github.com/alesha-pro/tools/tree/main/skills/hand-drawn-canvas-animation
#
# Usage: scripts/update-hand-drawn-skill.sh [--check] [ref]
#   --check  only report whether an update is available (exit 1 if so)
#   ref      branch, tag or commit to sync from (default: main)
#
# The local folder is replaced wholesale (files deleted upstream are removed
# here too). The synced commit is recorded in .upstream inside the skill dir.
set -euo pipefail

REPO="alesha-pro/tools"
SUBDIR="skills/hand-drawn-canvas-animation"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/.claude/skills/hand-drawn-canvas-animation"
STAMP="$DEST/.upstream"

CHECK=0
if [[ "${1:-}" == "--check" ]]; then CHECK=1; shift; fi
REF="${1:-main}"

# Resolve the ref to a commit SHA so we can report / skip no-op updates.
SHA="$(curl -fsSL -H 'Accept: application/vnd.github.sha' \
  "https://api.github.com/repos/$REPO/commits/$REF")" \
  || { echo "error: could not resolve $REPO@$REF" >&2; exit 2; }

CURRENT=""
[[ -f "$STAMP" ]] && CURRENT="$(sed -n 's/^commit: //p' "$STAMP")"

if [[ "$SHA" == "$CURRENT" ]]; then
  echo "Up to date ($REPO@${SHA:0:7})."
  exit 0
fi

if (( CHECK )); then
  echo "Update available: ${CURRENT:0:7}${CURRENT:+ -> }${SHA:0:7}"
  echo "https://github.com/$REPO/commits/$SHA/$SUBDIR"
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading $REPO@${SHA:0:7}..."
curl -fsSL "https://codeload.github.com/$REPO/tar.gz/$SHA" | tar -xz -C "$TMP"
SRC="$(echo "$TMP"/*/"$SUBDIR")"
[[ -f "$SRC/SKILL.md" ]] || { echo "error: $SUBDIR/SKILL.md not found upstream" >&2; exit 2; }

mkdir -p "$DEST"
rsync -a --delete --exclude .upstream --itemize-changes "$SRC/" "$DEST/" \
  | grep -v '^\.d' || true

printf 'repo: https://github.com/%s\npath: %s\ncommit: %s\nsynced: %s\n' \
  "$REPO" "$SUBDIR" "$SHA" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STAMP"

echo "Synced to ${SHA:0:7}. Review with: git -C \"$ROOT\" status -- .claude/skills/hand-drawn-canvas-animation"
