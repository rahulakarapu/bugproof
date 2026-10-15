# Same coupon can be redeemed twice in one order

Seeded-Bug: coupon-restack

**Steps to reproduce:**

- Add the Aurora Desk Lamp to the cart
- Type `SAVE10` into the coupon field and press Apply
- Type `SAVE10` into the coupon field again and press Apply a second time

**Expected:** The second attempt is rejected with an "already been applied"
message, and the discount stays at 10%.

**Actual:** The code is accepted again. The applied-coupons list shows SAVE10
twice and the discount doubles to 20% of subtotal.

**Impact:** Discount abuse. Someone posted this on Reddit.
