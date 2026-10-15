import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderReport } from '../core/evidence.ts';
import { loadJournal } from '../core/journal.ts';
import type { RunJournal } from '../core/types.ts';
import { run } from '../util/exec.ts';
import { commandExists } from '../util/exec.ts';
import { log } from '../util/log.ts';
import { ensureDir, paths, relative } from '../util/paths.ts';

export interface PrOptions {
  base?: string;
  draft?: boolean;
  force?: boolean;
}

async function git(args: string[], throwOnError = true) {
  return run('git', args, { cwd: paths.root, throwOnError });
}

async function currentBranch(): Promise<string> {
  const result = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return result.stdout.trim();
}

/** Compact timestamp so repeated demo runs get their own branch and PR. */
function branchSuffix(): string {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** GitHub issue number, for the closing keyword. */
function issueNumber(journal: RunJournal): string | null {
  const fromUrl = journal.ticketUrl?.match(/\/issues\/(\d+)/);
  if (fromUrl?.[1]) return fromUrl[1];
  const fromId = journal.ticketId.match(/^gh-(\d+)$/);
  return fromId?.[1] ?? null;
}

function prBody(journal: RunJournal, report: string): string {
  const issue = issueNumber(journal);
  const lines: string[] = [];

  if (issue) lines.push(`Fixes #${issue}`, '');

  lines.push(
    journal.strategy === 'source'
      ? 'The regression test in this branch was written from the ticket, verified to fail without the fix, pass with it, and fail again once the fix was removed.'
      : 'The regression test in this branch was generated from the ticket and verified against a seeded defect toggle.',
    '',
    report,
  );

  return lines.join('\n');
}

/**
 * Open a pull request carrying the regression test and the fix.
 *
 * The branch is cut from the current one and the working tree is returned to it
 * afterwards, so the base branch is never modified and the cycle can be demoed
 * again from a clean slate. The fix leaves the working tree because it becomes a
 * commit on the pushed branch.
 */
export async function prCommand(ticketId: string, options: PrOptions): Promise<void> {
  const journal = await loadJournal(ticketId);
  if (!journal) throw new Error(`No run journal for "${ticketId}".`);

  if (!journal.certified && !options.force) {
    throw new Error(
      'Refusing to open a pull request for an uncertified cycle. Run `bugproof verify` through reproduced → fixed → guarding first (or pass --force).',
    );
  }

  const specPath = journal.specPath;
  if (!specPath || !existsSync(specPath)) {
    throw new Error(`No spec to publish for "${ticketId}".`);
  }

  if (!(await commandExists('gh'))) {
    throw new Error('The GitHub CLI (gh) is required to open a pull request.');
  }

  if ((await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: paths.root })).code !== 0) {
    throw new Error('Not a git repository.');
  }
  if ((await run('git', ['remote', 'get-url', 'origin'], { cwd: paths.root })).code !== 0) {
    throw new Error('No `origin` remote to push the branch to.');
  }

  const base = options.base ?? (await currentBranch());
  const branch = `bugproof/${ticketId}-${branchSuffix()}`;

  const fixFiles = journal.fixFiles.filter((file) => existsSync(join(paths.root, file)));
  if (fixFiles.length === 0) {
    log.warn(
      'No source fix recorded for this cycle, so the pull request will contain only the regression test.',
    );
  }

  await ensureDir(paths.tmp);
  const bodyFile = join(paths.tmp, `${ticketId}-pr.md`);

  log.step(`branching ${branch} from ${base}`);
  await git(['checkout', '-b', branch]);

  try {
    // Test first, then the fix: the history mirrors the red → green cycle.
    await git(['add', '--', relative(specPath)]);
    await git([
      'commit',
      '-m',
      `test(regression): failing guard for ${journal.ticketId} — ${journal.ticketTitle}`,
    ]);
    log.ok('committed the regression test');

    if (fixFiles.length > 0) {
      await git(['add', '--', ...fixFiles]);
      await git(['commit', '-m', `fix: ${journal.ticketTitle}`]);
      log.ok(`committed the fix (${fixFiles.join(', ')})`);
    }

    await git(['push', '-u', 'origin', branch]);
    log.ok(`pushed ${branch}`);

    await writeFile(bodyFile, prBody(journal, await renderReport(journal)), 'utf8');

    const args = [
      'pr',
      'create',
      '--base',
      base,
      '--head',
      branch,
      '--title',
      `fix: ${journal.ticketTitle}`,
      '--body-file',
      bodyFile,
    ];
    if (options.draft) args.push('--draft');

    const created = await run('gh', args, { cwd: paths.root });
    if (created.code !== 0) {
      throw new Error(`gh pr create failed:\n${created.stderr || created.stdout}`);
    }

    log.ok(`opened ${created.stdout.trim()}`);
  } finally {
    // Always land back on the base branch, even if the push or PR creation failed.
    await git(['checkout', base], false);
    await rm(bodyFile, { force: true });
  }

  log.plain();
  log.detail(`${base} is unchanged; the test and fix live only on ${branch}.`);
  log.detail(`Recover the fix locally with: git checkout ${branch} -- ${fixFiles.join(' ') || '.'}`);
}
