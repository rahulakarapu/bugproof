/**
 * Regression guard for tax-rounding: Order total is one cent short on some carts
 * Seeded defect: tax-rounding (cart totals) — Tax is truncated instead of rounded, so the displayed total can be one cent lower than subtotal + tax.
 *
 * Repro plan parsed from the ticket:
 * preconditions:
 *   - Fresh session with an empty cart
 *   - No coupon applied
 * steps:
 *   - Open the storefront
 *   - Click "Add to cart" on the Ridge Ceramic Mug ($12.50)
 *   - Look at the order summary
 * expected:
 *   - Subtotal reads $12.50
 *   - Tax reads $1.11 (8.875% of $12.50 = $1.109375, rounds to $1.11)
 *   - Total reads $13.61
 * actual:
 *   - Tax reads $1.10
 *   - Total reads $13.60, one cent below subtotal + tax
 *
 * Only the check that distinguishes buggy from fixed belongs inside
 * reproAssertion(); setup and navigation stay outside it.
 */
import { expect, test } from '@playwright/test';
import { openStorefront, reproAssertion } from '../support/repro.ts';

test('Order total is one cent short on some carts', async ({ page }) => {
  await openStorefront(page);

  await page.getByTestId('add-mug').click();
  await expect(page.getByTestId('line-mug')).toBeVisible();

  await reproAssertion('total equals subtotal plus tax rounded to the nearest cent', async () => {
    await expect(page.getByTestId('subtotal')).toHaveText('$12.50');
    await expect(page.getByTestId('tax')).toHaveText('$1.11');
    await expect(page.getByTestId('total')).toHaveText('$13.61');
  });
});
