/** Shared domain model for tickets, runs, and verdicts. */

export type Phase = 'red' | 'green' | 'guard';

export const PHASES: readonly Phase[] = ['red', 'green', 'guard'] as const;

/** Normalized repro instructions extracted from free-form ticket prose. */
export interface ReproPlan {
  preconditions: string[];
  steps: string[];
  expected: string[];
  actual: string[];
  /** Seeded defect this ticket maps to, when running against the demo app. */
  seededBug: string | null;
  /** The ticket body the plan was parsed from, kept for the agent to read. */
  raw: string;
}

export interface Ticket {
  /** Stable slug used for file names, e.g. "gh-12". */
  id: string;
  source: string;
  /** The reference the user passed in, e.g. "12" or "tax-rounding". */
  ref: string;
  url: string | null;
  title: string;
  labels: string[];
  repro: ReproPlan;
  fetchedAt: string;
}

/** Why a test run ended the way it did. Drives whether a red run actually counts. */
export type FailureClass =
  /** An assertion inside a reproAssertion block failed: the behaviour is wrong. */
  | 'repro'
  /**
   * A reproAssertion block threw something that was not an assertion failure —
   * an unimplemented stub, or a runtime error. Proves nothing about the bug.
   */
  | 'repro-error'
  /** An assertion failed, but not the designated repro assertion. */
  | 'assertion'
  /** Locator never resolved, or resolved ambiguously. */
  | 'selector'
  /** Could not reach the app under test. */
  | 'navigation'
  /** Whole test exceeded its budget without a specific assertion failing. */
  | 'timeout'
  /** Config, worker, or reporter level problem. */
  | 'infrastructure'
  | 'unknown'
  /** No failure at all. */
  | 'none';

export type RunStatus = 'passed' | 'failed' | 'timedOut' | 'interrupted' | 'no-tests' | 'error';

export interface RunOutcome {
  status: RunStatus;
  classification: FailureClass;
  durationMs: number;
  /** First meaningful failure message, trimmed for display. */
  failureMessage: string | null;
  /** Titles of reproAssertion blocks the test reached. */
  reproSteps: string[];
  attachments: Attachment[];
  specPath: string | null;
  testTitle: string | null;
}

export interface Attachment {
  name: string;
  contentType: string;
  path: string;
}

export type Verdict =
  /** red: bug armed, test failed at the repro assertion. The bug is proven. */
  | 'reproduced'
  /** red: test passed while the bug was armed, so it proves nothing. */
  | 'vacuous'
  /** red: test failed, but for an incidental reason. */
  | 'misfire'
  /** green: bug disarmed, test passed. The fix is proven. */
  | 'fixed'
  /** green: bug disarmed, test still failed. */
  | 'unfixed'
  /** guard: bug re-armed, test failed again. The test is a real detector. */
  | 'guarding'
  /** guard: bug re-armed, test did not catch it. */
  | 'not-guarding'
  /** Could not determine anything useful. */
  | 'inconclusive';

/**
 * How the difference between "buggy" and "fixed" is produced.
 *
 * `source` is the real thing: a fix in the working tree, present for green and
 * set aside for red and guard. `toggle` is the demo fallback used when no fix has
 * been written — it varies the seeded defect flag instead, which leaves red and
 * guard running identical inputs, so guard proves only that the test is not flaky.
 */
export type FixStrategy = 'source' | 'toggle';

export interface PhaseRecord {
  phase: Phase;
  verdict: Verdict;
  /** Whether the source fix was in the tree for this run. */
  fixPresent: boolean;
  /** True when the verdict is the one this phase requires to proceed. */
  ok: boolean;
  /** Human-readable justification, produced once by the verdict engine. */
  reason: string;
  armedBugs: string[];
  outcome: RunOutcome;
  startedAt: string;
  evidenceDir: string | null;
}

export interface RunJournal {
  ticketId: string;
  ticketTitle: string;
  ticketUrl: string | null;
  specPath: string | null;
  seededBug: string | null;
  strategy: FixStrategy;
  /** Files the verified fix touched, carried into the pull request. */
  fixFiles: string[];
  phases: Partial<Record<Phase, PhaseRecord>>;
  /** True only when red, green, and guard all returned their required verdict. */
  certified: boolean;
  updatedAt: string;
}

/** The verdict each phase must return for the cycle to continue. */
export const REQUIRED_VERDICT: Record<Phase, Verdict> = {
  red: 'reproduced',
  green: 'fixed',
  guard: 'guarding',
};
