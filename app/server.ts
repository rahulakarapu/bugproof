/**
 * Static server for the demo storefront.
 *
 * Reads BUGPROOF_BUGS to decide which seeded defects are armed and injects the
 * list into index.html so the client behaves accordingly.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertKnownBugs, parseArmedBugs, SEEDED_BUGS } from '../src/core/bugs.ts';

const PUBLIC_DIR = resolve(fileURLToPath(new URL('./public', import.meta.url)));
const PORT = Number(process.env.PORT ?? 3100);

const armedBugs = parseArmedBugs(process.env.BUGPROOF_BUGS);
assertKnownBugs(armedBugs);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/** Resolve a URL path to a file inside PUBLIC_DIR, or null if it escapes the root. */
function resolvePublicPath(urlPath: string): string | null {
  const relative = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  const candidate = join(PUBLIC_DIR, relative === '/' ? 'index.html' : relative);
  if (!candidate.startsWith(PUBLIC_DIR)) return null;
  return candidate;
}

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname;

  if (urlPath === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, armedBugs }));
    return;
  }

  if (urlPath === '/api/bugs') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ armed: armedBugs, available: SEEDED_BUGS }, null, 2));
    return;
  }

  const filePath = resolvePublicPath(urlPath);
  if (!filePath) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    let body: string | Buffer = await readFile(filePath);
    const ext = extname(filePath) || '.html';

    if (ext === '.html') {
      body = body.toString('utf8').replaceAll('"%%BUGPROOF_ARMED%%"', JSON.stringify(armedBugs));
    }

    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
});

server.listen(PORT, () => {
  const label = armedBugs.length > 0 ? armedBugs.join(', ') : 'none (all defects disarmed)';
  console.log(`demo storefront on http://localhost:${PORT}  |  armed bugs: ${label}`);
});
