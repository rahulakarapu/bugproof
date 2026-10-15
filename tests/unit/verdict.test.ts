import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bugsForPhase, phasePlan } from '../../src/commands/verify.ts';
import { classifyFailure } from '../../src/core/runner.ts';
import type { FailureClass, RunOutcome, RunStatus } from '../../src/core/types.ts';
import { judge } from '../../src/core/verdict.ts';
import { REPRO_MARKER } from '../support/repro.ts';

function outcome(status: RunStatus, classification: FailureClass): RunOutcome {
  return {
    status,
    classification,
    durationMs: 10,
    failureMessage: null,
    reproSteps: [],
    attachments: [],
    specPath: 'tests/regression/example.spec.ts',
    testTitle: 'example',
  };
}

describe('classifyFailure', () => {
  it('counts an assertion failure inside the repro block as a reproduction', () => {
    const message = `${REPRO_MARKER} total\nexpect(locator).toHaveText(expected)\nExpected: "$13.61"\nReceived: "$13.60"`;
    assert.equal(classifyFailure(message), 'repro');
  });

  it('rejects a plain throw inside the repro block', () => {
    // The guarantee that stops an unimplemented stub from reading as proof.
    assert.equal(classifyFailure(`${REPRO_MARKER} total\nrepro assertion not implemented`), 'repro-error');
  });

  it('rejects a runtime error inside the repro block', () => {
    const message = `${REPRO_MARKER} total\nTypeError: Cannot read properties of undefined`;
    assert.equal(classifyFailure(message), 'repro-error');
  });

  it('attributes an unresolved locator outside the repro block to the test', () => {
    assert.equal(
      classifyFailure('locator.click: Timeout 5000ms exceeded.\nwaiting for locator(\'#nope\')'),
      'selector',
    );
  });

  it('attributes an unreachable app to navigation', () => {
    assert.equal(classifyFailure('page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3100/'), 'navigation');
  });

  it('attributes a bare test timeout to timeout', () => {
    assert.equal(classifyFailure('Test timeout of 20000ms exceeded.'), 'timeout');
  });

  it('reports no failure for an empty message', () => {
    assert.equal(classifyFailure(null), 'none');
  });
});

describe('judge: red', () => {
  it('certifies a repro-class failure', () => {
    const result = judge('red', outcome('failed', 'repro'));
    assert.equal(result.verdict, 'reproduced');
    assert.equal(result.ok, true);
  });

  it('rejects a passing test as vacuous', () => {
    // A test that passes while the defect is armed would be committed as a guard
    // that guards nothing, so this must never read as success.
    const result = judge('red', outcome('passed', 'none'));
    assert.equal(result.verdict, 'vacuous');
    assert.equal(result.ok, false);
  });

  it('rejects an incidental failure as a misfire', () => {
    for (const kind of ['selector', 'navigation', 'timeout', 'assertion', 'repro-error'] as const) {
      const result = judge('red', outcome('failed', kind));
      assert.equal(result.verdict, 'misfire', `expected misfire for ${kind}`);
      assert.equal(result.ok, false);
    }
  });

  it('reports a runner error as inconclusive', () => {
    assert.equal(judge('red', outcome('error', 'infrastructure')).verdict, 'inconclusive');
    assert.equal(judge('red', outcome('no-tests', 'none')).verdict, 'inconclusive');
  });
});

describe('judge: green', () => {
  it('certifies a pass', () => {
    const result = judge('green', outcome('passed', 'none'));
    assert.equal(result.verdict, 'fixed');
    assert.equal(result.ok, true);
  });

  it('reports a still-failing repro assertion as unfixed', () => {
    const result = judge('green', outcome('failed', 'repro'));
    assert.equal(result.verdict, 'unfixed');
    assert.match(result.reason, /fix is incomplete/);
  });
});

describe('judge: guard', () => {
  it('certifies that the reintroduced defect was caught', () => {
    const result = judge('guard', outcome('failed', 'repro'));
    assert.equal(result.verdict, 'guarding');
    assert.equal(result.ok, true);
  });

  it('rejects a test that misses the reintroduced defect', () => {
    const result = judge('guard', outcome('passed', 'none'));
    assert.equal(result.verdict, 'not-guarding');
    assert.equal(result.ok, false);
  });
});

describe('bugsForPhase', () => {
  it('arms the defect for red and guard, and disarms it for green', () => {
    assert.deepEqual(bugsForPhase('red', 'tax-rounding'), ['tax-rounding']);
    assert.deepEqual(bugsForPhase('guard', 'tax-rounding'), ['tax-rounding']);
    assert.deepEqual(bugsForPhase('green', 'tax-rounding'), []);
  });

  it('arms nothing when the ticket maps to no seeded defect', () => {
    assert.deepEqual(bugsForPhase('red', null), []);
  });
});

describe('phasePlan', () => {
  it('varies the fix and holds arming constant when a source fix exists', () => {
    // The fix is the only variable, so green is the one phase that differs.
    assert.deepEqual(phasePlan('red', 'tax-rounding', true), {
      armedBugs: ['tax-rounding'],
      fixPresent: false,
    });
    assert.deepEqual(phasePlan('green', 'tax-rounding', true), {
      armedBugs: ['tax-rounding'],
      fixPresent: true,
    });
    assert.deepEqual(phasePlan('guard', 'tax-rounding', true), {
      armedBugs: ['tax-rounding'],
      fixPresent: false,
    });
  });

  it('needs no seeded defect when a source fix exists', () => {
    assert.deepEqual(phasePlan('green', null, true), { armedBugs: [], fixPresent: true });
    assert.deepEqual(phasePlan('red', null, true), { armedBugs: [], fixPresent: false });
  });

  it('falls back to toggling arming when no fix exists', () => {
    assert.deepEqual(phasePlan('red', 'tax-rounding', false), {
      armedBugs: ['tax-rounding'],
      fixPresent: false,
    });
    assert.deepEqual(phasePlan('green', 'tax-rounding', false), {
      armedBugs: [],
      fixPresent: false,
    });
  });

  it('leaves red and guard identical under the toggle fallback', () => {
    // The limitation the source strategy exists to remove: with no fix, guard
    // re-runs red's exact inputs and cannot test the fix.
    assert.deepEqual(
      phasePlan('red', 'tax-rounding', false),
      phasePlan('guard', 'tax-rounding', false),
    );
    assert.notDeepEqual(
      phasePlan('red', 'tax-rounding', true),
      phasePlan('green', 'tax-rounding', true),
    );
  });
});

describe('judge: strategy-aware wording', () => {
  it('describes guard as testing the fix only under the source strategy', () => {
    const sourceGuard = judge('guard', outcome('failed', 'repro'), 'source');
    assert.equal(sourceGuard.verdict, 'guarding');
    assert.match(sourceGuard.reason, /Removing the fix/);

    // Under toggle, guard must not claim to have tested anything beyond flakiness.
    const toggleGuard = judge('guard', outcome('failed', 'repro'), 'toggle');
    assert.equal(toggleGuard.verdict, 'guarding');
    assert.match(toggleGuard.reason, /not flaky/);
    assert.doesNotMatch(toggleGuard.reason, /Removing the fix/);
  });

  it('attributes green to the fix under the source strategy', () => {
    assert.match(judge('green', outcome('passed', 'none'), 'source').reason, /with the fix applied/);
    assert.match(judge('green', outcome('passed', 'none'), 'toggle').reason, /defect disarmed/);
  });
});
