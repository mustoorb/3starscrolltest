#!/usr/bin/env bash
# Pre-launch gate (spec §14, §18). Fails while anything invented or missing would go live.
#
#   scripts/check-launch.sh [--strict]
#
#   ✗ fails on  [data-placeholder] in any page or template (invented or missing content)
#               missing / test-frame manifest, missing posters, missing tour video
#               macOS ._ sidecar files
#   ! warns on  [data-draft] copy — written to fit the layout, needs client sign-off
#               (--strict turns these into failures)

set -uo pipefail
cd "$(dirname "$0")/.."

strict=0; [ "${1:-}" = --strict ] && strict=1
fail=0
bad()  { echo "✗ $*"; fail=1; }
warn() { echo "! $*"; [ "$strict" = 1 ] && fail=1; }

pages="index.html products.html"
wp=wordpress/page-flythrough.php

n=$(cat $pages | grep -c 'data-placeholder')
if [ "$n" -gt 0 ]; then
  bad "$n placeholder(s) still on the static pages — real figures/names needed from the client:"
  grep -n 'data-placeholder' $pages | sed 's/^/    /' | cut -c1-160
fi

# The PHP template keeps copy in arrays: placeholders are null values, an empty
# tour video URL, and the literal placeholder footer. threestar_value() itself and
# the tour fallback branch are exempt — they only render when a value is missing.
if [ -f "$wp" ]; then
  wp_hits=$(grep -n "=> null\\|_tour_video *= *''\\|data-placeholder>Address" "$wp")
  if [ -n "$wp_hits" ]; then
    bad "$wp still has placeholders:"
    echo "$wp_hits" | sed 's/^/    /' | cut -c1-160
  fi
  pages="$pages $wp"
fi

d=$(grep -c 'data-draft' $pages 2>/dev/null | awk -F: '{s+=$2} END{print s+0}')
[ "$d" -gt 0 ] && warn "$d draft line(s) need client sign-off (grep -n data-draft)"

m=assets/frames/manifest.json
if [ ! -f "$m" ]; then
  bad "no $m — frames not encoded (scripts/encode-frames.sh), or they live on the CDN: check there"
elif grep -q '"placeholder": *true' "$m"; then
  bad "$m is from the synthetic test master — encode from the real 4K export"
fi

for f in assets/poster-landscape.jpg assets/poster-portrait.jpg assets/video/full-tour.mp4; do
  [ -f "$f" ] || bad "missing $f"
done

side=$(find . -name '._*' -not -path './.git/*' | head -n 5)
[ -z "$side" ] || bad "macOS ._ sidecar files present (spec §16):"$'\n'"$side"

if [ "$fail" = 0 ]; then echo "✓ launch checks pass"; else echo; echo "Not ready to launch."; fi
exit $fail
