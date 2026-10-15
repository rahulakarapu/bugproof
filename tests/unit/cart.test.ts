import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyCoupon, computeTotals, formatMoney } from '../../app/public/cart.js';

/**
 * The demo app's defects are the fixtures the whole red/green cycle rests on, so
 * each one is pinned here: armed must produce the symptom the ticket describes,
 * and disarmed must produce the correct value.
 */

const mug = { sku: 'mug', name: 'Ridge Ceramic Mug', cents: 1250, qty: 1 };
const lamp = { sku: 'lamp', name: 'Aurora Desk Lamp', cents: 3499, qty: 1 };

const armed = (...ids: string[]) => new Set(ids);
const disarmed = new Set<string>();

describe('tax-rounding', () => {
  it('truncates tax when armed', () => {
    const totals = computeTotals([mug], [], armed('tax-rounding'));
    assert.equal(formatMoney(totals.tax), '$1.10');
    assert.equal(formatMoney(totals.total), '$13.60');
  });

  it('rounds tax to the nearest cent when disarmed', () => {
    const totals = computeTotals([mug], [], disarmed);
    assert.equal(formatMoney(totals.tax), '$1.11');
    assert.equal(formatMoney(totals.total), '$13.61');
  });
});

describe('coupon-restack', () => {
  it('stacks a repeated coupon when armed', () => {
    const bugs = armed('coupon-restack');
    const first = applyCoupon([], 'SAVE10', bugs);
    const second = applyCoupon(first.coupons, 'SAVE10', bugs);
    assert.deepEqual(second.coupons, ['SAVE10', 'SAVE10']);
    assert.equal(second.error, null);
  });

  it('rejects a repeated coupon when disarmed', () => {
    const first = applyCoupon([], 'SAVE10', disarmed);
    const second = applyCoupon(first.coupons, 'SAVE10', disarmed);
    assert.deepEqual(second.coupons, ['SAVE10']);
    assert.match(second.error ?? '', /already been applied/);
  });

  it('rejects unknown codes regardless of arming', () => {
    assert.match(applyCoupon([], 'NOPE', disarmed).error ?? '', /not a valid coupon/);
    assert.match(applyCoupon([], 'NOPE', armed('coupon-restack')).error ?? '', /not a valid coupon/);
  });
});

describe('qty-zero-ghost', () => {
  const zeroedMug = [lamp, { ...mug, qty: 0 }];

  it('bills a zeroed line when armed', () => {
    const totals = computeTotals(zeroedMug, [], armed('qty-zero-ghost'));
    assert.equal(formatMoney(totals.subtotal), '$47.49');
  });

  it('drops a zeroed line when disarmed', () => {
    const totals = computeTotals(zeroedMug, [], disarmed);
    assert.equal(formatMoney(totals.subtotal), '$34.99');
  });
});

describe('discounts', () => {
  it('taxes the discounted subtotal, not the gross subtotal', () => {
    const totals = computeTotals([lamp], ['WELCOME5'], disarmed);
    assert.equal(formatMoney(totals.subtotal), '$34.99');
    assert.equal(formatMoney(totals.discount), '$5.00');
    // 8.875% of $29.99 = $2.661..., rounds to $2.66
    assert.equal(formatMoney(totals.tax), '$2.66');
    assert.equal(formatMoney(totals.total), '$32.65');
  });

  it('never discounts below zero', () => {
    const totals = computeTotals([{ ...mug, cents: 300 }], ['WELCOME5'], disarmed);
    assert.equal(totals.discount, 300);
    assert.equal(totals.total, 0);
  });
});
