/**
 * Cart domain logic for the demo storefront.
 *
 * All money is handled in integer cents. Every function takes the set of armed
 * bug ids so a defect can be switched on without changing call sites.
 */

export const TAX_RATE = 0.08875;

export const CATALOG = [
  { sku: 'lamp', name: 'Aurora Desk Lamp', cents: 3499 },
  { sku: 'mug', name: 'Ridge Ceramic Mug', cents: 1250 },
  { sku: 'notebook', name: 'Field Notebook', cents: 825 },
  { sku: 'bottle', name: 'Trail Water Bottle', cents: 2100 },
];

export const COUPONS = {
  SAVE10: { code: 'SAVE10', kind: 'percent', value: 10, label: '10% off' },
  WELCOME5: { code: 'WELCOME5', kind: 'flat', value: 500, label: '$5.00 off' },
};

export function findProduct(sku) {
  return CATALOG.find((p) => p.sku === sku);
}

export function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Lines shown in the cart list. A zero-quantity line is always hidden. */
export function visibleLines(lines) {
  return lines.filter((line) => line.qty > 0);
}

/**
 * Lines that count toward the subtotal.
 *
 * BUG qty-zero-ghost: the quantity is clamped to a minimum of one, so a line the
 * shopper zeroed out is hidden from the list but still billed for one unit.
 */
export function billableLines(lines, bugs) {
  if (bugs.has('qty-zero-ghost')) {
    return lines.map((line) => ({ ...line, qty: Math.max(line.qty, 1) }));
  }
  return visibleLines(lines);
}

/**
 * Add a coupon code to the applied list.
 *
 * Returns { coupons, error }. On rejection the list is returned unchanged.
 *
 * BUG coupon-restack: the already-applied check is skipped, so submitting the
 * same code twice stacks the discount.
 *
 * BUG coupon-case-sensitive: the entered code is not upper-cased before lookup,
 * so a valid code typed in lowercase is reported as invalid.
 */
export function applyCoupon(coupons, rawCode, bugs) {
  const code = bugs.has('coupon-case-sensitive') ? rawCode.trim() : rawCode.trim().toUpperCase();

  if (!code) {
    return { coupons, error: 'Enter a coupon code.' };
  }
  if (!COUPONS[code]) {
    return { coupons, error: `"${code}" is not a valid coupon code.` };
  }
  if (!bugs.has('coupon-restack') && coupons.includes(code)) {
    return { coupons, error: `"${code}" has already been applied.` };
  }

  return { coupons: [...coupons, code], error: null };
}

export function discountFor(subtotalCents, coupons) {
  return coupons.reduce((acc, code) => {
    const coupon = COUPONS[code];
    if (!coupon) return acc;
    const amount =
      coupon.kind === 'percent'
        ? Math.round((subtotalCents * coupon.value) / 100)
        : coupon.value;
    return acc + amount;
  }, 0);
}

/**
 * Compute the order summary.
 *
 * BUG tax-rounding: tax cents are truncated rather than rounded to nearest, so
 * the total can come out a cent below subtotal + tax.
 */
export function computeTotals(lines, coupons, bugs) {
  const subtotal = billableLines(lines, bugs).reduce(
    (acc, line) => acc + line.cents * line.qty,
    0,
  );

  const discount = Math.min(discountFor(subtotal, coupons), subtotal);
  const taxable = subtotal - discount;

  const exactTax = taxable * TAX_RATE;
  const tax = bugs.has('tax-rounding') ? Math.floor(exactTax) : Math.round(exactTax);

  return { subtotal, discount, tax, total: taxable + tax };
}
