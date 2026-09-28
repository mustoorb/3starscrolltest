#!/usr/bin/env bash
# Build the deployable site into _site/. Netlify's build command and the GitHub
# Pages workflow both run this.
#
#   scripts/build-site.sh
#
# • Real frames committed (assets/frames/manifest.json, not a test manifest):
#   publishes the site and assets/ as they are.
# • No real frames yet: publishes a PREVIEW. Synthetic test frames from
#   build/test-frames go where the real ones will live. The page shows its
#   "Test frames — not footage" badge. If build/test-frames is missing it is
#   generated (AVIF only, ~5–10 min), downloading a static ffmpeg when the machine
#   has none with libaom (Netlify's build image has no ffmpeg).
#
# Once real frames are committed, every deploy switches to them with no config change.

set -euo pipefail
cd "$(dirname "$0")/.."

out=_site
frames=build/test-frames
FFMPEG_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz"

has_encoders() {
  command -v ffmpeg >/dev/null 2>&1 || return 1
  local enc
  enc=$(ffmpeg -hide_banner -encoders 2>/dev/null)
  case "$enc" in *libaom-av1*) ;; *) return 1 ;; esac
  case "$enc" in *libx264*) return 0 ;; *) return 1 ;; esac
}

ensure_ffmpeg() {
  has_encoders && return
  echo "── fetching static ffmpeg (no ffmpeg with libaom on this machine)"
  mkdir -p build/ffmpeg
  curl -fsSL --retry 3 "$FFMPEG_URL" | tar -xJ -C build/ffmpeg --strip-components=1
  export PATH="$PWD/build/ffmpeg/bin:$PATH"
  has_encoders || { echo "✗ downloaded ffmpeg lacks libaom-av1/libx264" >&2; exit 1; }
}

real=0
if [ -f assets/frames/manifest.json ] && ! grep -q '"placeholder": *true' assets/frames/manifest.json; then
  real=1
fi

rm -rf "$out"
mkdir -p "$out"
cp index.html products.html "$out/"
cp -R css js "$out/"
if [ -d assets ]; then cp -R assets "$out/"; fi

if [ "$real" = 1 ]; then
  echo "── real frames found: publishing assets/ as-is"
else
  echo "── no real frames yet: building a PREVIEW with synthetic test frames"
  if [ ! -f "$frames/manifest.json" ]; then
    ensure_ffmpeg
    scripts/make-test-master.sh build
    ALLOW_LOW_BITRATE=1 scripts/encode-frames.sh --placeholder --no-webp \
      --landscape build/test-master-landscape.mp4 --portrait build/test-master-portrait.mp4 \
      --out "$frames" --posters "$frames"
  fi
  rm -rf "$out/assets/frames"
  mkdir -p "$out/assets/frames"
  for d in "$frames"/*/; do cp -R "$d" "$out/assets/frames/"; done
  cp "$frames/manifest.json" "$out/assets/frames/"
  cp "$frames"/poster-* "$out/assets/"
fi

find "$out" -name '._*' -type f -delete
echo "── $out ready: $(find "$out" -type f | wc -l | tr -d ' ') files, $(du -sh "$out" | cut -f1)"
