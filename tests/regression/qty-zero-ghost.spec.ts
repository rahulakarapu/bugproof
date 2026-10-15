/**
 * Regression guard for qty-zero-ghost: Zeroing an item's quantity still charges for it
 * Seeded defect: qty-zero-ghost (cart line items) — A line set to quantity 0 disappears from the list but its price is still counted in the subtotal.
 *
 * Repro plan parsed from the ticket:
 * preconditions:
 *   - Cart contains two different products
 * steps:
 *   - Add the Aurora Desk Lamp ($34.99) to the cart
 *   - Add the Ridge Ceramic Mug ($12.50) to the cart
 *   - Set the mug's quantity input to 0
 * expected:
 *   - The mug row disappears and the subtotal drops to $34.99 (lamp only).
 * actual:
 *   - The mug row disappears from the list, but the subtotal stays at $47.49 — the shopper is still billed for one mug they can no longer see or edit.
 *
 * Only the check that distinguishes buggy from fixed belongs inside
 * reproAssertion(); setup and navigation stay outside it.
 */
import { expect, test } from '@playwright/test';
import { openStorefront, reproAssertion } from '../support/repro.ts';

test("Zeroing an item's quantity still charges for it", async ({ page }) => {
  await openStorefront(page);

  await page.getByTestId('add-lamp').click();
  await page.getByTestId('add-mug').click();
  await expect(page.getByTestId('subtotal')).toHaveText('$47.49');

  await page.getByTestId('qty-mug').fill('0');
  // Tab out so the input's change handler runs.
  await page.getByTestId('qty-mug').press('Tab');

  await reproAssertion('a zeroed line leaves the subtotal as well as the list', async () => {
    await expect(page.getByTestId('line-mug')).toHaveCount(0);
    await expect(page.getByTestId('subtotal')).toHaveText('$34.99');
  });
});
