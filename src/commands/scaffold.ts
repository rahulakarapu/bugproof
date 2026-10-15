import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { findSeededBug } from '../core/bugs.ts';
import { createJournal, loadJournal, saveJournal } from '../core/journal.ts';
import type { Ticket } from '../core/types.ts';
import { log } from '../util/log.ts';
import { ensureDir, paths, relative } from '../util/paths.ts';
import { loadTicket } from './fetch.ts';

function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function commentBlock(label: string, items: readonly string[]): string[] {
  if (items.length === 0) return [];
  return [` * ${label}:`, ...items.map((item) => ` *   - ${item}`)];
}

/**
 * Emit a spec skeleton carrying the ticket's repro plan as a comment.
 *
 * The body is intentionally left unimplemented: the agent fills it in, and until
 * it does, the red phase reports a misfire rather than a false reproduction.
 */
export function specTemplate(ticket: Ticket): string {
  const { repro } = ticket;
  const seeded = repro.seededBug ? findSeededBug(repro.seededBug) : undefined;

  const header = [
    '/**',
    ` * Regression guard for ${ticket.id}: ${ticket.title}`,
    ...(ticket.url ? [` *`, ` * Ticket: ${ticket.url}`] : []),
    ...(seeded ? [` * Seeded defect: ${seeded.id} (${seeded.area}) — ${seeded.symptom}`] : []),
    ' *',
    ' * Repro plan parsed from the ticket:',
    ...commentBlock('preconditions', repro.preconditions),
    ...commentBlock('steps', repro.steps),
    ...commentBlock('expected', repro.expected),
    ...commentBlock('actual', repro.actual),
    ' *',
    ' * Only the check that distinguishes buggy from fixed belongs inside',
    ' * reproAssertion(); setup and navigation stay outside it.',
    ' */',
  ];

  return `${header.join('\n')}
import { expect, test } from '@playwright/test';
import { openStorefront, reproAssertion } from '../support/repro.ts';

test('${quote(ticket.title)}', async ({ page }) => {
  await openStorefront(page);

  // TODO(bugproof): drive the app into the state the repro steps describe.

  await reproAssertion('${quote(ticket.title)}', async () => {
    // TODO(bugproof): assert the EXPECTED value from the ticket, so this fails
    // while the defect is present and passes once it is fixed.
    throw new Error('repro assertion not implemented');
  });
});
`;
}

export async function scaffoldCommand(
  ticketId: string,
  options: { force?: boolean },
): Promise<string> {
  const ticket = await loadTicket(ticketId);
  const specPath = paths.specFile(ticket.id);

  if (existsSync(specPath) && !options.force) {
    log.warn(`${relative(specPath)} already exists; leaving it alone (use --force to overwrite)`);
  } else {
    await ensureDir(paths.specs);
    await writeFile(specPath, specTemplate(ticket), 'utf8');
    log.ok(`wrote ${relative(specPath)}`);
  }

  const journal = (await loadJournal(ticket.id)) ?? createJournal(ticket, specPath);
  journal.specPath = specPath;
  journal.seededBug = ticket.repro.seededBug;
  await saveJournal(journal);

  log.detail('Next: implement the TODOs, then run `bugproof verify ' + ticket.id + ' --phase red`.');
  return specPath;
}
