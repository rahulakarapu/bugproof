import {
  REQUIRED_VERDICT,
  type FailureClass,
  type FixStrategy,
  type Phase,
  type RunOutcome,
  type Verdict,
} from './types.ts';

export interface Judgement {
  verdict: Verdict;
  /** True when this is the verdict the phase needed in order to continue. */
  ok: boolean;
  /** One-line explanation written for a human reading the ticket comment. */
  reason: string;
}

/**
 * Turn a raw test result into a verdict about the *bug*, not about the test.
 *
 * The distinction that matters: a red run only counts as a reproduction if the
 * test failed at the assertion written to capture the defect. A test that fails
 * because a selector went stale is not evidence of anything, and a test that
 * passes while the defect is armed is actively misleading — it would be
 * committed as a regression guard that guards nothing.
 */
export function judge(
  phase: Phase,
  outcome: RunOutcome,
  strategy: FixStrategy = 'toggle',
): Judgement {
  const judgement = evaluate(phase, outcome, strategy);
  return { ...judgement, ok: judgement.verdict === REQUIRED_VERDICT[phase] };
}

function evaluate(
  phase: Phase,
  outcome: RunOutcome,
  strategy: FixStrategy,
): Omit<Judgement, 'ok'> {
  if (outcome.status === 'error' || outcome.status === 'no-tests') {
    return {
      verdict: 'inconclusive',
      reason:
        outcome.status === 'no-tests'
          ? 'No test ran, so there is nothing to judge.'
          : 'The run failed before reaching the test, so the result says nothing about the bug.',
    };
  }

  const failedAtRepro = outcome.classification === 'repro';
  const incidental = incidentalReason(outcome);

  switch (phase) {
    case 'red':
    case 'guard': {
      const required: Verdict = phase === 'red' ? 'reproduced' : 'guarding';

      if (outcome.status === 'passed') {
        return {
          verdict: phase === 'red' ? 'vacuous' : 'not-guarding',
          reason:
            phase === 'red'
              ? 'The test passed with the defect in place, so it does not actually exercise the bug.'
              : strategy === 'source'
                ? 'The fix was removed and the test still passed, so it would not catch this regression.'
                : 'The defect was re-armed and the test still passed, so it would not catch this regression.',
        };
      }

      if (failedAtRepro) {
        return { verdict: required, reason: provenReason(phase, strategy) };
      }

      return {
        verdict: 'misfire',
        reason: `The test failed, but ${incidental} That is a problem with the test, not evidence of the bug.`,
      };
    }

    case 'green': {
      if (outcome.status === 'passed') {
        return {
          verdict: 'fixed',
          reason:
            strategy === 'source'
              ? 'The test passed with the fix applied: the fix resolves the reported behaviour.'
              : 'With the defect disarmed the test passed: the reported behaviour is resolved.',
        };
      }

      return {
        verdict: 'unfixed',
        reason: failedAtRepro
          ? 'The repro assertion still fails with the defect disarmed, so the fix is incomplete.'
          : `The test failed for an unrelated reason: ${incidental}`,
      };
    }
  }
}

/**
 * Why a red or guard failure counts as proof.
 *
 * Under the toggle strategy guard re-runs red's exact inputs, so it cannot claim
 * to have tested the fix — saying otherwise would be the same overclaiming the
 * verdict engine exists to prevent.
 */
function provenReason(phase: Phase, strategy: FixStrategy): string {
  if (phase === 'red') {
    return strategy === 'source'
      ? 'The test failed at its repro assertion with the fix set aside: the bug is reproduced.'
      : 'The test failed at its repro assertion with the defect armed: the bug is reproduced.';
  }

  return strategy === 'source'
    ? 'Removing the fix brought the failure back, so the test will catch this regression.'
    : 'The test failed again with the defect re-armed. This repeats red\'s inputs, so it establishes only that the test is not flaky.';
}

/** Human-readable gloss on a non-repro failure class. */
function incidentalReason(outcome: RunOutcome): string {
  switch (outcome.classification) {
    case 'repro-error':
      return 'the repro block threw a plain error rather than failing an assertion, so it never actually checked the behaviour.';
    case 'selector':
      return 'a locator never resolved, so the test never reached its assertion.';
    case 'navigation':
      return 'the app under test was unreachable.';
    case 'timeout':
      return 'the whole test timed out without a specific assertion failing.';
    case 'assertion':
      return 'the failure came from an assertion outside the repro block.';
    case 'infrastructure':
      return 'the test runner itself errored.';
    default:
      return 'the cause could not be attributed to the repro assertion.';
  }
}

/** Short guidance on what to do about a verdict that blocks the cycle. */
export function remediation(verdict: Verdict, classification?: FailureClass): string | null {
  if (verdict === 'misfire' && classification === 'repro-error') {
    return 'Implement the repro assertion: replace the placeholder throw with an expect() on the value the ticket says is correct.';
  }

  switch (verdict) {
    case 'vacuous':
      return 'Tighten the repro assertion so it is sensitive to the defect — assert the exact expected value, not just that an element exists.';
    case 'misfire':
      return 'Fix the test setup (selectors, navigation, waits) and re-run red. Keep setup outside the reproAssertion block.';
    case 'unfixed':
      return 'The source change does not resolve the reported behaviour yet. Revisit the fix, then re-run green.';
    case 'not-guarding':
      return 'The assertion is not sensitive enough to detect the defect returning. Strengthen it and re-run the cycle.';
    case 'inconclusive':
      return 'Resolve the run error (config, dependencies, or app startup) and try again.';
    default:
      return null;
  }
}
