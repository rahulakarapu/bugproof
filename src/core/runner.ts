import { createServer } from 'node:net';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { REPRO_MARKER } from '../../tests/support/repro.ts';
import { run } from '../util/exec.ts';
import { ensureDir, paths, relative } from '../util/paths.ts';
import type { Attachment, FailureClass, RunOutcome, RunStatus } from './types.ts';

/* ------------------------------------------------------------------ *
 * Playwright JSON reporter shape (only the fields we consume)
 * ------------------------------------------------------------------ */

interface JsonStep {
  title: string;
  error?: { message?: string };
  steps?: JsonStep[];
}

interface JsonResult {
  status: string;
  duration?: number;
  error?: { message?: string; stack?: string };
  errors?: Array<{ message?: string }>;
  attachments?: Array<{ name: string; contentType: string; path?: string }>;
  steps?: JsonStep[];
}

interface JsonSpec {
  title: string;
  ok: boolean;
  file?: string;
  tests?: Array<{ results?: JsonResult[] }>;
}

interface JsonSuite {
  title?: string;
  file?: string;
  specs?: JsonSpec[];
  suites?: JsonSuite[];
}

interface JsonReport {
  suites?: JsonSuite[];
  errors?: Array<{ message?: string; value?: string }>;
  stats?: { unexpected?: number; expected?: number; duration?: number };
}

/* ------------------------------------------------------------------ *
 * Failure classification
 * ------------------------------------------------------------------ */

const REPRO_MARKER_RE = new RegExp(REPRO_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

/**
 * Shape of a Playwright assertion failure.
 *
 * Every `expect(...)` rejection — including matcher timeouts — names the matcher
 * in its message, which is what separates a real assertion failure from an
 * arbitrary exception that happened to be thrown in the same block.
 */
const ASSERTION_SIGNATURE =
  /expect\(|Expected (?:string|pattern|value|substring|array|object)|Received:/;

const PATTERNS: ReadonlyArray<[FailureClass, RegExp]> = [
  ['navigation', /net::ERR_|ECONNREFUSED|ERR_CONNECTION_REFUSED|page\.goto.*(failed|Timeout)/i],
  // Outside a repro block, an unresolved locator means the test is broken rather
  // than the app being wrong.
  ['selector', /resolved to 0 elements|strict mode violation|waiting for locator|locator\.\w+: Timeout/i],
  ['assertion', ASSERTION_SIGNATURE],
  ['timeout', /Test timeout of \d+ms exceeded|Timeout .* exceeded/i],
];

/**
 * Attribute a failure to a cause.
 *
 * Being thrown inside a reproAssertion block is necessary but not sufficient for
 * a failure to count as a reproduction: an unimplemented stub or a TypeError in
 * that block would otherwise be read as proof of the bug. Only an actual
 * assertion failure there earns the `repro` class.
 */
export function classifyFailure(message: string | null | undefined): FailureClass {
  if (!message) return 'none';

  if (REPRO_MARKER_RE.test(message)) {
    return ASSERTION_SIGNATURE.test(message) ? 'repro' : 'repro-error';
  }

  for (const [kind, pattern] of PATTERNS) {
    if (pattern.test(message)) return kind;
  }
  return 'unknown';
}

/* ------------------------------------------------------------------ *
 * Report traversal
 * ------------------------------------------------------------------ */

function collectSpecs(suites: readonly JsonSuite[] | undefined): JsonSpec[] {
  if (!suites) return [];
  return suites.flatMap((suite) => [...(suite.specs ?? []), ...collectSpecs(suite.suites)]);
}

function flattenSteps(steps: readonly JsonStep[] | undefined): JsonStep[] {
  if (!steps) return [];
  return steps.flatMap((step) => [step, ...flattenSteps(step.steps)]);
}

function normalizeStatus(status: string): RunStatus {
  switch (status) {
    case 'passed':
    case 'failed':
    case 'timedOut':
    case 'interrupted':
      return status;
    case 'skipped':
      return 'no-tests';
    default:
      return 'error';
  }
}

/** Strip ANSI colour codes and clip to something readable in a ticket comment. */
function tidyMessage(message: string, limit = 1600): string {
  const clean = message.replace(/\u001B\[[0-9;]*m/g, '').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}\n… (truncated)` : clean;
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

export interface RunSpecOptions {
  specPath: string;
  armedBugs: readonly string[];
  /** Directory Playwright writes traces/screenshots into for this phase. */
  outputDir: string;
  /** Extra label used to name the JSON report file. */
  label: string;
}

async function findFreePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine a free port.')));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * Execute one spec with a specific set of defects armed.
 *
 * A non-zero exit code is expected and meaningful here, so the result is parsed
 * from the JSON report rather than inferred from the exit status.
 */
export async function runSpec(options: RunSpecOptions): Promise<RunOutcome> {
  await ensureDir(paths.tmp);
  await ensureDir(options.outputDir);

  const reportFile = join(paths.tmp, `report-${options.label}.json`);
  await rm(reportFile, { force: true });

  // A fresh port per phase removes "address already in use" flakiness when a
  // previous phase's server is still shutting down.
  const port = await findFreePort();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BUGPROOF_BUGS: options.armedBugs.join(','),
    BUGPROOF_PORT: String(port),
    BUGPROOF_BASE_URL: `http://localhost:${port}`,
    BUGPROOF_OUTPUT_DIR: options.outputDir,
    PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
    PLAYWRIGHT_HTML_REPORT: join(options.outputDir, 'html-report'),
  };

  const started = Date.now();
  const result = await run('npx', ['playwright', 'test', relative(options.specPath)], {
    cwd: paths.root,
    env,
  });
  const elapsed = Date.now() - started;

  let report: JsonReport | null = null;
  try {
    report = JSON.parse(await readFile(reportFile, 'utf8')) as JsonReport;
  } catch {
    report = null;
  }

  if (!report) {
    return {
      status: 'error',
      classification: 'infrastructure',
      durationMs: elapsed,
      failureMessage: tidyMessage(result.stderr || result.stdout || 'Playwright produced no report.'),
      reproSteps: [],
      attachments: [],
      specPath: options.specPath,
      testTitle: null,
    };
  }

  const specs = collectSpecs(report.suites);
  const spec = specs[0];
  const lastResult = spec?.tests?.[0]?.results?.at(-1);

  if (!spec || !lastResult) {
    const configError = report.errors?.map((e) => e.message ?? e.value ?? '').filter(Boolean).join('\n');
    return {
      status: configError ? 'error' : 'no-tests',
      classification: configError ? 'infrastructure' : 'none',
      durationMs: elapsed,
      failureMessage: configError
        ? tidyMessage(configError)
        : `No tests matched ${relative(options.specPath)}.`,
      reproSteps: [],
      attachments: [],
      specPath: options.specPath,
      testTitle: null,
    };
  }

  const status = normalizeStatus(lastResult.status);

  // Prefer the error raised inside a [repro] step: if the test both failed a
  // repro assertion and hit cleanup noise, the repro failure is the real signal.
  const steps = flattenSteps(lastResult.steps);
  const reproStepError = steps.find(
    (step) => step.title.startsWith('[repro]') && step.error?.message,
  )?.error?.message;

  const rawMessage =
    reproStepError ??
    lastResult.error?.message ??
    lastResult.errors?.find((e) => e.message)?.message ??
    null;

  const attachments: Attachment[] = (lastResult.attachments ?? [])
    .filter((a): a is Attachment & { path: string } => Boolean(a.path))
    .map((a) => ({ name: a.name, contentType: a.contentType, path: a.path }));

  return {
    status,
    classification: status === 'passed' ? 'none' : classifyFailure(rawMessage),
    durationMs: lastResult.duration ?? elapsed,
    failureMessage: rawMessage ? tidyMessage(rawMessage) : null,
    reproSteps: steps
      .filter((step) => step.title.startsWith('[repro]'))
      .map((step) => step.title.replace(/^\[repro\]\s*/, '')),
    attachments,
    specPath: spec.file ?? options.specPath,
    testTitle: spec.title,
  };
}
