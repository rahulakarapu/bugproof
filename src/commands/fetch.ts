import { readFile, writeFile } from 'node:fs/promises';
import { describePlanGaps, planIsActionable } from '../core/ticket.ts';
import type { Ticket } from '../core/types.ts';
import { fetchTicket } from '../sources/index.ts';
import { log } from '../util/log.ts';
import { ensureDir, paths, relative } from '../util/paths.ts';

/** Read the cached, normalized ticket written by `bugproof fetch`. */
export async function loadTicket(ticketId: string): Promise<Ticket> {
  try {
    return JSON.parse(await readFile(paths.ticketFile(ticketId), 'utf8')) as Ticket;
  } catch {
    throw new Error(`No fetched ticket "${ticketId}". Run \`bugproof fetch <ref>\` first.`);
  }
}

export async function fetchCommand(ref: string, options: { source?: string }): Promise<Ticket> {
  const ticket = await fetchTicket(ref, options.source);

  await ensureDir(paths.tickets);
  await writeFile(paths.ticketFile(ticket.id), `${JSON.stringify(ticket, null, 2)}\n`, 'utf8');

  log.heading(`${ticket.id} — ${ticket.title}`);
  log.detail(`source: ${ticket.source}${ticket.url ? `  ${ticket.url}` : ''}`);
  log.detail(`cached: ${relative(paths.ticketFile(ticket.id))}`);

  const { repro } = ticket;
  log.plain();
  printList('preconditions', repro.preconditions);
  printList('steps', repro.steps);
  printList('expected', repro.expected);
  printList('actual', repro.actual);

  if (repro.seededBug) {
    log.plain();
    log.ok(`mapped to seeded defect \`${repro.seededBug}\` — red/green can be driven automatically`);
  } else {
    log.plain();
    log.warn('no seeded defect mapped; arm and disarm the real code change yourself between phases');
  }

  if (!planIsActionable(repro)) {
    log.plain();
    log.warn(`thin repro plan: ${describePlanGaps(repro).join(', ')}`);
    log.detail('Generation will rely on the raw ticket body; consider asking the reporter for detail.');
  }

  return ticket;
}

function printList(label: string, items: readonly string[]): void {
  if (items.length === 0) return;
  log.plain(`  ${label}:`);
  for (const item of items) log.plain(`    - ${item}`);
}
