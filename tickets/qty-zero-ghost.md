# Zeroing an item's quantity still charges for it

Seeded-Bug: qty-zero-ghost

### Setup
- Cart contains two different products

### To reproduce
1. Add the Aurora Desk Lamp ($34.99) to the cart
2. Add the Ridge Ceramic Mug ($12.50) to the cart
3. Set the mug's quantity input to 0

### Expected result
The mug row disappears and the subtotal drops to $34.99 (lamp only).

### Observed behaviour
The mug row disappears from the list, but the subtotal stays at $47.49 — the
shopper is still billed for one mug they can no longer see or edit.
