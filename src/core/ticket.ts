import { SEEDED_BUG_IDS } from './bugs.ts';
import type { ReproPlan } from './types.ts';

/**
 * Bug reports are prose, not structured data. This parser pulls the four things
 * a test generator actually needs out of whatever shape the reporter used.
 *
 * It is deliberately forgiving: unknown sections are ignored, and a section with
 * no bullet list falls back to its non-empty prose lines.
 */

type Section = 'preconditions' | 'steps' | 'expected' | 'actual' | null;

const SECTION_PATTERNS: ReadonlyArray<[Section, RegExp]> = [
  ['preconditions', /^(preconditions?|pre-?requisites?|setup|given|environment)\b/i],
  ['steps', /^(steps?\s*(to\s*reproduce)?|repro(duction)?\s*steps?|to\s*reproduce|how\s*to\s*reproduce)\b/i],
  ['expected', /^(expected(\s*(behavio(u)?r|result|outcome))?)\b/i],
  ['actual', /^(actual(\s*(behavio(u)?r|result|outcome))?|observed(\s*behavio(u)?r)?|current\s*behavio(u)?r)\b/i],
];

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s*(.+?)\s*:?\s*$/;
/** Bolded or plain line used as a pseudo-heading, e.g. "**Expected:**" or "Actual:". */
const INLINE_HEADING = /^\s*(?:\*\*|__)?\s*([A-Za-z][A-Za-z\s/-]{2,40}?)\s*(?:\*\*|__)?\s*:\s*(.*)$/;

function matchSection(text: string): Section {
  for (const [section, pattern] of SECTION_PATTERNS) {
    if (pattern.test(text.trim())) return section;
  }
  return null;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

/**
 * Drop bold markers before anything else looks at the line.
 *
 * Reporters write `**Expected:**` as often as `## Expected`, and in that form the
 * colon sits inside the emphasis, so the closing `**` would otherwise be captured
 * as the section's first value.
 */
function normalizeEmphasis(line: string): string {
  return line.replace(/\*\*/g, '');
}

/** Find an explicit `Seeded-Bug: <id>` marker, or infer from any mentioned bug id. */
export function detectSeededBug(body: string, labels: readonly string[] = []): string | null {
  const explicit = body.match(/seeded[-_\s]?bug\s*:\s*([a-z0-9-]+)/i);
  if (explicit?.[1] && SEEDED_BUG_IDS.includes(explicit[1])) return explicit[1];

  for (const label of labels) {
    const fromLabel = label.replace(/^seeded[:/]/i, '');
    if (SEEDED_BUG_IDS.includes(fromLabel)) return fromLabel;
  }

  return SEEDED_BUG_IDS.find((id) => new RegExp(`\\b${id}\\b`).test(body)) ?? null;
}

export function parseReproPlan(body: string, labels: readonly string[] = []): ReproPlan {
  const buckets: Record<Exclude<Section, null>, string[]> = {
    preconditions: [],
    steps: [],
    expected: [],
    actual: [],
  };

  let current: Section = null;
  let inCodeFence = false;
  /** Whether a plain line should continue the previous entry or start a new one. */
  let continuing = false;

  const append = (section: Exclude<Section, null>, text: string): void => {
    const bucket = buckets[section];
    const last = bucket.at(-1);
    if (continuing && last !== undefined) {
      // Hard-wrapped prose: join rather than emit sentence fragments.
      bucket[bucket.length - 1] = `${last} ${text}`;
    } else {
      bucket.push(text);
    }
  };

  for (const rawLine of body.split(/\r?\n/)) {
    if (/^\s*```/.test(rawLine)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const line = normalizeEmphasis(rawLine).trimEnd();

    // A blank line ends a paragraph, so the next line starts a fresh entry.
    if (!line.trim()) {
      continuing = false;
      continue;
    }

    const heading = line.match(HEADING);
    if (heading?.[1]) {
      current = matchSection(stripMarkdown(heading[1]));
      continuing = false;
      continue;
    }

    const listItem = line.match(LIST_ITEM);
    if (listItem?.[1]) {
      if (current) {
        buckets[current].push(stripMarkdown(listItem[1]));
        continuing = true;
      }
      continue;
    }

    const inline = line.match(INLINE_HEADING);
    if (inline?.[1]) {
      const section = matchSection(inline[1]);
      if (section) {
        current = section;
        // "Expected: $13.61" carries its content on the same line.
        const trailing = stripMarkdown(inline[2] ?? '');
        continuing = false;
        if (trailing) {
          buckets[section].push(trailing);
          continuing = true;
        }
      } else {
        // An unrecognised pseudo-heading ("Impact:", "Notes:") ends the section,
        // so its prose does not get absorbed into the previous one.
        current = null;
        continuing = false;
      }
      continue;
    }

    if (!current) continue;
    const text = stripMarkdown(line);
    if (!text) continue;
    append(current, text);
    continuing = true;
  }

  return {
    preconditions: buckets.preconditions,
    steps: buckets.steps,
    expected: buckets.expected,
    actual: buckets.actual,
    seededBug: detectSeededBug(body, labels),
    raw: body.trim(),
  };
}

/** True when there is enough structure to generate a meaningful test. */
export function planIsActionable(plan: ReproPlan): boolean {
  return plan.steps.length > 0 && (plan.expected.length > 0 || plan.actual.length > 0);
}

export function describePlanGaps(plan: ReproPlan): string[] {
  const gaps: string[] = [];
  if (plan.steps.length === 0) gaps.push('no reproduction steps found');
  if (plan.expected.length === 0) gaps.push('no expected behaviour found');
  if (plan.actual.length === 0) gaps.push('no actual behaviour found');
  return gaps;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
