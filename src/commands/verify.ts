import { existsSync } from 'node:fs';
import { assertKnownBugs, parseArmedBugs } from '../core/bugs.ts';
import { detectFix, untrackedSourceFiles, withFixRemoved, type WorkingTreeFix } from '../core/fix.ts';
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
  /** Ignore a working-tree fix and use seeded-defect toggling instead. */
  ignoreFix?: boolean;
}

/**
 * Which defects are armed for a phase under the toggle strategy.
 *
 * Used only when no source fix exists: red and guard arm the seeded defect, green
 * disarms it. Note this leaves red and guard with identical inputs.
 */
export function bugsForPhase(phase: Phase, seededBug: string | null): string[] {
  if (!seededBug) return [];
  return phase === 'green' ? [] : [seededBug];
}

export interface PhasePlan {
  armedBugs: string[];
  /** Whether the working-tree fix should be in place for this run. */
  fixPresent: boolean;
}

/**
 * What a phase runs against.
 *
 * With a source fix the defect stays armed throughout and the *fix* is the
 * variable, so green genuinely tests the change and guard genuinely tests that
 * removing it brings the failure back.
 */
export function phasePlan(phase: Phase, seededBug: string | null, hasFix: boolean): PhasePlan {
  if (hasFix) {
    return {
      armedBugs: seededBug ? [seededBug] : [],
      fixPresent: phase === 'green',
    };
  }
  return { armedBugs: bugsForPhase(phase, seededBug), fixPresent: false };
}

const PHASE_INTENT: Record<Phase, string> = {
  red: 'prove the bug — defect present, test must fail at its repro assertion',
  green: 'prove the fix — fix applied, test must pass',
  guard: 'prove the guard — fix removed, test must fail again',
};

async function runPhase(
  journal: RunJournal,
  phase: Phase,
  specPath: string,
  override: string[] | null,
  fix: WorkingTreeFix | null,
): Promise<PhaseRecord> {
  const plan = phasePlan(phase, journal.seededBug, fix !== null);
  const armedBugs = override ?? plan.armedBugs;
  assertKnownBugs(armedBugs);

  log.heading(`${phase.toUpperCase()} — ${PHASE_INTENT[phase]}`);
  log.detail(
    armedBugs.length > 0 ? `arming: ${armedBugs.join(', ')}` : 'arming: none (all defects disarmed)',
  );
  if (fix) {
    log.detail(plan.fixPresent ? 'source fix: applied' : 'source fix: set aside');
  }

  const execute = () =>
    runSpec({
      specPath,
      armedBugs,
      outputDir: paths.evidenceDir(journal.ticketId, phase),
      label: `${journal.ticketId}-${phase}`,
    });

  // red and guard must see the defect, so the fix is lifted out for the run and
  // put back immediately afterwards.
  const outcome =
    fix && !plan.fixPresent ? await withFixRemoved(fix, execute) : await execute();

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
    fixPresent: plan.fixPresent,
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

  const fix = options.ignoreFix ? null : await detectFix();
  journal.strategy = fix ? 'source' : 'toggle';
  journal.fixFiles = fix?.files ?? [];

  if (fix) {
    log.step(`source fix detected in ${fix.files.length} file(s): ${fix.files.join(', ')}`);
    const untracked = await untrackedSourceFiles();
    if (untracked.length > 0) {
      log.warn(
        `Untracked files cannot be carried in the fix patch and will stay in place for every phase: ${untracked.join(', ')}`,
      );
      log.detail('Run `git add` on them so they become part of the fix.');
    }
  } else if (journal.seededBug) {
    log.warn(
      'No source fix in the working tree — falling back to toggling the seeded defect. Guard will re-run red\'s exact inputs, so it only rules out flakiness.',
    );
  } else {
    log.warn(
      'No seeded defect and no source fix. Every phase runs against the same tree, so the cycle cannot distinguish buggy from fixed.',
    );
  }

  const requested: Phase[] =
    options.phase === 'all' ? [...PHASES] : [assertPhase(options.phase)];

  for (const phase of requested) {
    const record = await runPhase(journal, phase, specPath, override, fix);

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
  log.detail(
    journal.strategy === 'source'
      ? 'strategy: source fix (green runs with the fix, red and guard without it)'
      : 'strategy: seeded-defect toggle (no source fix; guard repeats red)',
  );
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
