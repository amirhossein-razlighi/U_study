#!/bin/bash
# Builds docs/media/intro.mp4: Kokoro narrates each section, then Manim draws to its length.
# Usage: PYTHON=/path/to/manim/venv/bin/python WORK=/some/empty/dir tools/explainer/build.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../docs/media/intro.mp4"
PYTHON="${PYTHON:-python3}"
WORK="${WORK:-$(mktemp -d)}"
TTS_PYTHON="${TTS_PYTHON:-$HOME/.local/share/paper-explainer/tts-env/bin/python}"
TTS_SCRIPT="${TTS_SCRIPT:-$HOME/.claude/skills/paper-explainer/scripts/tts.py}"
VOICE="${VOICE:-af_heart}"
SPEED="${SPEED:-1.0}"
SECTIONS=(intro timeline timing hearing quality natural overall)
GAP_SECONDS=0.5

mkdir -p "$WORK/tts"
SSL_CERT_FILE=/etc/ssl/cert.pem HF_HUB_OFFLINE=1 "$TTS_PYTHON" "$TTS_SCRIPT" "$HERE/narration.json" "$WORK/tts" "$VOICE" "$SPEED"

: > "$WORK/audio.txt"
echo "{" > "$WORK/durations.json"
for name in "${SECTIONS[@]}"; do
  ffmpeg -y -v error -i "$WORK/tts/$name.wav" -af "apad=pad_dur=$GAP_SECONDS" -ar 44100 -ac 2 "$WORK/$name.wav"
  seconds="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/$name.wav")"
  [ "$name" = "${SECTIONS[0]}" ] || echo "," >> "$WORK/durations.json"
  printf '"%s": %s' "$name" "$seconds" >> "$WORK/durations.json"
  echo "file '$WORK/$name.wav'" >> "$WORK/audio.txt"
done
echo "}" >> "$WORK/durations.json"

# Raw Kokoro output is quiet, so bring the narration to a normal speech loudness.
ffmpeg -y -v error -f concat -safe 0 -i "$WORK/audio.txt" -af "loudnorm=I=-16:TP=-1.5:LRA=11" -ar 44100 -c:a pcm_s16le "$WORK/narration.wav"
EXPLAINER_DURATIONS="$WORK/durations.json" "$PYTHON" -m manim render -qm --media_dir "$WORK/media" --disable_caching "$HERE/explainer.py" Explainer
VIDEO="$(find "$WORK/media" -name 'Explainer.mp4' | head -1)"
ffmpeg -y -v error -i "$VIDEO" -i "$WORK/narration.wav" -map 0:v -map 1:a -c:v libx264 -pix_fmt yuv420p -crf 24 -preset slow -c:a aac -b:a 128k -shortest -map_metadata -1 -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
