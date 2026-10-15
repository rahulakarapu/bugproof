import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Walk up from this file to the directory holding package.json. */
function findRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd());
}

export const ROOT = findRoot();

export const paths = {
  root: ROOT,
  state: join(ROOT, '.bugproof'),
  tickets: join(ROOT, '.bugproof', 'tickets'),
  runs: join(ROOT, '.bugproof', 'runs'),
  evidence: join(ROOT, '.bugproof', 'evidence'),
  tmp: join(ROOT, '.bugproof', 'tmp'),
  fixtures: join(ROOT, 'tickets'),
  specs: join(ROOT, 'tests', 'regression'),

  ticketFile: (id: string) => join(ROOT, '.bugproof', 'tickets', `${id}.json`),
  runFile: (id: string) => join(ROOT, '.bugproof', 'runs', `${id}.json`),
  evidenceDir: (id: string, phase: string) => join(ROOT, '.bugproof', 'evidence', id, phase),
  specFile: (id: string) => join(ROOT, 'tests', 'regression', `${id}.spec.ts`),
};

export async function ensureDir(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Display a path relative to the repo root so logs stay readable. */
export function relative(path: string): string {
  return path.startsWith(ROOT) ? path.slice(ROOT.length + 1) : path;
}
