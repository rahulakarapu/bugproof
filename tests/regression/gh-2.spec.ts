/**
 * Regression guard for gh-2: Line total ignores quantity in the cart
 *
 * Ticket: https://github.com/rahulakarapu/bugproof/issues/2
 *
 * Repro plan parsed from the ticket:
 * preconditions:
 *   - Empty cart, no coupon applied
 * steps:
 *   - Add the Ridge Ceramic Mug ($12.50) to the cart
 *   - Set the mug's quantity to 2
 *   - Compare the line price against the subtotal
 * expected:
 *   - The mug's line price reads $25.00, matching the subtotal of $25.00.
 * actual:
 *   - The line price still reads $12.50 while the subtotal reads $25.00. The line looks like it is priced per unit, so customers think they are being overcharged.
 *
 * Only the check that distinguishes buggy from fixed belongs inside
 * reproAssertion(); setup and navigation stay outside it.
 */
import { expect, test } from '@playwright/test';
import { openStorefront, reproAssertion } from '../support/repro.ts';

test('Line total ignores quantity in the cart', async ({ page }) => {
  await openStorefront(page);

  await page.getByTestId('add-mug').click();
  await expect(page.getByTestId('line-mug')).toBeVisible();

  await page.getByTestId('qty-mug').fill('2');
  await page.getByTestId('qty-mug').press('Tab');
  await expect(page.getByTestId('subtotal')).toHaveText('$25.00');

  await reproAssertion('the line price is the extended price, not the unit price', async () => {
    await expect(page.getByTestId('line-total-mug')).toHaveText('$25.00');
  });
});
