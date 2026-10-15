/**
 * Regression guard for gh-1: Lowercase coupon codes are rejected as invalid
 *
 * Ticket: https://github.com/rahulakarapu/bugproof/issues/1
 * Seeded defect: coupon-case-sensitive (coupons) — A valid code typed in lowercase is rejected with "not a valid coupon code" instead of being applied.
 *
 * Repro plan parsed from the ticket:
 * preconditions:
 *   - Cart contains the Aurora Desk Lamp ($34.99)
 * steps:
 *   - Add the Aurora Desk Lamp to the cart
 *   - Type save10 in lowercase into the coupon field
 *   - Press Apply
 * expected:
 *   - The code is accepted exactly as if SAVE10 had been typed: it shows up in the applied-coupons list and the discount reads $3.50.
 * actual:
 *   - The code is rejected with "save10" is not a valid coupon code. and no discount is applied.
 *
 * Only the check that distinguishes buggy from fixed belongs inside
 * reproAssertion(); setup and navigation stay outside it.
 */
import { expect, test } from '@playwright/test';
import { openStorefront, reproAssertion } from '../support/repro.ts';

test('Lowercase coupon codes are rejected as invalid', async ({ page }) => {
  await openStorefront(page);

  await page.getByTestId('add-lamp').click();
  await expect(page.getByTestId('line-lamp')).toBeVisible();

  await page.getByTestId('coupon-input').fill('save10');
  await page.getByTestId('coupon-apply').click();

  await reproAssertion('a lowercase coupon code is accepted like its upper-case form', async () => {
    await expect(page.getByTestId('coupon-error')).toBeHidden();
    await expect(page.getByTestId('applied-coupon-0')).toContainText('SAVE10');
    // 10% of $34.99, rounded to the nearest cent.
    await expect(page.getByTestId('discount')).toHaveText('$3.50');
  });
});
