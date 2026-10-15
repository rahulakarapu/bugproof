import { readFile, writeFile } from 'node:fs/promises';
import { PHASES, REQUIRED_VERDICT, type PhaseRecord, type RunJournal, type Ticket } from './types.ts';
import { ensureDir, paths } from '../util/paths.ts';

/**
 * Durable record of a ticket's red/green/guard cycle.
 *
 * Phases are run as separate commands (the agent edits source between red and
 * green), so the verdicts have to survive between invocations.
 */

export function createJournal(ticket: Ticket, specPath: string | null): RunJournal {
  return {
    ticketId: ticket.id,
    ticketTitle: ticket.title,
    ticketUrl: ticket.url,
    specPath,
    seededBug: ticket.repro.seededBug,
    strategy: 'toggle',
    fixFiles: [],
    phases: {},
    certified: false,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadJournal(ticketId: string): Promise<RunJournal | null> {
  try {
    return JSON.parse(await readFile(paths.runFile(ticketId), 'utf8')) as RunJournal;
  } catch {
    return null;
  }
}

export async function saveJournal(journal: RunJournal): Promise<void> {
  await ensureDir(paths.runs);
  journal.certified = isCertified(journal);
  journal.updatedAt = new Date().toISOString();
  await writeFile(paths.runFile(journal.ticketId), `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
}

export function recordPhase(journal: RunJournal, record: PhaseRecord): RunJournal {
  journal.phases[record.phase] = record;

  // A new red run invalidates whatever green and guard concluded about the old
  // test, so stale verdicts are dropped rather than left to mislead.
  if (record.phase === 'red') {
    delete journal.phases.green;
    delete journal.phases.guard;
  } else if (record.phase === 'green') {
    delete journal.phases.guard;
  }

  return journal;
}

export function isCertified(journal: RunJournal): boolean {
  return PHASES.every((phase) => {
    const record = journal.phases[phase];
    return record?.verdict === REQUIRED_VERDICT[phase];
  });
}

/** The next phase to run, or null when the cycle is complete. */
export function nextPhase(journal: RunJournal): (typeof PHASES)[number] | null {
  return PHASES.find((phase) => journal.phases[phase]?.ok !== true) ?? null;
}
