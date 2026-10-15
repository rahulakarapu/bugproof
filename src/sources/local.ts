import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { parseReproPlan, slugify } from '../core/ticket.ts';
import type { Ticket } from '../core/types.ts';
import { paths } from '../util/paths.ts';
import type { TicketSource } from './types.ts';

/**
 * Markdown bug reports kept in `tickets/`.
 *
 * Useful for offline demos and for the seeded defects that ship with the repo,
 * and it keeps the whole pipeline runnable without network access.
 */
export class LocalTicketSource implements TicketSource {
  readonly name = 'local';

  handles(ref: string): boolean {
    return this.resolveFile(ref) !== null;
  }

  private resolveFile(ref: string): string | null {
    const trimmed = ref.trim();
    if (!trimmed) return null;

    const candidates = [
      isAbsolute(trimmed) ? trimmed : resolve(paths.root, trimmed),
      join(paths.fixtures, trimmed),
      join(paths.fixtures, `${trimmed}.md`),
    ];

    return candidates.find((candidate) => existsSync(candidate) && extname(candidate) === '.md') ?? null;
  }

  async fetch(ref: string): Promise<Ticket> {
    const file = this.resolveFile(ref);
    if (!file) {
      throw new Error(
        `No local ticket found for "${ref}". Looked in ${paths.fixtures} for ${ref}.md.`,
      );
    }

    const content = await readFile(file, 'utf8');
    const heading = content.match(/^\s*#\s+(.+?)\s*$/m);
    const title = heading?.[1]?.trim() ?? basename(file, '.md');
    // The H1 is the title, not part of the repro description.
    const body = heading ? content.replace(heading[0], '').trim() : content.trim();

    return {
      id: slugify(basename(file, '.md')),
      source: this.name,
      ref: trimmed(ref),
      url: null,
      title,
      labels: [],
      repro: parseReproPlan(body, []),
      fetchedAt: new Date().toISOString(),
    };
  }
}

function trimmed(ref: string): string {
  return ref.trim();
}
