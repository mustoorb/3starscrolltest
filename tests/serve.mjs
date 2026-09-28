// Minimal static server for local preview and tests. Serves .avif as image/avif
// (many quick servers don't, and browsers then refuse the frames).
//
//   node tests/serve.mjs [port=8080]          → http://localhost:8080/
//   http://localhost:8080/?frames=build/test-frames/&debug   (synthetic frames + overlay)
//
// FRAME_DELAY_MS=120 adds latency to image responses to rehearse slow networks.
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.avif': 'image/avif',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4'
};

export function start(port = 8080, { delay = Number(process.env.FRAME_DELAY_MS || 0) } = {}) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      if (!(await stat(file)).isFile()) throw new Error();
      const ext = extname(file);
      if (delay && (ext === '.avif' || ext === '.webp')) await new Promise(r => setTimeout(r, delay));
      res.writeHead(200, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache'
      });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    }
  });
  return new Promise(ok => server.listen(port, () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 8080);
  await start(port);
  console.log(`http://localhost:${port}/?frames=build/test-frames/&debug`);
}
