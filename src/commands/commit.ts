import { existsSync } from 'node:fs';
import { loadJournal } from '../core/journal.ts';
import { PHASES, type RunJournal } from '../core/types.ts';
import { run } from '../util/exec.ts';
import { log } from '../util/log.ts';
import { paths, relative } from '../util/paths.ts';

function buildMessage(journal: RunJournal): string {
  const lines = [
    `test(regression): guard ${journal.ticketId} — ${journal.ticketTitle}`,
    '',
    'Added a Playwright regression guard generated from the bug ticket and',
    'verified through a full red/green/guard cycle.',
    '',
  ];

  for (const phase of PHASES) {
    const record = journal.phases[phase];
    if (!record) continue;
    const armed = record.armedBugs.length > 0 ? record.armedBugs.join(',') : 'none';
    lines.push(`${`${phase}:`.padEnd(7)} ${record.verdict} (armed: ${armed})`);
  }

  lines.push('');
  if (journal.specPath) lines.push(`Spec: ${relative(journal.specPath)}`);
  if (journal.ticketUrl) lines.push(`Ticket: ${journal.ticketUrl}`);

  return `${lines.join('\n')}\n`;
}

export async function commitCommand(
  ticketId: string,
  options: { force?: boolean },
): Promise<void> {
  const journal = await loadJournal(ticketId);
  if (!journal) throw new Error(`No run journal for "${ticketId}".`);

  if (!journal.certified && !options.force) {
    throw new Error(
      'Refusing to commit an uncertified guard. The cycle must reach reproduced → fixed → guarding first (or pass --force).',
    );
  }

  const specPath = journal.specPath;
  if (!specPath || !existsSync(specPath)) {
    throw new Error(`No spec to commit for "${ticketId}".`);
  }

  const inRepo = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: paths.root });
  if (inRepo.code !== 0) {
    throw new Error('Not a git repository, so there is nothing to commit into.');
  }

  await run('git', ['add', '--', relative(specPath)], { cwd: paths.root, throwOnError: true });

  const staged = await run('git', ['diff', '--cached', '--name-only'], { cwd: paths.root });
  if (!staged.stdout.trim()) {
    log.warn('Nothing staged — the guard is already committed.');
    return;
  }

  // No --no-verify: hooks are part of the contract for a commit this tool makes.
  const result = await run('git', ['commit', '-m', buildMessage(journal)], { cwd: paths.root });
  if (result.code !== 0) {
    throw new Error(`git commit failed:\n${result.stderr || result.stdout}`);
  }

  const sha = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: paths.root });
  log.ok(`committed ${sha.stdout.trim()} — ${relative(specPath)} is now a permanent regression guard`);
}
