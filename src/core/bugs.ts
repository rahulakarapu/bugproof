/**
 * Registry of seeded defects in the demo app.
 *
 * Each entry can be armed or disarmed at runtime via the BUGPROOF_BUGS env var,
 * which is what makes the red/green cycle deterministic and replayable: "red"
 * runs the app with the defect armed, "green" runs it disarmed.
 */

export interface SeededBug {
  /** Stable identifier, also the value used in BUGPROOF_BUGS. */
  id: string;
  title: string;
  /** Where in the demo app the defect lives. */
  area: string;
  /** What goes wrong when armed. */
  symptom: string;
  /** The underlying mistake, for the write-up in the ticket. */
  rootCause: string;
}

export const SEEDED_BUGS: readonly SeededBug[] = [
  {
    id: 'tax-rounding',
    title: 'Order total is a cent short on some subtotals',
    area: 'cart totals',
    symptom:
      'Tax is truncated instead of rounded, so the displayed total can be one cent lower than subtotal + tax.',
    rootCause: 'Math.floor on tax cents instead of Math.round.',
  },
  {
    id: 'coupon-restack',
    title: 'Same coupon can be applied more than once',
    area: 'coupons',
    symptom:
      'Re-submitting an already-applied coupon code stacks the discount again instead of being rejected.',
    rootCause: 'Coupon apply handler never checks whether the code is already present.',
  },
  {
    id: 'qty-zero-ghost',
    title: 'Setting quantity to zero leaves the item in the subtotal',
    area: 'cart line items',
    symptom:
      'A line set to quantity 0 disappears from the list but its price is still counted in the subtotal.',
    rootCause: 'Row is filtered out of the render pass but not out of the totals reducer.',
  },
] as const;

export const SEEDED_BUG_IDS: readonly string[] = SEEDED_BUGS.map((b) => b.id);

export function findSeededBug(id: string): SeededBug | undefined {
  return SEEDED_BUGS.find((b) => b.id === id);
}

/** Parse the comma-separated BUGPROOF_BUGS value into a deduped list of ids. */
export function parseArmedBugs(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/** Throw on unknown ids so a typo in a bug name fails loudly instead of silently disarming. */
export function assertKnownBugs(ids: readonly string[]): void {
  const unknown = ids.filter((id) => !findSeededBug(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown seeded bug id(s): ${unknown.join(', ')}. Known ids: ${SEEDED_BUG_IDS.join(', ')}`,
    );
  }
}
