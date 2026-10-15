import { expect, test } from '@playwright/test';

/**
 * Marker stamped onto any error thrown inside a reproAssertion block.
 *
 * This is what lets the verdict engine distinguish "the test failed because the
 * behaviour under test is wrong" from "the test failed because the selector was
 * stale". Without it, a red run that failed on a typo would look identical to a
 * genuine reproduction.
 */
export const REPRO_MARKER = '[bugproof:repro-assertion]';

/**
 * Wrap the assertion that encodes the bug itself.
 *
 * Everything needed to reach the buggy state (navigation, clicks, setup) belongs
 * outside this block; only the check that distinguishes buggy from fixed goes in.
 */
export async function reproAssertion<T>(name: string, body: () => Promise<T>): Promise<T> {
  test.info().annotations.push({ type: 'repro-assertion', description: name });

  return test.step(`[repro] ${name}`, async () => {
    try {
      return await body();
    } catch (error) {
      if (error instanceof Error) {
        error.message = `${REPRO_MARKER} ${name}\n${error.message}`;
      }
      throw error;
    }
  });
}

/** Navigate to the app and wait for the client to finish hydrating. */
export async function openStorefront(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}
