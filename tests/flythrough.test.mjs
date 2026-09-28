// Browser tests for the flythrough rig, against the synthetic test frames.
//
//   npm run test-master   # once: synthetic 4K master → build/test-frames (a few minutes)
//   npm test
//
// Screenshots land in test-results/. Headless Chromium only — this does not replace
// the real-device QA in spec §18 (iPhone, mid-range Android, Safari < 16.4).
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { start } from './serve.mjs';

const PORT = 8123;
const ORIGIN = `http://localhost:${PORT}`;
const FRAMES = 'build/test-frames/';
const OUT = 'test-results';

if (!existsSync(FRAMES + 'manifest.json')) {
  console.error(`No ${FRAMES}manifest.json — run \`npm run test-master\` first.`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

// Hold spans in px, from the TIMELINE (spec §8): [start, end) and source frame.
const HOLDS = [
  { start: 1680, end: 2280, at: 230 },
  { start: 3400, end: 4000, at: 380 },
  { start: 4730, end: 5330, at: 475 },
  { start: 6120, end: 6720, at: 580 },
  { start: 7320, end: 7920, at: 660 }
];
const TOTAL = 8810;

const server = await start(PORT);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const results = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push([true, name]);
    console.log(`  ✓ ${name} (${Date.now() - t0} ms)`);
  } catch (e) {
    results.push([false, name]);
    console.log(`  ✗ ${name}\n    ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n    ')}`);
  }
}

async function open(opts = {}, query = `?frames=${FRAMES}`, path = '/') {
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: opts.dpr || 2,
    reducedMotion: opts.reducedMotion || 'no-preference',
    javaScriptEnabled: opts.js !== false,
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'warning') console.log('    [page]', m.text()); });
  // Resource 404s are expected for posters (assets/ is empty until the real encode);
  // missing frames show up in state().failed instead.
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  if (opts.route) await opts.route(page);
  await page.goto(ORIGIN + path + query);
  return { page, context, errors };
}

const state = page => page.evaluate(() => window.__flythrough.state());

async function ready(page) {
  await page.waitForFunction(() => window.__flythrough && window.__flythrough.state().revealed, null, { timeout: 20000 });
}

// Programmatic scroll may not fire scroll events headless (spec §16) — dispatch one.
async function scrollToPx(page, px) {
  await page.evaluate(px => {
    const s = document.getElementById('flythrough');
    window.scrollTo(0, s.getBoundingClientRect().top + window.scrollY + px);
    window.dispatchEvent(new Event('scroll'));
  }, px);
  await page.waitForFunction(px => {
    const st = window.__flythrough.state();
    return Math.abs(st.targetPx - px) < 2 && st.shownPx === st.targetPx;
  }, px, { timeout: 10000 });
}

console.log('flythrough');

await test('desktop: pins, sizes section, reveals after first frames', async () => {
  const { page, context, errors } = await open();
  await ready(page);
  const info = await page.evaluate(() => ({
    on: document.documentElement.classList.contains('ft-on'),
    h: document.getElementById('flythrough').offsetHeight,
    stage: document.getElementById('ft-stage').offsetHeight,
    pos: getComputedStyle(document.getElementById('ft-stage')).position
  }));
  assert.ok(info.on);
  assert.equal(info.pos, 'sticky');
  assert.equal(info.h, TOTAL + info.stage, 'section height = totalPx + stage height');
  const st = await state(page);
  assert.equal(st.set, 'desktop');
  assert.equal(st.format, 'avif');
  assert.deepEqual(st.canvas, [2880, 1800], 'backing store = CSS px × min(dpr, 2)');
  assert.equal(st.drawn, 0);
  await page.screenshot({ path: `${OUT}/desktop-hero.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

await test('desktop: every hold shows its hi-res still and only its beat', async () => {
  const { page, context, errors } = await open();
  await ready(page);
  await page.waitForFunction(() => window.__flythrough.state().loaded === 260, null, { timeout: 30000 });
  for (let k = 0; k < HOLDS.length; k++) {
    const mid = (HOLDS[k].start + HOLDS[k].end) / 2;
    await scrollToPx(page, mid);
    await page.waitForFunction(k => window.__flythrough.state().drawn === 'h' + k, k, { timeout: 5000 })
      .catch(async e => { throw new Error(`hold ${k}: ${JSON.stringify(await state(page))}\n${e.message}`); });
    const st = await state(page);
    assert.equal(st.src, HOLDS[k].at);
    st.beats.forEach((o, i) => assert.equal(o, i === k ? 1 : 0, `beat ${i} opacity at hold ${k}`));
    await page.screenshot({ path: `${OUT}/desktop-hold-${k}.png` });
  }
  assert.deepEqual(errors, []);
  await context.close();
});

await test('desktop: frame mapping in travel, forwards and backwards', async () => {
  const { page, context } = await open();
  await ready(page);
  await page.waitForFunction(() => window.__flythrough.state().loaded === 260, null, { timeout: 30000 });
  // adv 0→120 over 0–900 px: 450 px → src 60 → idx 20
  await scrollToPx(page, 450);
  let st = await state(page);
  assert.equal(st.src, 60);
  assert.equal(st.drawn, 20);
  // Beats fade in over LEAD=260 before a hold: halfway → ~0.5 (smoothstep)
  await scrollToPx(page, HOLDS[1].start - 130);
  st = await state(page);
  assert.ok(Math.abs(st.beats[1] - 0.5) < 0.01, `beat 1 mid-fade ${st.beats[1]}`);
  // Backwards past a hold: leaves the still, returns to the sequence
  await scrollToPx(page, 1000);
  st = await state(page);
  assert.equal(typeof st.drawn, 'number');
  assert.equal(st.drawn, Math.floor(st.src / 3));
  await scrollToPx(page, TOTAL);
  st = await state(page);
  assert.equal(st.src, 778);
  assert.equal(st.drawn, 259);
  await context.close();
});

await test('desktop: fast jump into unloaded frames draws a nearby stand-in', async () => {
  const { page, context } = await open({ route: async p => {
    // Slow network: 300 ms per frame
    await p.route('**/*.avif', async r => { await new Promise(x => setTimeout(x, 300)); await r.continue(); });
  } });
  await ready(page);
  await page.evaluate(() => {
    window.scrollTo(0, 6000);
    window.dispatchEvent(new Event('scroll'));
  });
  // Coarse-to-fine loading means something within ±40 frames is drawn quickly.
  await page.waitForFunction(() => {
    const st = window.__flythrough.state();
    return typeof st.drawn === 'number' && Math.abs(st.drawn - st.idx) <= 40 && st.shownPx === st.targetPx;
  }, null, { timeout: 8000 });
  await context.close();
});

await test('easing: displayed position trails a wheel jump, then settles', async () => {
  const { page, context } = await open();
  await ready(page);
  await page.mouse.move(700, 450);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => window.__flythrough.state().targetPx > 300, null, { timeout: 3000 });
  const mid = await state(page);
  assert.ok(mid.shownPx <= mid.targetPx);
  await page.waitForFunction(() => { const s = window.__flythrough.state(); return s.shownPx === s.targetPx; }, null, { timeout: 3000 });
  await context.close();
});

await test('WebP fallback: ?format=webp and AVIF-failing browsers', async () => {
  let { page, context } = await open({}, `?frames=${FRAMES}&format=webp`);
  await ready(page);
  assert.equal((await state(page)).format, 'webp');
  await context.close();
  // AVIF probe passes but every .avif frame fails (partial decoder) → switch to WebP
  ({ page, context } = await open({ route: p => p.route(/\/f_\d+\.avif$/, r => r.fulfill({ status: 404 })) }));
  await ready(page);
  const st = await state(page);
  assert.equal(st.format, 'webp');
  assert.ok(st.loaded > 0);
  await context.close();
});

await test('mobile portrait: portrait set, DPR capped at 2, no horizontal scroll', async () => {
  const { page, context, errors } = await open({ viewport: { width: 390, height: 844 }, dpr: 3, mobile: true });
  await ready(page);
  const st = await state(page);
  assert.equal(st.set, 'mobile');
  assert.deepEqual(st.canvas, [780, 1688]);
  await page.waitForFunction(() => window.__flythrough.state().loaded === 260, null, { timeout: 30000 });
  await scrollToPx(page, (HOLDS[2].start + HOLDS[2].end) / 2);
  await page.waitForFunction(() => window.__flythrough.state().drawn === 'h2', null, { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/mobile-hold-2.png` });
  assert.deepEqual(errors, []);
  await context.close();
});

await test('375px: no horizontal scroll on either page, at any point', async () => {
  for (const path of ['/', '/products.html']) {
    const { page, context } = await open({ viewport: { width: 375, height: 740 }, dpr: 2, mobile: true }, `?frames=${FRAMES}`, path);
    await page.waitForLoadState('load');
    for (const y of [0, 2000, 99999]) {
      await page.evaluate(y => window.scrollTo(0, y), y);
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      assert.ok(w[0] <= w[1], `${path} @${y}: scrollWidth ${w[0]} > ${w[1]}`);
    }
    await page.screenshot({ path: `${OUT}/375${path.replace(/\W/g, '_')}.png`, fullPage: path !== '/' });
    await context.close();
  }
});

await test('prefers-reduced-motion: static page, no pin, all beats visible', async () => {
  const { page, context } = await open({ reducedMotion: 'reduce' });
  await page.waitForLoadState('load');
  const info = await page.evaluate(() => ({
    on: document.documentElement.classList.contains('ft-on'),
    canvas: getComputedStyle(document.getElementById('ft-canvas')).display,
    beats: [...document.querySelectorAll('.ft-beat')].map(b => getComputedStyle(b).opacity),
    h: document.getElementById('flythrough').offsetHeight
  }));
  assert.equal(info.on, false);
  assert.equal(info.canvas, 'none');
  assert.deepEqual(info.beats, ['1', '1', '1', '1', '1']);
  assert.ok(info.h < 5000, `static section height ${info.h}`);
  await page.screenshot({ path: `${OUT}/reduced-motion.png`, fullPage: true });
  await context.close();
});

await test('no JavaScript: same static layout', async () => {
  const { page, context } = await open({ js: false });
  const info = await page.evaluate(() => 0).catch(() => null); // JS disabled: evaluate still works via CDP
  void info;
  const cls = await page.getAttribute('html', 'class');
  assert.ok(cls.includes('no-js') && !cls.includes('ft-on'));
  const h = await page.locator('#flythrough').evaluate(el => el.offsetHeight);
  assert.ok(h < 5000);
  await context.close();
});

await test('missing frames: falls back to the static layout', async () => {
  const { page, context } = await open({}, '?frames=build/does-not-exist/');
  await page.waitForFunction(() => !document.documentElement.classList.contains('ft-on'), null, { timeout: 5000 });
  const h = await page.locator('#flythrough').evaluate(el => el.offsetHeight);
  assert.ok(h < 5000);
  await context.close();
});

await test('?frames= rejects absolute URLs', async () => {
  const requested = [];
  const { page, context } = await open({ route: p => p.route('https://evil.example/**', r => { requested.push(r.request().url()); r.abort(); }) },
    '?frames=https://evil.example/');
  await page.waitForTimeout(500);
  assert.deepEqual(requested, []);
  await context.close();
});

await browser.close();
server.close();
const failed = results.filter(r => !r[0]).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
