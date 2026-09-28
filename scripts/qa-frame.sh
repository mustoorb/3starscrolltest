#!/usr/bin/env bash
# Rule 4 of spec §3: verify before shipping.
#
#   scripts/qa-frame.sh <master> [frames-dir=assets/frames] [src-frame=231] [set=desktop]
#
# Pulls source frame N from the 4K master (scaled to the set's width with lanczos,
# lossless PNG) and the matching encoded frame as the browser will receive it, then:
#   • prints SSIM / PSNR of encoded vs master
#   • writes qa/frame_N_compare.png — left half master, right half encoded, both at
#     100%. Open it at 100% zoom on a Retina display. If machine detail on the right
#     is mushy compared to the left, the pipeline is wrong. Do not ship.
#
# Use a frame with fine detail (machine labels, rollers, grating). Hold frames
# 230/380/475/580/660 are what users stare at; check them via --holds.
#   scripts/qa-frame.sh <master> assets/frames --holds

set -euo pipefail

master="${1:?usage: $0 <master> [frames-dir] [src-frame|--holds] [desktop|mobile]}"
dir="${2:-assets/frames}"
arg="${3:-231}"
set_name="${4:-desktop}"
qa="qa"
mkdir -p "$qa"

manifest="$dir/manifest.json"
[ -f "$manifest" ] || { echo "no manifest at $manifest — run encode-frames.sh first" >&2; exit 2; }

# Minimal JSON read without jq: everything from the set's key on; first step/width wins.
block=$(awk -v s="\"$set_name\":" 'index($0,s){f=1} f{print}' "$manifest")
step=$(echo "$block" | sed -n 's/.*"step": *\([0-9]*\).*/\1/p' | head -n1)
width=$(echo "$block" | sed -n 's/.*"width": *\([0-9]*\).*/\1/p' | head -n1)
[ -n "$step" ] || { echo "set '$set_name' not in manifest" >&2; exit 2; }
prefix=f; seqdir=desktop; holddir=holds
[ "$set_name" = mobile ] && { prefix=m; seqdir=mobile; holddir=holds-mobile; }

compare() { # <src-frame> <encoded-file> <width> <label>
  local n="$1" enc="$2" w="$3" label="$4"
  local ref="$qa/${label}_master.png" dec="$qa/${label}_encoded.png" out="$qa/${label}_compare.png"
  ffmpeg -hide_banner -loglevel error -y -i "$master" \
    -vf "select='eq(n\\,$n)',scale=$w:-2:flags=lanczos" -fps_mode passthrough -frames:v 1 "$ref"
  ffmpeg -hide_banner -loglevel error -y -i "$enc" -frames:v 1 "$dec"
  local metrics
  metrics=$(ffmpeg -hide_banner -i "$dec" -i "$ref" -lavfi "[0][1]ssim;[0][1]psnr" -f null - 2>&1 \
    | sed -n 's/.*SSIM.*All:\([0-9.]*\).*/SSIM \1/p; s/.*PSNR.*average:\([0-9.inf]*\).*/PSNR \1 dB/p' | tr '\n' ' ')
  ffmpeg -hide_banner -loglevel error -y -i "$ref" -i "$dec" \
    -filter_complex "[0]crop=iw/2:ih:iw/4:0[a];[1]crop=iw/2:ih:iw/4:0[b];[a][b]hstack" "$out"
  echo "src frame $n  ($(basename "$enc"))  $metrics→ $out"
}

if [ "$arg" = --holds ]; then
  i=1
  for n in 230 380 475 580 660; do
    compare "$n" "$(printf "%s/%s/hold_%02d.avif" "$dir" "$holddir" "$i")" \
      "$(ffprobe -v error -show_entries stream=width -of csv=p=0 "$(printf "%s/%s/hold_%02d.avif" "$dir" "$holddir" "$i")")" \
      "${set_name}_hold_$n"
    i=$((i + 1))
  done
else
  n=$(( arg / step * step ))
  [ "$n" = "$arg" ] || echo "(frame $arg is not in the every-${step}th set; using $n)"
  compare "$n" "$(printf "%s/%s/%s_%04d.avif" "$dir" "$seqdir" "$prefix" $(( n / step + 1 )))" "$width" "${set_name}_frame_$n"
fi
echo "Left half = master, right half = encoded. Inspect at 100%."
