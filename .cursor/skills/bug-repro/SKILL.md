---
name: bug-repro
description: >-
  Turns a bug ticket into a verified Playwright regression test by driving a
  closed red/green/guard cycle: reproduce the reported failure, verify the fix,
  confirm the test catches the bug returning, then commit it with trace evidence
  posted to the ticket. Use when the user references a bug ticket or GitHub issue
  and asks to reproduce it, write a regression test for it, verify a fix, or
  guard against it recurring.
---

# Bug Repro & Regression Agent

Convert a bug ticket into a permanent regression guard. The `bugproof` CLI owns
everything mechanical — fetching tickets, arming defects, running Playwright,
judging results, collecting evidence. Your job is the one part it cannot do:
translating prose repro steps into a Playwright spec.

**Never conclude a bug is reproduced or fixed from reading a test run yourself.**
`bugproof verify` issues the verdict. Trust it over your own reading of the output.

## Workflow

Track progress with this checklist:

```
- [ ] 1. Fetch and read the ticket
- [ ] 2. Scaffold the spec
- [ ] 3. Implement the spec
- [ ] 4. RED: prove the bug
- [ ] 5. Apply the fix
- [ ] 6. GREEN: prove the fix
- [ ] 7. GUARD: prove the guard
- [ ] 8. Publish evidence and commit
```

### 1. Fetch and read the ticket

```bash
bugproof fetch <ref>        # issue number, issue URL, or local ticket name
```

Prints the normalized repro plan and the ticket id to use for every later command.
If it warns about a thin repro plan, read `.bugproof/tickets/<id>.json` for the raw
body before guessing. If the steps are genuinely ambiguous, ask the user rather
than inventing behaviour.

### 2. Scaffold the spec

```bash
bugproof scaffold <ticketId>
```

Writes `tests/regression/<ticketId>.spec.ts` with the repro plan in a header
comment and the assertion left unimplemented.

### 3. Implement the spec

Edit the scaffolded file. This is the only creative step — see
**Writing the spec** below for the rules that make a spec verifiable.

### 4. RED — prove the bug

```bash
bugproof verify <ticketId> --phase red
```

Runs with the defect present. Required verdict: `reproduced`. Anything else means
the spec is wrong, not that the bug is absent — fix the spec and re-run. Consult
the **Verdicts** table for what each result means.

### 5. Apply the fix

Only after red is `reproduced`. Change the source so the reported behaviour is
correct. For seeded defects in the demo app the CLI disarms them automatically, so
no source edit is needed; for real defects, edit the code.

Do not touch the spec during this step. Changing the test and the source together
makes the green result meaningless.

### 6. GREEN — prove the fix

```bash
bugproof verify <ticketId> --phase green
```

Required verdict: `fixed`. A verdict of `unfixed` means the fix is incomplete —
revisit the source, not the test.

### 7. GUARD — prove the guard

```bash
bugproof verify <ticketId> --phase guard
```

Reintroduces the defect and requires the test to fail again, which is what proves
the spec is a real detector rather than a test that happens to pass. Required
verdict: `guarding`.

### 8. Publish evidence and commit

```bash
bugproof evidence <ticketId> --post   # trace/screenshot report onto the ticket
bugproof commit <ticketId>            # refuses unless the cycle is certified
```

## Writing the spec

### The assertion encodes correct behaviour, never buggy behaviour

This is the mistake that breaks the whole cycle. Assert the **expected** values
from the ticket. The ticket's "actual" section describes what is wrong; it is
context, not the assertion.

```ts
// Correct — asserts what the ticket says should happen.
await expect(page.getByTestId('total')).toHaveText('$13.61');

// Wrong — asserts the bug. This passes in red and fails in green, inverting
// the entire cycle while looking like it works.
await expect(page.getByTestId('total')).toHaveText('$13.60');
```

### Only the distinguishing check goes inside `reproAssertion`

`reproAssertion` is how the verdict engine tells "the app is wrong" from "the test
is broken". Navigation, clicks, form filling, and any wait needed to reach the
buggy state belong **outside** it. Inside goes only the check whose result differs
between buggy and fixed.

```ts
import { expect, test } from '@playwright/test';
import { openStorefront, reproAssertion } from '../support/repro.ts';

test('Order total is one cent short on some carts', async ({ page }) => {
  // Setup: outside the block.
  await openStorefront(page);
  await page.getByTestId('add-mug').click();
  await expect(page.getByTestId('line-mug')).toBeVisible();

  // The distinguishing check: inside the block.
  await reproAssertion('total equals subtotal plus tax rounded to the nearest cent', async () => {
    await expect(page.getByTestId('subtotal')).toHaveText('$12.50');
    await expect(page.getByTestId('tax')).toHaveText('$1.11');
    await expect(page.getByTestId('total')).toHaveText('$13.61');
  });
});
```

### Rules

- Use exactly one `reproAssertion` block per spec, with a name describing the
  invariant being checked.
- Assert exact values (`toHaveText('$13.61')`), not existence (`toBeVisible()`).
  A visibility check passes whether or not the bug is present, which produces a
  `vacuous` verdict.
- Never throw a plain `Error` inside `reproAssertion`. Only a real `expect()`
  failure counts as a reproduction; anything else is classified `repro-error`.
- Select with `getByTestId`, `getByRole`, or `getByLabel`. CSS and nth-child
  selectors break and surface as `misfire`.
- Use web-first assertions (`expect(...).toHaveText`) rather than reading
  `textContent` manually, so retries are automatic. Never add fixed sleeps.
- Keep the scaffolded header comment; it is the ticket's repro plan.

## Verdicts

Each phase requires one verdict to continue. Everything else is diagnostic.

| Verdict | Phase | Meaning | What to do |
| --- | --- | --- | --- |
| `reproduced` | red | Repro assertion failed with the defect present | Proceed to the fix |
| `vacuous` | red | Test passed despite the defect | Assertion is not sensitive enough — assert exact values |
| `misfire` | red/guard | Failed before reaching the repro assertion | Fix setup, selectors, or waits |
| `repro-error` | any | Repro block threw a non-assertion error | Replace the throw with a real `expect()` |
| `fixed` | green | Test passed once the defect was gone | Proceed to guard |
| `unfixed` | green | Test still fails | The fix is incomplete; change the source, not the test |
| `guarding` | guard | Failed again when the defect returned | Cycle certified; publish and commit |
| `not-guarding` | guard | Did not catch the reintroduced defect | Strengthen the assertion and restart the cycle |
| `inconclusive` | any | Run errored before testing anything | Fix config or app startup |

A re-run of red discards the recorded green and guard verdicts, because they no
longer describe the current spec.

## Reference

- Demo app markup, test ids, and seeded defects: [demo-app.md](demo-app.md)
- `bugproof verify <id> --phase all` runs the full cycle and stops at the first
  phase that misses its required verdict.
- `bugproof status <id>` replays the recorded cycle without re-running anything.
- `bugproof bugs` lists the seeded defects available in the demo app.
