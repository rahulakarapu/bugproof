# Demo app reference

A small storefront (`app/`) served by `app/server.ts`. Cart math lives in
`app/public/cart.js`; DOM wiring in `app/public/ui.js`. All money is integer cents
internally and rendered as `$0.00`.

`openStorefront(page)` from `tests/support/repro.ts` navigates to `/` and waits for
`body[data-ready="true"]`, so no manual waiting is needed after it.

## Test ids

| Selector | Element |
| --- | --- |
| `add-<sku>` | "Add to cart" button in the catalog |
| `product-<sku>` | Catalog row |
| `cart-lines` | Cart line list |
| `line-<sku>` | Cart line for one product |
| `qty-<sku>` | Quantity number input for a line (fire `change`, e.g. `fill()` then `blur()`) |
| `line-total-<sku>` | Extended price for a line |
| `cart-empty` | Empty-cart message |
| `coupon-input` | Coupon code field |
| `coupon-apply` | Apply button |
| `coupon-error` | Coupon rejection message (hidden when empty) |
| `applied-coupons` | List of applied coupons |
| `applied-coupon-<index>` | One applied coupon, zero-indexed |
| `subtotal`, `discount`, `tax`, `total` | Order summary amounts |
| `armed-bugs-label` | Footer listing the defects armed for this run |

SKUs: `lamp` ($34.99), `mug` ($12.50), `notebook` ($8.25), `bottle` ($21.00).
Coupons: `SAVE10` (10% off), `WELCOME5` ($5.00 off). Tax is 8.875%, applied to
subtotal minus discount.

## Seeded defects

Armed per phase by `bugproof verify` via `BUGPROOF_BUGS`; the app reads that
variable at startup and injects it into the page.

| Id | Symptom |
| --- | --- |
| `tax-rounding` | Tax truncated instead of rounded, so the total can be a cent low |
| `coupon-restack` | The same coupon code can be applied more than once |
| `coupon-case-sensitive` | A valid code typed in lowercase is rejected as invalid |
| `qty-zero-ghost` | A line set to quantity 0 vanishes but is still billed for one unit |

Run the app manually with a defect armed:

```bash
BUGPROOF_BUGS=tax-rounding npm run app
```

Each defect is a single branch in `app/public/cart.js` guarded by
`bugs.has('<id>')`, which is what lets the same binary serve both the buggy and
fixed behaviour without a rebuild.
