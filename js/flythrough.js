/*
 * Threestar flythrough — scroll-driven image-sequence scrubber.
 *
 * Frames are numbered images drawn to <canvas>. A <video> with currentTime is not
 * used: seeking stutters on Android Chrome (spec §1). The timeline is authored in
 * source-frame space (0–778) so the desktop set (every 2nd or 3rd frame) and the
 * mobile set (every 3rd) share one configuration (spec §8).
 *
 * Markup contract (index.html / wordpress/page-flythrough.php):
 *   #flythrough[data-frames-base]   pinned section; base URL of manifest.json + frames
 *     #ft-stage                     sticky 100svh stage (scrims are its ::before/::after)
 *       #ft-canvas
 *       .ft-hero                    visible at the start
 *       .ft-beat × 5                mapped to hold spans in document order
 *       .ft-cue, .ft-loader
 *
 * <html> classes: `ft-on` is added by an inline head script when JS runs and the user
 * has not asked for reduced motion. This script removes it again if the manifest
 * cannot be loaded, which drops the page back to the static stacked layout.
 *
 * URL overrides for QA: ?debug (overlay), ?format=webp|avif, ?set=desktop|mobile,
 * ?frames=<same-origin relative path>.
 */
(function () {
  'use strict';

  // ── Timeline (spec §8). Tuned by testing — preserve unless deliberately retuning. ──
  var SRC_FRAMES = 779;

  var TIMELINE = [
    { type: 'adv',  from: 0,   to: 120, px: 900 },  // aerial approach
    { type: 'adv',  from: 120, to: 160, px: 260 },  // entrance + strip-curtain wipe (cut 1 @145)
    { type: 'adv',  from: 160, to: 230, px: 520 },  // interior reveal
    { type: 'hold', at: 230, px: 600, beat: 0 },
    { type: 'adv',  from: 230, to: 300, px: 520 },  // cut 2 @295
    { type: 'adv',  from: 300, to: 380, px: 600 },
    { type: 'hold', at: 380, px: 600, beat: 1 },
    { type: 'adv',  from: 380, to: 440, px: 450 },  // cut 3 @433
    { type: 'adv',  from: 440, to: 475, px: 280 },
    { type: 'hold', at: 475, px: 600, beat: 2 },
    { type: 'adv',  from: 475, to: 515, px: 300 },  // cut 4 @509
    { type: 'adv',  from: 515, to: 580, px: 490 },
    { type: 'hold', at: 580, px: 600, beat: 3 },
    { type: 'adv',  from: 580, to: 660, px: 600 },
    { type: 'hold', at: 660, px: 600, beat: 4 },
    { type: 'adv',  from: 660, to: SRC_FRAMES - 1, px: 890 }  // aerial exit
  ];

  var LEAD = 260;             // beat fade-in before its hold
  var TRAIL = 260;            // beat fade-out after its hold
  var HERO_FADE = 520;        // hero text fades over the first N px
  var EASE = 0.22;            // per 60 Hz frame; wheel steps arrive in ~100 px jumps
  var DPR_CAP = 2;            // beyond 2× the cost is real and the gain is not
  var POOL = 8;               // concurrent image requests
  var READY_FRAMES = 30;      // reveal once this many frames around the playhead exist
  var DECODE_AHEAD = 24;      // img.decode() this many frames ahead of the playhead
  var DECODE_KEEP = 60;       // forget decode requests further than this (surfaces get evicted)
  var NEIGHBOUR = 40;         // search radius for a stand-in when a frame isn't loaded
  var HOLD_PREP = 700;        // px before a hold at which its hi-res still is decoded

  var AVIF_PROBE = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAATAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAACAAAAAgAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAbbWRhdAoFGAA2wCAyChyAAABYAABABMA=';

  // ── Spans with absolute px ranges ─────────────────────────────────────────────
  var spans = [];
  var totalPx = 0;
  TIMELINE.forEach(function (s) {
    var span = Object.assign({ start: totalPx, end: totalPx + s.px }, s);
    spans.push(span);
    totalPx += s.px;
  });
  var holdSpans = spans.filter(function (s) { return s.type === 'hold'; });
  var beatSpans = [];   // beat index → its hold span
  holdSpans.forEach(function (s) { beatSpans[s.beat] = s; });

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Source frame (fractional) shown at a given scroll offset into the pinned section.
  function srcFrameAt(px) {
    for (var i = 0; i < spans.length; i++) {
      var s = spans[i];
      if (px < s.end) {
        if (s.type === 'hold') return s.at;
        var t = clamp((px - s.start) / s.px, 0, 1);
        return s.from + (s.to - s.from) * t;
      }
    }
    var last = spans[spans.length - 1];
    return last.type === 'hold' ? last.at : last.to;
  }

  function holdAt(px) {
    for (var i = 0; i < holdSpans.length; i++) {
      if (px >= holdSpans[i].start && px < holdSpans[i].end) return i;
    }
    return -1;
  }

  // 0 → 1 over LEAD before the hold, 1 through it, 1 → 0 over TRAIL after.
  function beatOpacity(span, px) {
    if (px < span.start - LEAD || px > span.end + TRAIL) return 0;
    if (px < span.start) return (px - (span.start - LEAD)) / LEAD;
    if (px > span.end) return 1 - (px - span.end) / TRAIL;
    return 1;
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  // Skip sub-perceptual style writes, but always land exactly on 0 and 1.
  function changed(v, last) {
    return v !== last && (Math.abs(v - last) > 0.004 || v === 0 || v === 1);
  }

  // ── Environment ───────────────────────────────────────────────────────────────
  var root = document.documentElement;
  var section = document.getElementById('flythrough');
  if (!section) return;
  var stage = document.getElementById('ft-stage');
  var canvas = document.getElementById('ft-canvas');
  var ctx = canvas.getContext('2d', { alpha: false });
  var hero = section.querySelector('.ft-hero');
  var cue = section.querySelector('.ft-cue');
  var loader = section.querySelector('.ft-loader');
  var loaderBar = section.querySelector('.ft-loader__bar');
  var beats = Array.prototype.slice.call(section.querySelectorAll('.ft-beat'));

  var params = new URLSearchParams(location.search);
  var DEBUG = params.has('debug');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function framesBase() {
    var override = params.get('frames');
    // Same-origin relative paths only — this is a QA switch, not an open loader.
    if (override && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(override)) return withSlash(override);
    return withSlash(section.getAttribute('data-frames-base') || 'assets/frames/');
  }
  function withSlash(s) { return s.charAt(s.length - 1) === '/' ? s : s + '/'; }

  function pad(n, width) { var s = String(n); while (s.length < width) s = '0' + s; return s; }
  // "desktop/f_%04d.avif", 7 → "desktop/f_0007.avif"
  function fill(pattern, n) {
    return pattern.replace(/%0(\d)d/, function (_, w) { return pad(n, +w); });
  }

  function supportsAvif() {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img.naturalWidth > 0); };
      img.onerror = function () { resolve(false); };
      img.src = AVIF_PROBE;
    });
  }

  function wantedSet(manifest) {
    var forced = params.get('set');
    if (forced && manifest.sets[forced]) return forced;
    // Portrait viewports use the portrait-framed set; matches the CSS breakpoint.
    var portrait = window.matchMedia('(max-aspect-ratio: 1/1)').matches;
    return portrait && manifest.sets.mobile ? 'mobile' : 'desktop';
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  var manifest = null;
  var base = '';
  var format = 'avif';
  var setName = '';
  var set = null;
  var frames = [];      // Image elements — never ImageBitmap (spec §9: iOS memory)
  var status = [];      // 0 idle, 1 loading, 2 loaded, 3 failed
  var decodeReq = [];
  var loadedCount = 0, failedCount = 0, active = 0;
  var fineOrder = [];   // coarse-to-fine load order, so fast scrubs always find a neighbour
  var finePtr = 0;
  var holds = [];       // { img, loaded, decoded, requested }
  var generation = 0;   // bumps when the set/format changes; stale callbacks bail

  var targetPx = 0, shownPx = 0;
  var lastKey = null, lastIdx = -1, dir = 1;
  var revealed = false, drawnOnce = false;
  var rafId = 0, lastTs = 0;
  var cssW = 0, cssH = 0;
  var lastHeroO = -1, lastCueO = -1, lastScrim = -1;
  var beatO = beats.map(function () { return -1; });
  var debugEl = null, fpsFrames = 0, fpsT = 0, fps = 0;

  // ── Loading ───────────────────────────────────────────────────────────────────
  function frameUrl(i) { return base + fill(set[format], i + 1); }

  function useSet(name, fmt) {
    generation++;
    setName = name;
    format = fmt;
    set = manifest.sets[name];
    frames = new Array(set.count);
    status = new Array(set.count);
    decodeReq = new Array(set.count);
    for (var i = 0; i < set.count; i++) { status[i] = 0; decodeReq[i] = false; }
    loadedCount = failedCount = active = 0;
    lastKey = null;
    lastIdx = -1;

    fineOrder = [];
    var seen = new Uint8Array(set.count);
    [16, 8, 4, 2, 1].forEach(function (stride) {
      for (var j = 0; j < set.count; j += stride) {
        if (!seen[j]) { seen[j] = 1; fineOrder.push(j); }
      }
    });
    finePtr = 0;

    holds = holdSpans.map(function () { return { img: null, loaded: false, decoded: false, requested: false, pending: false }; });
    if (set.count > 600) {
      // Spec §9: beyond ~600 frames switch to a sliding window of ImageBitmaps.
      console.warn('[flythrough] ' + set.count + ' frames: consider a sliding ImageBitmap window');
    }
    root.classList.toggle('ft-set-mobile', name === 'mobile');
    pump();
  }

  function currentIdx() {
    return indexFor(srcFrameAt(shownPx));
  }
  function indexFor(src) {
    return clamp(Math.floor(src / set.step), 0, set.count - 1);
  }

  // Frames just ahead of (and a little behind) the playhead first, then coarse-to-fine.
  function pickNext() {
    var c = indexFor(srcFrameAt(targetPx));
    for (var k = 0; k <= 30; k++) {
      var a = c + dir * k;
      if (a >= 0 && a < set.count && status[a] === 0) return a;
      if (k <= 10) {
        var b = c - dir * k;
        if (b >= 0 && b < set.count && status[b] === 0) return b;
      }
    }
    while (finePtr < fineOrder.length && status[fineOrder[finePtr]] !== 0) finePtr++;
    return finePtr < fineOrder.length ? fineOrder[finePtr] : -1;
  }

  function pump() {
    while (active < POOL) {
      var i = pickNext();
      if (i < 0) break;
      load(i);
    }
    if (revealed) loadHolds();
  }

  function load(i) {
    var gen = generation;
    var img = new Image();
    img.decoding = 'async';
    status[i] = 1;
    active++;
    img.onload = function () {
      if (gen !== generation) return;
      active--;
      frames[i] = img;
      status[i] = 2;
      loadedCount++;
      afterLoad();
    };
    img.onerror = function () {
      if (gen !== generation) return;
      active--;
      status[i] = 3;
      failedCount++;
      // AVIF passed the probe but real frames fail (e.g. a partial decoder): fall back.
      if (format === 'avif' && loadedCount === 0 && failedCount >= 3 && set.webp) {
        console.warn('[flythrough] AVIF frames failing, switching to WebP');
        useSet(setName, 'webp');
        return;
      }
      afterLoad();
    };
    img.src = frameUrl(i);
    frames[i] = img;
  }

  function afterLoad() {
    if (!revealed) {
      var need = Math.min(READY_FRAMES, set.count);
      if (loaderBar) loaderBar.style.transform = 'scaleX(' + Math.min(1, loadedCount / need) + ')';
      if (loadedCount >= need) reveal();
    }
    kick();
    pump();
  }

  function reveal() {
    revealed = true;
    root.classList.add('ft-ready');
    if (loader) loader.setAttribute('aria-hidden', 'true');
  }

  // Five hi-res stills (spec §6), swapped in while the timeline sits inside a hold.
  function loadHolds() {
    if (!set.holds || !set.holds[format]) return;
    holds.forEach(function (h, k) {
      if (h.img) return;
      var gen = generation;
      h.img = new Image();
      h.img.decoding = 'async';
      h.img.onload = function () { if (gen === generation) { h.loaded = true; kick(); } };
      h.img.src = base + fill(set.holds[format], k + 1);
    });
  }

  function prepareHold(k) {
    var h = holds[k];
    if (!h || !h.loaded || h.requested) return;
    h.requested = true;
    if (h.pending) return;   // a decode is already in flight; overlapping calls can reject
    h.pending = true;
    var gen = generation;
    function done() {
      h.pending = false;
      if (gen !== generation || !h.requested) return;
      h.decoded = true;
      kick();
    }
    // Chrome sometimes rejects decode() on large stills ("cannot be decoded") even
    // though they draw fine. A loaded still is still usable: drawing it decodes
    // synchronously, and the camera is stationary during a hold anyway.
    h.img.decode().then(done, done);
  }

  // The single biggest anti-stutter measure: decode ahead of the playhead.
  function decodeAround(idx) {
    for (var k = 1; k <= DECODE_AHEAD; k++) {
      var j = idx + dir * k;
      if (j < 0 || j >= set.count) break;
      if (status[j] === 2 && !decodeReq[j]) {
        decodeReq[j] = true;
        frames[j].decode().catch(noop);
      }
    }
    // Decoded surfaces of far frames may be evicted; allow re-requesting them later.
    var lo = idx - DECODE_KEEP, hi = idx + DECODE_KEEP;
    for (var i = 0; i < set.count; i++) {
      if (decodeReq[i] && (i < lo || i > hi)) decodeReq[i] = false;
    }
  }

  function noop() {}

  function nearestLoaded(idx) {
    if (status[idx] === 2) return idx;
    for (var k = 1; k <= NEIGHBOUR; k++) {
      // Prefer the side we came from: it matches what the user just saw.
      var a = idx - dir * k, b = idx + dir * k;
      if (a >= 0 && a < set.count && status[a] === 2) return a;
      if (b >= 0 && b < set.count && status[b] === 2) return b;
    }
    return -1;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────────
  function sizeCanvas() {
    var dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    cssW = stage.clientWidth;
    cssH = stage.clientHeight;
    var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;       // clears the canvas…
      canvas.height = h;
      lastKey = null;         // …so the next render must redraw
    }
  }

  function drawCover(img) {
    var cw = canvas.width, ch = canvas.height;
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var scale = Math.max(cw / iw, ch / ih);
    var dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
  }

  function render() {
    if (!set) return;
    var src = srcFrameAt(shownPx);
    var idx = indexFor(src);
    if (idx !== lastIdx) {
      if (lastIdx >= 0) dir = idx >= lastIdx ? 1 : -1;
      lastIdx = idx;
      decodeAround(idx);
    }

    // Decode the next hold's still before we arrive.
    for (var k = 0; k < holdSpans.length; k++) {
      var s = holdSpans[k];
      if (shownPx > s.start - HOLD_PREP && shownPx < s.end + LEAD) prepareHold(k);
      else if (holds[k]) holds[k].requested = holds[k].decoded = false;
    }

    var img = null, key = null;
    var h = holdAt(shownPx);
    if (h >= 0 && holds[h] && holds[h].decoded) {
      img = holds[h].img;
      key = 'h' + h;
    } else {
      var n = nearestLoaded(idx);
      if (n >= 0) { img = frames[n]; key = n; }
    }
    if (img && key !== lastKey) {
      drawCover(img);
      lastKey = key;
      if (!drawnOnce) { drawnOnce = true; root.classList.add('ft-drawn'); }
    }
  }

  function updateOverlays() {
    var heroO = clamp(1 - shownPx / HERO_FADE, 0, 1);
    if (changed(heroO, lastHeroO)) {
      lastHeroO = heroO;
      hero.style.opacity = heroO.toFixed(3);
      hero.style.transform = 'translate3d(0,' + (-40 * (1 - heroO)).toFixed(1) + 'px,0)';
    }
    var cueO = clamp(1 - shownPx / 160, 0, 1);
    if (cue && changed(cueO, lastCueO)) {
      lastCueO = cueO;
      cue.style.opacity = cueO.toFixed(3);
    }

    var strongest = heroO;
    for (var i = 0; i < beats.length; i++) {
      var o = beatSpans[i] ? smooth(beatOpacity(beatSpans[i], shownPx)) : 0;
      if (o > strongest) strongest = o;
      if (changed(o, beatO[i])) {
        beatO[i] = o;
        var el = beats[i];
        el.style.opacity = o.toFixed(3);
        el.style.transform = 'translate3d(0,' + (24 * (1 - o)).toFixed(1) + 'px,0)';
        el.classList.toggle('is-active', o > 0.5);
      }
    }
    // Scrims are strongest when there is text to read and ease off during travel.
    var scrim = 0.45 + 0.55 * strongest;
    if (Math.abs(scrim - lastScrim) > 0.01) {
      lastScrim = scrim;
      stage.style.setProperty('--ft-scrim', scrim.toFixed(2));
    }
  }

  // ── Loop ──────────────────────────────────────────────────────────────────────
  function frame(ts) {
    rafId = 0;
    var dt = lastTs ? Math.min(ts - lastTs, 100) : 16.7;
    lastTs = ts;

    var diff = targetPx - shownPx;
    if (Math.abs(diff) < 0.5) {
      shownPx = targetPx;
    } else {
      // Frame-rate independent: same feel at 60 Hz and 120 Hz.
      shownPx += diff * (1 - Math.pow(1 - EASE, dt / 16.7));
    }

    render();
    updateOverlays();
    if (DEBUG) updateDebug(ts);

    // Idle when settled; scroll events, frame loads and hold decodes kick it again.
    if (shownPx !== targetPx) rafId = requestAnimationFrame(frame);
    else lastTs = 0;
  }

  function kick() {
    if (!rafId && set) rafId = requestAnimationFrame(frame);
  }

  function onScroll() {
    // One layout read per scroll event; nothing is read inside the draw loop.
    var r = section.getBoundingClientRect();
    targetPx = clamp(-r.top, 0, totalPx);
    kick();
  }

  var setSwitchTimer = 0;
  function onResize() {
    // The sticky stage pins for (section height − stage height). Using the stage's
    // own height (100svh) rather than innerHeight keeps that exactly totalPx, even
    // while mobile browser chrome shows and hides.
    section.style.height = (totalPx + stage.clientHeight) + 'px';
    sizeCanvas();
    onScroll();
    // Canvas resize cleared the bitmap: redraw now, not next frame.
    render();

    clearTimeout(setSwitchTimer);
    setSwitchTimer = setTimeout(function () {
      if (!manifest) return;
      var want = wantedSet(manifest);
      if (want !== setName) useSet(want, format === 'webp' || !manifest.sets[want][format] ? 'webp' : format);
    }, 300);
  }

  // ── Debug overlay (?debug) — for device QA ────────────────────────────────────
  function updateDebug(ts) {
    fpsFrames++;
    if (ts - fpsT > 500) { fps = Math.round(fpsFrames * 1000 / (ts - fpsT)); fpsFrames = 0; fpsT = ts; }
    if (!debugEl) {
      debugEl = document.createElement('pre');
      debugEl.className = 'ft-debug';
      stage.appendChild(debugEl);
    }
    var src = srcFrameAt(shownPx);
    debugEl.textContent =
      'set   ' + setName + ' ' + format + ' step ' + set.step + '\n' +
      'px    ' + Math.round(shownPx) + ' / ' + totalPx + '\n' +
      'src   ' + src.toFixed(1) + '  idx ' + indexFor(src) + '  drawn ' + lastKey + '\n' +
      'load  ' + loadedCount + '/' + set.count + (failedCount ? '  failed ' + failedCount : '') + '\n' +
      'dpr   ' + Math.min(window.devicePixelRatio || 1, DPR_CAP) + '  canvas ' + canvas.width + '×' + canvas.height + '\n' +
      'fps   ' + fps;
  }

  // ── Boot / teardown ───────────────────────────────────────────────────────────
  function fallBack(reason) {
    if (reason) console.warn('[flythrough] static layout:', reason);
    teardown();
  }

  function teardown() {
    generation++;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    set = null;
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    root.classList.remove('ft-on', 'ft-ready', 'ft-drawn', 'ft-set-mobile');
    section.style.height = '';
    [hero, cue].concat(beats).forEach(function (el) {
      if (!el) return;
      el.style.opacity = el.style.transform = '';
      el.classList.remove('is-active');
    });
    if (debugEl) { debugEl.remove(); debugEl = null; }
  }

  function checkManifest(m) {
    if (!m || !m.sets || !m.sets.desktop) throw new Error('manifest has no desktop set');
    if (m.srcFrames !== SRC_FRAMES) {
      // Spec §5: anything but 779 frames puts every beat on the wrong machine.
      console.error('[flythrough] manifest srcFrames ' + m.srcFrames + ' ≠ ' + SRC_FRAMES + ' — beats will not line up');
    }
    var holdsHere = holdSpans.map(function (s) { return s.at; }).join(',');
    if (m.holdFrames && m.holdFrames.join(',') !== holdsHere) {
      console.error('[flythrough] manifest hold stills ' + m.holdFrames + ' ≠ TIMELINE holds ' + holdsHere);
    }
    if (m.placeholder) root.classList.add('ft-test-frames');
  }

  function boot() {
    if (!root.classList.contains('ft-on')) return;
    base = framesBase();

    Promise.all([
      fetch(base + 'manifest.json', { credentials: 'same-origin' }).then(function (r) {
        if (!r.ok) throw new Error('manifest ' + r.status);
        return r.json();
      }),
      supportsAvif()
    ]).then(function (res) {
      if (!root.classList.contains('ft-on')) return;
      manifest = res[0];
      checkManifest(manifest);
      var name = wantedSet(manifest);
      var fmt = res[1] ? 'avif' : 'webp';
      if (params.get('format') === 'webp' || params.get('format') === 'avif') fmt = params.get('format');
      if (!manifest.sets[name][fmt]) fmt = fmt === 'avif' ? 'webp' : 'avif';
      if (!manifest.sets[name][fmt]) throw new Error('no usable frame format');

      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      onResize();
      shownPx = targetPx;   // arriving mid-page (reload, back button): don't ease from 0
      useSet(name, fmt);
      kick();
    }).catch(fallBack);
  }

  function onMotionPref() {
    if (reducedMotion.matches) {
      fallBack('prefers-reduced-motion');
    } else if (!root.classList.contains('ft-on')) {
      root.classList.add('ft-on');
      boot();
    }
  }
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionPref);

  // Read-only snapshot for automated tests and device QA.
  window.__flythrough = {
    totalPx: totalPx,
    spans: spans,
    srcFrameAt: srcFrameAt,
    state: function () {
      return {
        set: setName, format: format, step: set && set.step, count: set && set.count,
        targetPx: targetPx, shownPx: shownPx, src: srcFrameAt(shownPx),
        idx: set ? indexFor(srcFrameAt(shownPx)) : -1, drawn: lastKey,
        loaded: loadedCount, failed: failedCount, revealed: revealed,
        canvas: [canvas.width, canvas.height],
        beats: beatO.slice()
      };
    }
  };

  boot();
})();
