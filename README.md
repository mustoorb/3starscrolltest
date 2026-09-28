# Threestar Packaging — factory flythrough

A landing page that pins a single drone pass through the factory to the viewport and scrubs it with scroll. The camera holds on five machines, each with a text beat, then the page hands off to the products section.

The footage is a numbered image sequence drawn to `<canvas>`, not a `<video>` (spec §1). The page ships **without frames** until the 4K re-export exists (spec §5). Until then it renders its static layout, and every figure on it is a visible `TBC` placeholder (spec §14).

```
index.html                 landing page (static-site integration target)
products.html              products by industry vertical (layout draft)
css/site.css               shared tokens, nav, stats, hand-off, tour, footer
css/flythrough.css         stage, scrims, beats; static + pinned layouts
css/products.css           products page
js/flythrough.js           the scrubber — TIMELINE and all tuning constants at the top
wordpress/                 page template + functions.php snippet (if the live site is WP)
scripts/verify-master.sh   refuses proxies: ≥4K, 779 frames, 29.97, ≥60 Mb/s
scripts/encode-frames.sh   master → AVIF + WebP sets, hold stills, posters, manifest
scripts/qa-frame.sh        encoded frame vs master at 100% + SSIM/PSNR
scripts/check-launch.sh    fails while placeholders, test frames or assets remain
scripts/make-test-master.sh  synthetic 779-frame 4K master for testing the rig
scripts/build-site.sh      builds _site/ for Netlify / GitHub Pages (preview frames until real ones exist)
netlify.toml               Netlify build settings and headers
.github/workflows/pages.yml  GitHub Pages deploy
tests/                     local server + headless-Chromium tests
```

## Preview it now (synthetic frames)

```bash
npm install                 # playwright only, for tests
npm run test-master         # synthetic 4K master → build/test-frames (~5 min, ffmpeg + libaom)
npm run serve               # http://localhost:8080/?frames=build/test-frames/&debug
npm test
```

The test frames show their own source frame number, plus `HOLD` and `CUT` markers. That makes the frame mapping checkable by eye. The page shows a "Test frames" badge whenever the manifest is synthetic. `build/` is git-ignored: never commit these frames.

## Live preview (Netlify or GitHub Pages)

Both hosts run `scripts/build-site.sh`, which publishes `_site/`:
- **No real frames committed** (the case today): it deploys a **preview**. Synthetic test frames are generated during the build and placed where the real ones will go, with the "Test frames" badge.
- **Real frames committed** to `assets/frames/`: it publishes them as they are. No configuration change is needed.

**Netlify.** Choose *Add new site → Import an existing project*, pick this repo and deploy. `netlify.toml` supplies the build command, publish directory and headers, so leave the form as it is. Netlify's build image has no ffmpeg, so the build downloads a static one (~150 MB). Each deploy takes about 5–10 minutes; most of that is encoding.

**GitHub Pages.** Go to *Settings → Pages → Source* and choose **GitHub Actions**. `.github/workflows/pages.yml` deploys on every push to `main`. It caches the test frames, so only the first run is slow.

QA switches: `?debug` shows an overlay with set, px, source frame, index, loaded count and fps. `?format=webp|avif` and `?set=desktop|mobile` force a variant. `?frames=<relative path>` swaps the frame source. It accepts same-origin paths only.

## Producing the real frames

**Never encode from `horizontal.mp4` / `potrait.mp4` or any 1080p file.** Read spec §3 for why. `verify-master.sh` enforces this: it rejects anything under 4K, not exactly 779 frames, not 30000/1001, or under 60 Mb/s (ProRes excepted). `encode-frames.sh` runs it first and stops on failure.

1. **Re-export from Resolve** (spec §5). Use a 3840×2160 timeline, ProRes 422 HQ, 29.97, audio off, **exactly 779 frames**, cuts still at 145 / 295 / 433 / 509. For portrait, use a 1440×2560 timeline, frame-identical. Work on the internal disk, not the exFAT SSDs (spec §16).
2. **Encode.** This takes about 10–20 minutes on a laptop:
   ```bash
   scripts/encode-frames.sh --landscape master4k.mov --portrait master4k-portrait.mov
   ```
   The default is `--step 3`: 260 desktop frames, the spec §17 recommendation. Use `--step 2` for 390. Output goes to `assets/frames/` (frames + `manifest.json`) and `assets/poster-*`. The script prints payload totals and fails if desktop is over 50 MB or mobile over 15 MB.
3. **Look at it** (spec §3 rule 4):
   ```bash
   scripts/qa-frame.sh master4k.mov assets/frames 231      # a travelling frame
   scripts/qa-frame.sh master4k.mov assets/frames --holds  # the five stills people stare at
   ```
   Open `qa/*_compare.png` at 100% on a Retina screen. The left half is the master and the right half is the encode. On the synthetic master, SSIM is about 0.95 for sequence frames and about 0.98 for holds; real footage will differ. Machine detail must survive. If it doesn't, change the pipeline, not the frame size.
4. Re-run `scripts/encode-frames.sh`. Complete sets are skipped. Use `--clean` to redo them.

### What the encoder makes

| Set | Frames | Size | Codec |
|---|---|---|---|
| `desktop/` | every 3rd (or 2nd) source frame | 2560 wide | AVIF crf 40 |
| `holds/` | source frames 230 / 380 / 475 / 580 / 660 | 3072 wide | AVIF crf 28 |
| `mobile/` | every 3rd, portrait | 1080 wide | AVIF crf 42 |
| `holds-mobile/` | the five holds, portrait | 1440 wide | AVIF crf 30 |
| `*-webp/` | same as above | same | WebP (Safari < 16.4) |

Frames are selected by index, `select='not(mod(n,N))'`, never by `fps=`. The source is 30000/1001, and `fps=` duplicates frames.

## Deploying

**Static site** (this repo): deploy the root as-is. Frames are committed normally, never through Git LFS: GitHub Pages serves LFS pointers instead of files. Push with the CLI, not the web uploader, which caps at 100 files.

**CDN** (recommended, spec §15): upload `assets/frames/` to a bunny.net storage zone and point `data-frames-base` on `#flythrough` at the pull zone. Turn on CORS (Pull Zone → Headers). The page `fetch()`es `manifest.json` cross-origin, which needs `Access-Control-Allow-Origin`. The frames themselves are drawn without `crossOrigin`, so a missing header only taints the canvas; it won't break drawing. Posters stay local, because they are the page's first paint.

**WordPress** (if that is what's live — confirm first, spec §13):
1. In a child theme, add `page-flythrough.php` and paste `functions-snippet.php` into `functions.php`.
2. Copy `css/site.css`, `css/flythrough.css`, `js/flythrough.js` and `assets/poster-*` into `<child-theme>/flythrough/`.
3. Set `THREESTAR_FRAMES_BASE` to the CDN URL, or copy `assets/frames/` to `<child-theme>/flythrough/frames/`.
4. Create a page and choose the template **Factory Flythrough**. Do not use a page builder on it.

Beat copy lives in the PHP arrays at the top of the template. `null` means "not supplied yet" and renders as `TBC`.

## Before launch

```bash
scripts/check-launch.sh          # --strict also fails on unsigned-off draft copy
```

It fails while any `data-placeholder` remains, and on PHP `null` values, test-frame or missing manifests, missing posters or tour video, and `._*` sidecars. Copy written to fit the layout carries `data-draft`. It is not invented data, but the client should sign it off.

Still needed from the client (spec §14): real machine names and 2–3 figures per beat, the stats band figures, an SVG logo, the brand hex, products (names, photos, URLs), the full 2:23 tour video, and contact details. The products page sectors follow the akhtarigroup.com/products structure, and its product types are layout examples only.

Device QA is still to do (spec §18): a real iPhone, a mid-range Android, and Safari < 16.4 on the WebP path. Use `?debug` to watch fps and loading.

## How the scrubber works

- **Timeline** (`TIMELINE` in `js/flythrough.js`) is authored in source-frame space (0–778). `adv` spans move the camera; `hold` spans freeze a frame so a beat can be read. Holds are what let a 2.5-second segment carry a full beat. The total is 8,810 px. Hold frames must match `HOLD_FRAMES` in `encode-frames.sh`, and the page logs an error if the manifest disagrees.
- **Frame lookup**: scroll px → source frame → `floor(src / step)`. When the timeline is inside a hold, the page swaps in that hold's 3072 px still once it has decoded.
- **Performance** (spec §9):
  - One `getBoundingClientRect()` per passive scroll event, and draws only in `requestAnimationFrame`.
  - The loop skips redundant draws and idles when settled.
  - Scroll easing is frame-rate independent (0.22 per 60 Hz frame).
  - `img.decode()` runs 24 frames ahead.
  - Frames are `Image` elements, not `ImageBitmap`, which matters for iOS memory.
  - Loading uses a pool of 8, playhead first, then coarse-to-fine, so a fast scrub always finds a stand-in within ±40 frames.
  - The canvas is capped at 2× DPR and redrawn right after every resize.
  - If AVIF passes the probe but frames fail to decode, the page switches to WebP.
- **Layouts**: `html.ft-on` is added before first paint unless reduced motion is on. Without it (no JS, reduced motion, missing frames) the page is a normal stacked page: poster, hero, five beats, rest of the page.
- **Section height** is `totalPx + stage height`. The stage is `100svh`; using its height instead of `innerHeight` keeps the pinned travel exactly 8,810 px while mobile URL bars come and go.

## Differences from the spec

- **The spec's AVIF commands (§6) don't produce a usable sequence.** Without `-f`, ffmpeg writes one animated file literally named `f_%04d.avif`. With `-f image2` alone, each file's `av1C` box is empty: ffmpeg reads the files back, but Chrome won't decode them. The script uses `-flags +global_header -f image2` and checks every output. `-vsync 0` is also replaced by `-fps_mode passthrough`.
- **The spec says the CDN needs CORS for `drawImage` (§15).** It is actually needed for the manifest `fetch()`. Drawing without CORS works but taints the canvas, which only matters for `getImageData`/`toDataURL`. Turning CORS on is still required.
