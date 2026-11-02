#!/usr/bin/env bash
# Render the promo film and master it to -16 LUFS.
set -euo pipefail
cd "$(dirname "$0")"

npx --yes hyperframes@0.9.1 render --quality high --output .raw.mp4
ffmpeg -v error -y -i .raw.mp4 \
  -c:v copy -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k \
  -movflags +faststart kanban-gantt-promo.mp4
rm -f .raw.mp4

echo "duration: $(ffprobe -v error -show_entries format=duration -of csv=p=0 kanban-gantt-promo.mp4)s"
echo "size: $(du -h kanban-gantt-promo.mp4 | cut -f1)"
