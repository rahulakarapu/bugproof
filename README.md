# Bugproof — Bug Repro & Regression Agent

A Cursor agent skill that turns bug tickets into executable Playwright regression
tests. It parses the repro steps, generates a test that **reproduces the failure
(red)**, **verifies the fix (green)**, **confirms the test catches the bug
returning (guard)**, and commits it as a permanent regression guard with trace and
screenshot evidence posted back to the ticket.

The differentiator is the closed loop: a test is only committed once it has been
proven to fail on the bug *and* pass on the fix *and* fail again when the bug is
reintroduced.

```
┌── fetch ──┐   ┌── scaffold ──┐   ┌─ RED ─┐   ┌─ fix ─┐   ┌─ GREEN ─┐   ┌─ GUARD ─┐   ┌─ commit ─┐
│  ticket → │ → │  spec stub → │ → │ must  │ → │ apply │ → │  must   │ → │  must   │ → │ evidence │
│ repro plan│   │ (agent fills)│   │ fail  │   │  fix  │   │  pass   │   │  fail   │   │ + guard  │
└───────────┘   └──────────────┘   └───────┘   └───────┘   └─────────┘   └─────────┘   └──────────┘
```

## Why the guard phase exists

A test that passes is not evidence of anything. Three failure modes silently
produce a useless regression guard, and each one gets its own verdict:

| Failure mode | What it looks like | Verdict |
| --- | --- | --- |
| The test never exercises the bug | Passes even with the defect present | `vacuous` |
| The test fails for the wrong reason | Stale selector, unreachable app, timeout | `misfire` |
| The assertion is not sensitive enough | Passes again when the defect is reintroduced | `not-guarding` |

The engine attributes every failure to a cause rather than reading pass/fail. A
red run only counts when the failure came from an `expect()` inside the test's
designated repro assertion — so an unimplemented stub, a `TypeError`, or a broken
locator can never masquerade as a reproduction.

## Quick start

```bash
npm install
npx playwright install chromium

# Run the whole cycle against a bundled bug report
bugproof fetch tax-rounding
bugproof scaffold tax-rounding      # writes tests/regression/tax-rounding.spec.ts
# ...agent implements the spec...
bugproof verify tax-rounding --phase all
bugproof evidence tax-rounding      # add --post to comment on the ticket
bugproof commit tax-rounding
```

Output of the full cycle:

```
RED — prove the bug — defect armed, test must fail at its repro assertion
  arming: tax-rounding
✓ reproduced — run failed, failure class: repro

GREEN — prove the fix — defect disarmed, test must pass
  arming: none (all defects disarmed)
✓ fixed — run passed

GUARD — prove the guard — defect re-armed, test must fail again
  arming: tax-rounding
✓ guarding — run failed, failure class: repro

✓ certified — the test fails on the bug, passes on the fix, and catches the bug returning
```

## How it works

### Ticket sources

`bugproof fetch` normalizes a bug report into preconditions / steps / expected /
actual, tolerating the formats people actually use — markdown headings,
`**Expected:**` pseudo-headings, hard-wrapped prose. Sources sit behind a
`TicketSource` interface (`src/sources/`), so adding Jira or Linear means
implementing `handles`, `fetch`, and `comment` and nothing else.

- **GitHub Issues** via the `gh` CLI — accepts `42`, `owner/repo#42`, or a full URL
- **Local markdown** in `tickets/` — used for offline demos and the seeded defects

### Attributing failures

`tests/support/repro.ts` exports `reproAssertion(name, fn)`, which wraps the one
check that distinguishes buggy from fixed. It stamps any error thrown inside with
a marker, and the runner uses that marker *plus* the shape of the message to
classify the failure:

| Class | Meaning |
| --- | --- |
| `repro` | An `expect()` inside the repro block failed — the app is wrong |
| `repro-error` | The repro block threw a non-assertion error — proves nothing |
| `selector` | A locator never resolved — the test is broken |
| `navigation` | The app was unreachable |
| `timeout` | The test ran out of budget without a specific assertion failing |
| `assertion` | An assertion outside the repro block failed — setup is wrong |

Only `repro` can certify a red or guard phase.

### Arming defects

The demo storefront (`app/`) carries three seeded defects, each a single branch in
`app/public/cart.js` guarded by `bugs.has('<id>')` and armed at runtime via
`BUGPROOF_BUGS`. That makes red/green/guard deterministic and replayable without
rewriting source between phases:

| Id | Symptom |
| --- | --- |
| `tax-rounding` | Tax truncated instead of rounded, so the total can be a cent low |
| `coupon-restack` | The same coupon code can be applied more than once |
| `qty-zero-ghost` | A line set to quantity 0 vanishes but is still billed |

For a real codebase there is nothing to arm: red runs against the unfixed source,
green against the fixed source, and the operator applies the fix between phases.

### Evidence

Traces, screenshots, and video are captured on **every** run including passes,
because they are the deliverable rather than a debugging aid. `bugproof evidence
--post` renders them into a ticket comment with each phase's verdict, the failure
output, and links to the artifacts.

## Commands

| Command | Purpose |
| --- | --- |
| `bugproof fetch <ref>` | Load a ticket and normalize its repro steps |
| `bugproof scaffold <id>` | Generate the spec skeleton |
| `bugproof verify <id> --phase red\|green\|guard\|all` | Run a phase and judge it |
| `bugproof evidence <id> [--post]` | Render the evidence report |
| `bugproof commit <id>` | Commit the certified guard |
| `bugproof status <id>` | Replay the recorded cycle |
| `bugproof list` | Show fetched tickets and cycle state |
| `bugproof bugs` | List the seeded defects |

`verify --phase all` exits non-zero unless the cycle certifies, so CI can gate on it.

## The Cursor skill

`.cursor/skills/bug-repro/SKILL.md` drives the agent through the workflow. The
division of labour is deliberate: deterministic TypeScript owns everything
mechanical — fetching, arming, running, judging, collecting evidence — and the
agent owns only the part that needs judgement, translating prose repro steps into
a Playwright spec. The skill's hardest-won rule is that the assertion must encode
the **expected** behaviour from the ticket, never the buggy behaviour; asserting
the bug produces a test that passes red and fails green, inverting the cycle while
appearing to work.

## Layout

```
app/                      Demo storefront with runtime-armable defects
src/
  cli.ts                  Command surface
  commands/               fetch, scaffold, verify, evidence, commit, status
  core/
    ticket.ts             Prose bug report → structured repro plan
    runner.ts             Playwright invocation + failure classification
    verdict.ts            Verdict engine
    journal.ts            Durable cycle state
    evidence.ts           Trace collection + ticket report
    bugs.ts               Seeded defect registry
  sources/                TicketSource adapters (github, local)
tests/
  support/repro.ts        reproAssertion harness
  regression/             Generated, certified regression guards
  unit/                   node:test coverage of parser, classifier, verdict engine
tickets/                  Bug report fixtures
.cursor/skills/bug-repro/ The agent skill
```

## Development

```bash
npm run typecheck
npm run test:unit    # parser, failure classifier, verdict engine, cart invariants
npm run test:e2e     # the committed regression guards, all defects disarmed
npm run app          # BUGPROOF_BUGS=tax-rounding npm run app to browse a defect
```
