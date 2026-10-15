import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../util/exec.ts';
import { ensureDir, paths, relative } from '../util/paths.ts';

/**
 * Handling for a source fix sitting in the working tree.
 *
 * The red and guard phases need the defect present; green needs it fixed. Since
 * the agent writes the fix into the working tree, those phases are run by
 * temporarily setting the fix aside as a patch and restoring it afterwards.
 *
 * The tree is always returned to the state it was found in, and a restore that
 * does not verify is treated as a hard error rather than a warning — losing a
 * developer's uncommitted fix is far worse than failing the run.
 */

export interface WorkingTreeFix {
  /** Unified diff of the fix relative to HEAD. */
  diff: string;
  /** Repo-relative paths the fix touches. */
  files: string[];
}

/** Everything that is not part of the fix: the generated test and tool state. */
const EXCLUDED = [':(exclude)tests/regression', ':(exclude).bugproof'];

async function currentDiff(): Promise<string> {
  const result = await run('git', ['diff', 'HEAD', '--', '.', ...EXCLUDED], {
    cwd: paths.root,
    throwOnError: true,
  });
  return result.stdout;
}

/**
 * Find a fix in the working tree.
 *
 * Returns null when the tree is clean outside the generated spec, which means
 * no source fix has been written yet.
 */
export async function detectFix(): Promise<WorkingTreeFix | null> {
  const inRepo = await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: paths.root });
  if (inRepo.code !== 0) return null;

  const diff = await currentDiff();
  if (!diff.trim()) return null;

  const names = await run('git', ['diff', 'HEAD', '--name-only', '--', '.', ...EXCLUDED], {
    cwd: paths.root,
    throwOnError: true,
  });

  return {
    diff,
    files: names.stdout.split('\n').map((f) => f.trim()).filter(Boolean),
  };
}

/** Untracked files outside the spec directory, which a patch cannot carry. */
export async function untrackedSourceFiles(): Promise<string[]> {
  const result = await run(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', '.', ...EXCLUDED],
    { cwd: paths.root },
  );
  return result.stdout.split('\n').map((f) => f.trim()).filter(Boolean);
}

async function applyPatch(file: string, reverse: boolean): Promise<void> {
  const args = ['apply', ...(reverse ? ['--reverse'] : []), file];
  const result = await run('git', args, { cwd: paths.root });
  if (result.code !== 0) {
    throw new Error(
      `git apply ${reverse ? '--reverse ' : ''}failed for ${relative(file)}:\n${result.stderr.trim()}`,
    );
  }
}

/**
 * Run `body` with the fix removed from the working tree, then put it back.
 *
 * Used for the red and guard phases, which must see the defect.
 */
export async function withFixRemoved<T>(fix: WorkingTreeFix, body: () => Promise<T>): Promise<T> {
  await ensureDir(paths.tmp);
  const patchFile = join(paths.tmp, 'pending-fix.patch');
  await writeFile(patchFile, fix.diff, 'utf8');

  await applyPatch(patchFile, true);

  try {
    return await body();
  } finally {
    await applyPatch(patchFile, false);

    // Confirm byte-for-byte that the developer's fix came back.
    const restored = await currentDiff();
    if (restored !== fix.diff) {
      const rescue = join(paths.tmp, 'UNRESTORED-fix.patch');
      await writeFile(rescue, fix.diff, 'utf8');
      throw new Error(
        `The working tree was not restored to its original state. Your fix has been saved to ${relative(rescue)}; recover it with:\n  git apply ${relative(rescue)}`,
      );
    }

    await rm(patchFile, { force: true });
  }
}
