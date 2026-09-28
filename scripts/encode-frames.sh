#!/usr/bin/env bash
# Master → frames, in exactly one lossy step (spec §3, §6).
#
#   scripts/encode-frames.sh --landscape master4k.mov [--portrait master4k-portrait.mov]
#                            [--step 3] [--out assets/frames] [--posters assets]
#                            [--no-webp] [--clean] [--force] [--placeholder]
#
#   --landscape FILE  4K landscape export of the 26 s edit (3840×2160, 779 frames, 29.97)
#   --portrait FILE   portrait export (1440×2560, frame-identical to landscape)
#   --step N          desktop: keep every Nth source frame. 3 → 260 frames (default,
#                     spec §17 recommendation), 2 → 390 frames. Mobile is always 3.
#   --out DIR         frame output (default assets/frames). Point the page's
#                     data-frames-base at this directory or its CDN copy.
#   --posters DIR     poster JPEG/AVIF output (default assets)
#   --no-webp         skip the WebP fallback sets (Safari < 16.4 will then get nothing)
#   --clean           re-encode sets that already exist (default: skip complete sets)
#   --force           encode even if verify-master.sh fails — never for real launches
#   --placeholder     mark the manifest as test frames; the page shows a badge
#
# Frames are selected by index (select='not(mod(n,N))'), never with fps= — the source
# is 30000/1001 and fps= duplicates frames, which reads as stutter (spec §6, §16).
#
# Build on the internal disk, not the exFAT SSDs (spec §16). Portable to macOS bash 3.2.

set -euo pipefail

SRC_FRAMES=779
# Must match the `hold` spans in js/flythrough.js TIMELINE. The page warns if not.
HOLD_FRAMES="230 380 475 580 660"

landscape=""; portrait=""; step=3; out="assets/frames"; posters="assets"
webp=1; clean=0; force=0; placeholder=false

while [ $# -gt 0 ]; do
  case "$1" in
    --landscape) landscape="$2"; shift 2 ;;
    --portrait)  portrait="$2";  shift 2 ;;
    --step)      step="$2";      shift 2 ;;
    --out)       out="$2";       shift 2 ;;
    --posters)   posters="$2";   shift 2 ;;
    --no-webp)   webp=0; shift ;;
    --clean)     clean=1; shift ;;
    --force)     force=1; shift ;;
    --placeholder) placeholder=true; shift ;;
    -h|--help)   sed -n '2,24p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -n "$landscape" ] || { echo "--landscape is required" >&2; exit 2; }
case "$step" in 2|3) ;; *) echo "--step must be 2 or 3 (779 divides cleanly by neither, but both leave no remainder frame)" >&2; exit 2 ;; esac
command -v ffmpeg >/dev/null || { echo "ffmpeg not found" >&2; exit 2; }
# (captured first: grep -q closing the pipe early trips pipefail)
encoders=$(ffmpeg -hide_banner -encoders 2>/dev/null)
case "$encoders" in *libaom-av1*) ;; *) echo "ffmpeg lacks libaom-av1" >&2; exit 2 ;; esac
case "$encoders" in *libwebp*) ;; *) echo "ffmpeg lacks libwebp (or pass --no-webp)" >&2; exit 2 ;; esac

here="$(cd "$(dirname "$0")" && pwd)"

# ── 1. Verify the masters ───────────────────────────────────────────────────
verify() {
  if ! "$here/verify-master.sh" "$1" "$2"; then
    if [ "$force" = 1 ]; then
      echo "!! verify failed for $1 — continuing because of --force. Do NOT ship these frames." >&2
    else
      echo "Refusing to encode from $1. Fix the export (spec §5) or pass --force for a throwaway test." >&2
      exit 1
    fi
  fi
}
verify "$landscape" landscape
[ -z "$portrait" ] || verify "$portrait" portrait

mkdir -p "$out" "$posters"

count_for() { echo $(( (SRC_FRAMES + $1 - 1) / $1 )); }

hold_expr=""
for f in $HOLD_FRAMES; do hold_expr="${hold_expr:+$hold_expr+}eq(n\\,$f)"; done
hold_count=$(echo $HOLD_FRAMES | wc -w | tr -d ' ')

AVIF_OPTS="-c:v libaom-av1 -still-picture 1 -cpu-used 6 -row-mt 1 -pix_fmt yuv420p"
# AVIF sequences — two traps in the obvious commands:
#  • `… f_%04d.avif` with no -f picks the AVIF muxer and writes ONE animated file
#    literally named "f_%04d.avif";
#  • `-f image2` alone writes a sequence, but each file's av1C box is empty (ffmpeg
#    6.1). ffmpeg reads those back fine; Chrome refuses to decode them.
# +global_header makes libaom emit the config record up front, so every file gets a
# complete av1C and the still-image "avif" brand. check_av1c() guards regressions.
# (The segment muxer also fills av1C, but brands each file "avis" = animated.)
AVIF_SEQ="-flags +global_header -f image2"
WEBP_OPTS="-c:v libwebp -compression_level 6 -preset picture"
WEBP_SEQ="-f image2"

# A valid av1C box carries a config record starting 0x81; an empty one does not.
check_av1c() {
  od -A n -t x1 "$1" | tr -d ' \n' | grep -q 6176314381 || {
    echo "✗ $1 has an empty av1C box — browsers will not decode it (see AVIF_SEQ note)" >&2
    exit 1
  }
}

# encode <label> <input> <select-expr> <width> <dir> <pattern> <expected> <codec opts...>
encode() {
  local label="$1" input="$2" sel="$3" width="$4" dir="$5" pattern="$6" expected="$7"
  shift 7
  local have=0
  if [ -d "$out/$dir" ]; then have=$(find "$out/$dir" -type f ! -name '._*' | wc -l | tr -d ' '); fi
  if [ "$clean" = 0 ] && [ "$have" = "$expected" ]; then
    echo "── $label: $expected files already present, skipping (use --clean to redo)"
    return
  fi
  echo "── $label → $out/$dir ($expected files)"
  local tmp="$out/.tmp-$dir"
  rm -rf "$tmp"; mkdir -p "$tmp"
  ffmpeg -hide_banner -loglevel error -stats -i "$input" \
    -vf "select='$sel',scale=$width:-2:flags=lanczos" \
    -fps_mode passthrough "$@" "$tmp/$pattern"
  local got
  got=$(find "$tmp" -type f | wc -l | tr -d ' ')
  if [ "$got" != "$expected" ]; then
    echo "✗ $label produced $got files, expected $expected" >&2
    exit 1
  fi
  case "$pattern" in *.avif) check_av1c "$(find "$tmp" -type f -name '*.avif' | sort | head -n1)" ;; esac
  rm -rf "${out:?}/$dir"; mv "$tmp" "$out/$dir"
}

# ── 2. Desktop ──────────────────────────────────────────────────────────────
d_count=$(count_for "$step")
encode "desktop AVIF" "$landscape" "not(mod(n\\,$step))" 2560 desktop 'f_%04d.avif' "$d_count" $AVIF_OPTS -crf 40 $AVIF_SEQ
encode "desktop holds AVIF" "$landscape" "$hold_expr" 3072 holds 'hold_%02d.avif' "$hold_count" $AVIF_OPTS -crf 28 $AVIF_SEQ
if [ "$webp" = 1 ]; then
  encode "desktop WebP" "$landscape" "not(mod(n\\,$step))" 2560 desktop-webp 'f_%04d.webp' "$d_count" $WEBP_OPTS -quality 55 $WEBP_SEQ
  encode "desktop holds WebP" "$landscape" "$hold_expr" 3072 holds-webp 'hold_%02d.webp' "$hold_count" $WEBP_OPTS -quality 80 $WEBP_SEQ
fi

echo "── landscape poster"
ffmpeg -hide_banner -loglevel error -y -i "$landscape" -frames:v 1 -vf "scale=2560:-2:flags=lanczos" -q:v 3 "$posters/poster-landscape.jpg"
ffmpeg -hide_banner -loglevel error -y -i "$landscape" -frames:v 1 -vf "scale=2560:-2:flags=lanczos" $AVIF_OPTS -crf 36 "$posters/poster-landscape.avif"
check_av1c "$posters/poster-landscape.avif"

# ── 3. Mobile portrait ──────────────────────────────────────────────────────
m_count=$(count_for 3)
if [ -n "$portrait" ]; then
  encode "mobile AVIF" "$portrait" "not(mod(n\\,3))" 1080 mobile 'm_%04d.avif' "$m_count" $AVIF_OPTS -crf 42 $AVIF_SEQ
  encode "mobile holds AVIF" "$portrait" "$hold_expr" 1440 holds-mobile 'hold_%02d.avif' "$hold_count" $AVIF_OPTS -crf 30 $AVIF_SEQ
  if [ "$webp" = 1 ]; then
    encode "mobile WebP" "$portrait" "not(mod(n\\,3))" 1080 mobile-webp 'm_%04d.webp' "$m_count" $WEBP_OPTS -quality 55 $WEBP_SEQ
    encode "mobile holds WebP" "$portrait" "$hold_expr" 1440 holds-mobile-webp 'hold_%02d.webp' "$hold_count" $WEBP_OPTS -quality 80 $WEBP_SEQ
  fi
  echo "── portrait poster"
  ffmpeg -hide_banner -loglevel error -y -i "$portrait" -frames:v 1 -vf "scale=1080:-2:flags=lanczos" -q:v 3 "$posters/poster-portrait.jpg"
  ffmpeg -hide_banner -loglevel error -y -i "$portrait" -frames:v 1 -vf "scale=1080:-2:flags=lanczos" $AVIF_OPTS -crf 38 "$posters/poster-portrait.avif"
  check_av1c "$posters/poster-portrait.avif"
fi

# exFAT / macOS sidecars must never be uploaded (spec §16)
find "$out" "$posters" -name '._*' -type f -delete 2>/dev/null || true

# ── 4. Manifest ─────────────────────────────────────────────────────────────
dims() { ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0:s=x "$1"; }
bytes() { if [ -d "$1" ]; then find "$1" -type f ! -name '._*' -exec cat {} + | wc -c | tr -d ' '; else echo 0; fi; }
mb() { awk -v b="$1" 'BEGIN{printf "%.1f MB", b/1048576}'; }

d_dims=$(dims "$out/desktop/f_0001.avif"); d_w=${d_dims%x*}; d_h=${d_dims#*x}
holds_json="[$(echo $HOLD_FRAMES | sed 's/ /, /g')]"
webp_d='null'; webp_dh='null'; webp_m='null'; webp_mh='null'
if [ "$webp" = 1 ]; then
  webp_d='"desktop-webp/f_%04d.webp"'; webp_dh='"holds-webp/hold_%02d.webp"'
  webp_m='"mobile-webp/m_%04d.webp"';  webp_mh='"holds-mobile-webp/hold_%02d.webp"'
fi

mobile_json='null'
if [ -n "$portrait" ]; then
  m_dims=$(dims "$out/mobile/m_0001.avif"); m_w=${m_dims%x*}; m_h=${m_dims#*x}
  mobile_json=$(cat <<EOF
{
      "step": 3, "count": $m_count, "width": $m_w, "height": $m_h,
      "avif": "mobile/m_%04d.avif", "webp": $webp_m,
      "holds": { "avif": "holds-mobile/hold_%02d.avif", "webp": $webp_mh }
    }
EOF
)
fi

cat > "$out/manifest.json" <<EOF
{
  "version": 1,
  "generated": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "placeholder": $placeholder,
  "srcFrames": $SRC_FRAMES,
  "holdFrames": $holds_json,
  "sets": {
    "desktop": {
      "step": $step, "count": $d_count, "width": $d_w, "height": $d_h,
      "avif": "desktop/f_%04d.avif", "webp": $webp_d,
      "holds": { "avif": "holds/hold_%02d.avif", "webp": $webp_dh }
    },
    "mobile": $mobile_json
  }
}
EOF

# ── 5. Budgets (spec §18: desktop ≤ 50 MB, mobile ≤ 15 MB) ─────────────────
d_bytes=$(( $(bytes "$out/desktop") + $(bytes "$out/holds") ))
echo
echo "desktop AVIF  $d_count × ${d_w}×${d_h} + holds   $(mb $d_bytes)"
[ "$webp" = 1 ] && echo "desktop WebP  (fallback)                  $(mb $(( $(bytes "$out/desktop-webp") + $(bytes "$out/holds-webp") )))"
budget_fail=0
[ "$d_bytes" -le $((50 * 1048576)) ] || { echo "✗ desktop over the 50 MB budget" >&2; budget_fail=1; }
if [ -n "$portrait" ]; then
  m_bytes=$(( $(bytes "$out/mobile") + $(bytes "$out/holds-mobile") ))
  echo "mobile AVIF   $m_count × ${m_w}×${m_h} + holds   $(mb $m_bytes)"
  [ "$webp" = 1 ] && echo "mobile WebP   (fallback)                  $(mb $(( $(bytes "$out/mobile-webp") + $(bytes "$out/holds-mobile-webp") )))"
  [ "$m_bytes" -le $((15 * 1048576)) ] || { echo "✗ mobile over the 15 MB budget" >&2; budget_fail=1; }
fi
echo "manifest      $out/manifest.json"
echo
echo "Next: scripts/qa-frame.sh \"$landscape\" $out 231   # compare an encoded frame to the master at 100%"
exit $budget_fail
