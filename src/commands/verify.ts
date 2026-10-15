import { existsSync } from 'node:fs';
import { assertKnownBugs, parseArmedBugs } from '../core/bugs.ts';
import { createJournal, loadJournal, recordPhase, saveJournal } from '../core/journal.ts';
import { runSpec } from '../core/runner.ts';
import { PHASES, type Phase, type PhaseRecord, type RunJournal } from '../core/types.ts';
import { judge, remediation } from '../core/verdict.ts';
import { color, log } from '../util/log.ts';
import { paths, relative } from '../util/paths.ts';
import { loadTicket } from './fetch.ts';

export interface VerifyOptions {
  phase: string;
  /** Override which defects are armed, instead of deriving from the ticket. */
  arm?: string;
  /** Keep going through later phases even after one fails its requirement. */
  keepGoing?: boolean;
}

/**
 * Which defects are armed for a phase.
 *
 * With a seeded defect the cycle is fully automatic: red and guard arm it, green
 * disarms it. Without one, arming is whatever the working tree currently does,
 * and the operator is responsible for applying the fix between red and green.
 */
export function bugsForPhase(phase: Phase, seededBug: string | null): string[] {
  if (!seededBug) return [];
  return phase === 'green' ? [] : [seededBug];
}

const PHASE_INTENT: Record<Phase, string> = {
  red: 'prove the bug — defect armed, test must fail at its repro assertion',
  green: 'prove the fix — defect disarmed, test must pass',
  guard: 'prove the guard — defect re-armed, test must fail again',
};

async function runPhase(
  journal: RunJournal,
  phase: Phase,
  specPath: string,
  override: string[] | null,
): Promise<PhaseRecord> {
  const armedBugs = override ?? bugsForPhase(phase, journal.seededBug);
  assertKnownBugs(armedBugs);

  log.heading(`${phase.toUpperCase()} — ${PHASE_INTENT[phase]}`);
  log.detail(
    armedBugs.length > 0 ? `arming: ${armedBugs.join(', ')}` : 'arming: none (all defects disarmed)',
  );

  const outcome = await runSpec({
    specPath,
    armedBugs,
    outputDir: paths.evidenceDir(journal.ticketId, phase),
    label: `${journal.ticketId}-${phase}`,
  });

  const { verdict, ok, reason } = judge(phase, outcome);

  const line = `${verdict} — run ${outcome.status}${
    outcome.classification !== 'none' ? `, failure class: ${outcome.classification}` : ''
  }`;
  if (ok) log.ok(line);
  else log.fail(line);
  log.detail(reason);

  if (outcome.failureMessage && !ok) {
    log.plain();
    for (const row of outcome.failureMessage.split('\n').slice(0, 12)) {
      log.plain(`    ${color.dim(row)}`);
    }
    log.plain();
  }

  const record: PhaseRecord = {
    phase,
    verdict,
    ok,
    reason,
    armedBugs,
    outcome,
    startedAt: new Date().toISOString(),
    evidenceDir: paths.evidenceDir(journal.ticketId, phase),
  };

  recordPhase(journal, record);
  await saveJournal(journal);
  return record;
}

export async function verifyCommand(ticketId: string, options: VerifyOptions): Promise<RunJournal> {
  const ticket = await loadTicket(ticketId);
  const journal = (await loadJournal(ticketId)) ?? createJournal(ticket, paths.specFile(ticketId));

  const specPath = journal.specPath ?? paths.specFile(ticketId);
  if (!existsSync(specPath)) {
    throw new Error(`No spec at ${relative(specPath)}. Run \`bugproof scaffold ${ticketId}\` first.`);
  }

  journal.seededBug = ticket.repro.seededBug;
  journal.specPath = specPath;

  const override = options.arm !== undefined ? parseArmedBugs(options.arm) : null;
  if (!journal.seededBug && override === null) {
    log.warn(
      'This ticket has no seeded defect. Phases will run against the working tree as-is — apply the fix yourself between red and green.',
    );
  }

  const requested: Phase[] =
    options.phase === 'all' ? [...PHASES] : [assertPhase(options.phase)];

  for (const phase of requested) {
    const record = await runPhase(journal, phase, specPath, override);

    if (!record.ok && !options.keepGoing) {
      const fix = remediation(record.verdict, record.outcome.classification);
      if (fix) {
        log.plain();
        log.warn(fix);
      }
      if (requested.length > 1) {
        log.detail(`Stopping before ${requested.slice(requested.indexOf(phase) + 1).join(', ')}.`);
      }
      break;
    }
  }

  await saveJournal(journal);
  printSummary(journal);
  return journal;
}

function assertPhase(value: string): Phase {
  if ((PHASES as readonly string[]).includes(value)) return value as Phase;
  throw new Error(`Unknown phase "${value}". Expected one of: ${PHASES.join(', ')}, all.`);
}

export function printSummary(journal: RunJournal): void {
  log.heading('Cycle');
  for (const phase of PHASES) {
    const record = journal.phases[phase];
    if (!record) {
      log.plain(`  ${color.dim(`${phase.padEnd(6)} not run`)}`);
      continue;
    }
    const mark = record.ok ? color.green('✓') : color.red('✗');
    log.plain(`  ${mark} ${phase.padEnd(6)} ${record.verdict}`);
  }

  log.plain();
  if (journal.certified) {
    log.ok(
      color.bold('certified') +
        ' — the test fails on the bug, passes on the fix, and catches the bug returning',
    );
    log.detail(`Next: \`bugproof evidence ${journal.ticketId} --post\` then \`bugproof commit ${journal.ticketId}\`.`);
  } else {
    log.warn('not certified — the cycle is incomplete');
  }
}
