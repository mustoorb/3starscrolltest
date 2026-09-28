#!/usr/bin/env bash
# Synthetic stand-in for the 4K masters, for exercising the pipeline and the scroll
# rig before the real re-export (spec §5) exists. NOT footage — never ship its frames.
#
#   scripts/make-test-master.sh [out-dir=build]
#   → build/test-master-landscape.mp4   3840×2160, 779 frames, 30000/1001
#   → build/test-master-portrait.mp4    1440×2560, same timing
#
# Every frame carries its source frame number and the cut / hold markers from the
# edit, so the page's frame mapping can be checked by eye (?debug) or by test.
#
# Then: ALLOW_LOW_BITRATE=1 scripts/encode-frames.sh --placeholder \
#         --landscape build/test-master-landscape.mp4 --portrait build/test-master-portrait.mp4 \
#         --out build/test-frames --posters build/test-frames
#       open index.html?frames=build/test-frames/

set -euo pipefail
out="${1:-build}"
mkdir -p "$out"

font=$(fc-match -f '%{file}' 'DejaVu Sans:bold' 2>/dev/null || true)
[ -n "$font" ] && fontopt="fontfile='$font':" || fontopt=""

label() { # drawtext chain: frame number + segment/hold label
  local size="$1"
  printf "%s" "drawtext=${fontopt}text='%{n}':fontsize=${size}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=24:x=(w-tw)/2:y=(h-th)/2"
  printf "%s" ",drawtext=${fontopt}text='HOLD':fontsize=$((size / 3)):fontcolor=yellow:x=(w-tw)/2:y=(h/2)+${size}:enable='eq(n\\,230)+eq(n\\,380)+eq(n\\,475)+eq(n\\,580)+eq(n\\,660)'"
  printf "%s" ",drawtext=${fontopt}text='CUT':fontsize=$((size / 3)):fontcolor=red:x=(w-tw)/2:y=(h/2)+${size}:enable='between(n\\,143\\,147)+between(n\\,293\\,297)+between(n\\,431\\,435)+between(n\\,507\\,511)'"
}

make() { # <size> <fontsize> <file>
  ffmpeg -hide_banner -loglevel error -stats -y \
    -f lavfi -i "testsrc2=s=$1:r=30000/1001" -frames:v 779 \
    -vf "$(label "$2")" \
    -c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p "$3"
}

make 3840x2160 360 "$out/test-master-landscape.mp4"
make 1440x2560 240 "$out/test-master-portrait.mp4"
ls -la "$out"/test-master-*.mp4
