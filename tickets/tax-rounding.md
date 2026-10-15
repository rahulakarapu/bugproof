# Order total is one cent short on some carts

Seeded-Bug: tax-rounding

A customer in #support flagged that their emailed receipt didn't match the total
shown at checkout. Reproduces every time on a single-mug cart.

## Preconditions

- Fresh session with an empty cart
- No coupon applied

## Steps to reproduce

1. Open the storefront
2. Click "Add to cart" on the Ridge Ceramic Mug ($12.50)
3. Look at the order summary

## Expected behaviour

- Subtotal reads $12.50
- Tax reads $1.11 (8.875% of $12.50 = $1.109375, rounds to $1.11)
- Total reads $13.61

## Actual behaviour

- Tax reads $1.10
- Total reads $13.60, one cent below subtotal + tax

## Notes

Finance cares about this one because the penny gap compounds across the daily
settlement report. Probably a truncation somewhere in the tax math.
