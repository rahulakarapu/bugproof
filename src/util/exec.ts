import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly result: RunResult,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/**
 * Run a command and capture its output.
 *
 * Non-zero exit is returned rather than thrown unless `throwOnError` is set,
 * because a failing `playwright test` is a normal, expected outcome here.
 */
export async function run(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; throwOnError?: boolean; maxBuffer?: number } = {},
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, [...args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
    const result: RunResult = {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message,
      code: typeof err.code === 'number' ? err.code : 1,
    };
    if (options.throwOnError) {
      throw new CommandError(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`, result);
    }
    return result;
  }
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await run('which', [command]);
  return result.code === 0;
}
