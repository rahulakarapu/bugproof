import { readdir } from 'node:fs/promises';
import { SEEDED_BUGS } from '../core/bugs.ts';
import { loadJournal } from '../core/journal.ts';
import { color, log } from '../util/log.ts';
import { paths, relative } from '../util/paths.ts';
import { printSummary } from './verify.ts';

export async function statusCommand(ticketId: string): Promise<void> {
  const journal = await loadJournal(ticketId);
  if (!journal) {
    throw new Error(`No run journal for "${ticketId}". Nothing has been verified yet.`);
  }

  log.heading(`${journal.ticketId} — ${journal.ticketTitle}`);
  if (journal.specPath) log.detail(`spec: ${relative(journal.specPath)}`);
  if (journal.seededBug) log.detail(`seeded defect: ${journal.seededBug}`);
  log.detail(`updated: ${journal.updatedAt}`);

  for (const phase of ['red', 'green', 'guard'] as const) {
    const record = journal.phases[phase];
    if (!record) continue;
    log.plain();
    log.plain(`  ${color.bold(phase)}  ${record.verdict}`);
    log.detail(`run ${record.outcome.status}, failure class ${record.outcome.classification}`);
    log.detail(`armed: ${record.armedBugs.join(', ') || 'none'}`);
    if (record.outcome.reproSteps.length > 0) {
      log.detail(`repro assertions: ${record.outcome.reproSteps.join('; ')}`);
    }
  }

  printSummary(journal);
}

export async function listTicketsCommand(): Promise<void> {
  let files: string[] = [];
  try {
    files = (await readdir(paths.tickets)).filter((f) => f.endsWith('.json'));
  } catch {
    log.warn('No tickets fetched yet.');
    return;
  }

  log.heading('Fetched tickets');
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    const journal = await loadJournal(id);
    const state = journal?.certified
      ? color.green('certified')
      : journal
        ? color.yellow('in progress')
        : color.dim('not verified');
    log.plain(`  ${id.padEnd(24)} ${state}`);
  }
}

export function bugsCommand(): void {
  log.heading('Seeded defects in the demo app');
  for (const bug of SEEDED_BUGS) {
    log.plain(`  ${color.bold(bug.id)}  ${color.dim(`(${bug.area})`)}`);
    log.detail(bug.symptom);
    log.detail(`root cause: ${bug.rootCause}`);
    log.plain();
  }
  log.detail('Arm one manually: BUGPROOF_BUGS=tax-rounding npm run app');
}
