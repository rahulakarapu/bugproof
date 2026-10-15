import type { Ticket } from '../core/types.ts';
import { GitHubTicketSource } from './github.ts';
import { LocalTicketSource } from './local.ts';
import type { TicketSource } from './types.ts';

/**
 * Local files are checked first so a fixture named `12.md` wins over issue #12.
 * That keeps offline demos predictable.
 */
export const SOURCES: readonly TicketSource[] = [new LocalTicketSource(), new GitHubTicketSource()];

export function sourceByName(name: string): TicketSource {
  const source = SOURCES.find((s) => s.name === name);
  if (!source) {
    throw new Error(`Unknown ticket source "${name}". Available: ${SOURCES.map((s) => s.name).join(', ')}`);
  }
  return source;
}

/** Pick the first source that recognises the reference. */
export function resolveSource(ref: string, explicit?: string): TicketSource {
  if (explicit) return sourceByName(explicit);

  const source = SOURCES.find((s) => s.handles(ref));
  if (!source) {
    throw new Error(
      `No ticket source recognises "${ref}". Pass a GitHub issue number/URL, or add tickets/${ref}.md.`,
    );
  }
  return source;
}

export async function fetchTicket(ref: string, explicit?: string): Promise<Ticket> {
  return resolveSource(ref, explicit).fetch(ref);
}

export type { TicketSource };
