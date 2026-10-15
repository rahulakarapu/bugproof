import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { detectSeededBug, parseReproPlan, planIsActionable } from '../../src/core/ticket.ts';

describe('parseReproPlan', () => {
  it('reads markdown headings', () => {
    const plan = parseReproPlan(`
## Steps to reproduce
1. Open the storefront
2. Add the mug

## Expected behaviour
- Total reads $13.61

## Actual behaviour
- Total reads $13.60
`);

    assert.deepEqual(plan.steps, ['Open the storefront', 'Add the mug']);
    assert.deepEqual(plan.expected, ['Total reads $13.61']);
    assert.deepEqual(plan.actual, ['Total reads $13.60']);
  });

  it('reads bold pseudo-headings without leaking emphasis markers', () => {
    const plan = parseReproPlan(`
**Steps to reproduce:**

- Add the lamp
- Apply SAVE10

**Expected:** The second attempt is rejected.
`);

    assert.deepEqual(plan.steps, ['Add the lamp', 'Apply SAVE10']);
    assert.deepEqual(plan.expected, ['The second attempt is rejected.']);
  });

  it('joins hard-wrapped prose into one entry', () => {
    const plan = parseReproPlan(`
### Observed behaviour
The mug row disappears from the list, but the subtotal stays at $47.49 — the
shopper is still billed for one mug.
`);

    assert.equal(plan.actual.length, 1);
    assert.match(plan.actual[0] ?? '', /subtotal stays at \$47\.49 — the shopper is still billed/);
  });

  it('does not absorb unrecognised trailing sections', () => {
    const plan = parseReproPlan(`
**Actual:** The code is accepted again.

**Impact:** Discount abuse.
`);

    assert.deepEqual(plan.actual, ['The code is accepted again.']);
  });

  it('separates paragraphs on blank lines', () => {
    const plan = parseReproPlan(`
## Expected
First expectation.

Second expectation.
`);

    assert.deepEqual(plan.expected, ['First expectation.', 'Second expectation.']);
  });

  it('ignores fenced code blocks', () => {
    const plan = parseReproPlan(`
## Steps
- Run the app

\`\`\`
## Expected
not a real section
\`\`\`
`);

    assert.deepEqual(plan.steps, ['Run the app']);
    assert.deepEqual(plan.expected, []);
  });
});

describe('detectSeededBug', () => {
  it('prefers an explicit marker', () => {
    assert.equal(detectSeededBug('Seeded-Bug: tax-rounding'), 'tax-rounding');
  });

  it('reads a label', () => {
    assert.equal(detectSeededBug('no marker here', ['seeded:coupon-restack']), 'coupon-restack');
  });

  it('falls back to a mention in the body', () => {
    assert.equal(detectSeededBug('probably the qty-zero-ghost defect'), 'qty-zero-ghost');
  });

  it('returns null for unknown ids', () => {
    assert.equal(detectSeededBug('Seeded-Bug: not-a-real-bug'), null);
  });
});

describe('planIsActionable', () => {
  it('requires steps and at least one behaviour description', () => {
    const base = { preconditions: [], seededBug: null, raw: '' };
    assert.equal(planIsActionable({ ...base, steps: [], expected: ['x'], actual: [] }), false);
    assert.equal(planIsActionable({ ...base, steps: ['x'], expected: [], actual: [] }), false);
    assert.equal(planIsActionable({ ...base, steps: ['x'], expected: ['y'], actual: [] }), true);
  });
});
