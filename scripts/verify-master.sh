#!/usr/bin/env bash
# Refuse to encode frames from anything that isn't a true 4K master of the edit.
#
#   scripts/verify-master.sh <file> landscape|portrait
#
# Checks (spec §3–§5):
#   • resolution   landscape ≥ 3840×2160, portrait ≥ 1440×2560
#                  (the 1920×1080 / 1080×1920 proxies fail here — that is the point)
#   • frame rate   exactly 30000/1001 (29.97), not 30
#   • frame count  exactly 779 — otherwise every beat lands on the wrong machine
#   • bitrate      ≥ 60 Mb/s unless ProRes (below that re-creates the original defect)
#
# Exits non-zero on any failure. ALLOW_LOW_BITRATE=1 skips only the bitrate check
# (used by the synthetic test master, never for real footage).
#
# Portable to macOS bash 3.2 — no associative arrays, no mapfile.

set -euo pipefail

EXPECTED_FRAMES=779
EXPECTED_RATE="30000/1001"
MIN_BITRATE=60000000

file="${1:-}"
orient="${2:-landscape}"

if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "usage: $0 <master file> landscape|portrait" >&2
  exit 2
fi
command -v ffprobe >/dev/null || { echo "ffprobe not found (install ffmpeg)" >&2; exit 2; }

probe() {
  ffprobe -v error -select_streams v:0 -show_entries "$1" -of default=nw=1:nk=1 "$file" | head -n1
}

width=$(probe stream=width)
height=$(probe stream=height)
rate=$(probe stream=r_frame_rate)
codec=$(probe stream=codec_name)
profile=$(probe stream=profile)
pix_fmt=$(probe stream=pix_fmt)
bitrate=$(probe stream=bit_rate)
case "$bitrate" in ''|N/A) bitrate=$(ffprobe -v error -show_entries format=bit_rate -of default=nw=1:nk=1 "$file") ;; esac
# Packet count reads the container index only — fast even on a 28 GB ProRes file.
frames=$(ffprobe -v error -select_streams v:0 -count_packets -show_entries stream=nb_read_packets -of default=nw=1:nk=1 "$file")

echo "── $file"
echo "   ${width}×${height}  ${codec} ${profile} ${pix_fmt}  ${rate} fps  ${frames} frames  $(awk -v b="${bitrate:-0}" 'BEGIN{printf "%.0f Mb/s", b/1e6}')"

fail=0
err() { echo "   ✗ $*" >&2; fail=1; }
ok()  { echo "   ✓ $*"; }

case "$orient" in
  landscape) min_w=3840; min_h=2160 ;;
  portrait)  min_w=1440; min_h=2560 ;;
  *) echo "orientation must be landscape or portrait" >&2; exit 2 ;;
esac

if [ "$width" -ge "$min_w" ] && [ "$height" -ge "$min_h" ]; then
  ok "resolution ≥ ${min_w}×${min_h}"
else
  err "resolution ${width}×${height} is below ${min_w}×${min_h} — this is a proxy, not the master (spec §3)"
fi

if [ "$orient" = landscape ] && [ "$width" -lt "$height" ]; then err "expected a landscape master"; fi
if [ "$orient" = portrait ]  && [ "$width" -gt "$height" ]; then err "expected a portrait master"; fi

if [ "$rate" = "$EXPECTED_RATE" ]; then
  ok "frame rate 29.97 (30000/1001)"
else
  err "frame rate is $rate, expected $EXPECTED_RATE (spec §5 step 4)"
fi

if [ "$frames" = "$EXPECTED_FRAMES" ]; then
  ok "frame count $EXPECTED_FRAMES"
else
  err "frame count is $frames, expected exactly $EXPECTED_FRAMES — the beat map will not line up (spec §5 step 5)"
fi

if [ "$codec" = prores ]; then
  ok "ProRes source"
elif [ "${ALLOW_LOW_BITRATE:-0}" = 1 ]; then
  echo "   ! bitrate check skipped (ALLOW_LOW_BITRATE=1)"
elif [ -n "$bitrate" ] && [ "$bitrate" != N/A ] && [ "$bitrate" -ge "$MIN_BITRATE" ]; then
  ok "bitrate ≥ 60 Mb/s"
else
  err "bitrate below 60 Mb/s — re-export at ProRes 422 HQ or H.264 ≥ 100 Mb/s (spec §5)"
fi

exit $fail
