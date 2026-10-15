/**
 * Regression guard for coupon-restack: Same coupon can be redeemed twice in one order
 * Seeded defect: coupon-restack (coupons) — Re-submitting an already-applied coupon code stacks the discount again instead of being rejected.
 *
 * Repro plan parsed from the ticket:
 * steps:
 *   - Add the Aurora Desk Lamp to the cart
 *   - Type SAVE10 into the coupon field and press Apply
 *   - Type SAVE10 into the coupon field again and press Apply a second time
 * expected:
 *   - The second attempt is rejected with an "already been applied" message, and the discount stays at 10%.
 * actual:
 *   - The code is accepted again. The applied-coupons list shows SAVE10 twice and the discount doubles to 20% of subtotal.
 *
 * Only the check that distinguishes buggy from fixed belongs inside
 * reproAssertion(); setup and navigation stay outside it.
 */
import { expect, test } from '@playwright/test';
import { openStorefront, reproAssertion } from '../support/repro.ts';

test('Same coupon can be redeemed twice in one order', async ({ page }) => {
  await openStorefront(page);

  await page.getByTestId('add-lamp').click();

  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('coupon-apply').click();
  await expect(page.getByTestId('applied-coupon-0')).toContainText('SAVE10');

  await page.getByTestId('coupon-input').fill('SAVE10');
  await page.getByTestId('coupon-apply').click();

  await reproAssertion('a repeated coupon is rejected and the discount stays at 10%', async () => {
    await expect(page.getByTestId('coupon-error')).toContainText('already been applied');
    await expect(page.getByTestId('applied-coupons').getByRole('listitem')).toHaveCount(1);
    // 10% of $34.99, rounded to the nearest cent.
    await expect(page.getByTestId('discount')).toHaveText('$3.50');
  });
});
