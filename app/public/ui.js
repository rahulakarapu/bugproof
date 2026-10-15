import {
  CATALOG,
  COUPONS,
  applyCoupon,
  computeTotals,
  findProduct,
  formatMoney,
  visibleLines,
} from '/cart.js';

// Guard against the un-substituted placeholder: a bare string would otherwise
// become a Set of characters and silently arm nothing.
const bugs = new Set(Array.isArray(window.__ARMED_BUGS__) ? window.__ARMED_BUGS__ : []);

const state = {
  lines: [],
  coupons: [],
  couponError: null,
};

const $ = (selector) => document.querySelector(selector);
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

function addToCart(sku) {
  const existing = state.lines.find((line) => line.sku === sku);
  if (existing) {
    existing.qty += 1;
  } else {
    const product = findProduct(sku);
    if (!product) return;
    state.lines.push({ ...product, qty: 1 });
  }
  render();
}

function setQuantity(sku, qty) {
  const line = state.lines.find((l) => l.sku === sku);
  if (!line) return;
  line.qty = Number.isFinite(qty) && qty >= 0 ? Math.trunc(qty) : 0;
  render();
}

function renderCatalog() {
  const list = byTestId('catalog');
  list.innerHTML = '';
  for (const product of CATALOG) {
    const li = document.createElement('li');
    li.dataset.testid = `product-${product.sku}`;
    li.innerHTML = `
      <span class="name">${product.name}</span>
      <span class="price">${formatMoney(product.cents)}</span>
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Add to cart';
    button.dataset.testid = `add-${product.sku}`;
    button.addEventListener('click', () => addToCart(product.sku));
    li.append(button);
    list.append(li);
  }
}

function renderLines() {
  const list = byTestId('cart-lines');
  const shown = visibleLines(state.lines);

  list.innerHTML = '';
  byTestId('cart-empty').hidden = shown.length > 0;

  for (const line of shown) {
    const li = document.createElement('li');
    li.dataset.testid = `line-${line.sku}`;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = line.name;

    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '0';
    qty.value = String(line.qty);
    qty.dataset.testid = `qty-${line.sku}`;
    qty.setAttribute('aria-label', `Quantity for ${line.name}`);
    qty.addEventListener('change', (event) => {
      setQuantity(line.sku, Number(event.target.value));
    });

    const lineTotal = document.createElement('span');
    lineTotal.className = 'price';
    lineTotal.dataset.testid = `line-total-${line.sku}`;
    lineTotal.textContent = formatMoney(line.cents);

    li.append(name, qty, lineTotal);
    list.append(li);
  }
}

function renderCoupons() {
  const list = byTestId('applied-coupons');
  list.innerHTML = '';
  for (const [index, code] of state.coupons.entries()) {
    const li = document.createElement('li');
    li.dataset.testid = `applied-coupon-${index}`;
    li.textContent = `${code} — ${COUPONS[code]?.label ?? ''}`;
    list.append(li);
  }

  const error = byTestId('coupon-error');
  error.textContent = state.couponError ?? '';
  error.hidden = !state.couponError;
}

function renderSummary() {
  const { subtotal, discount, tax, total } = computeTotals(state.lines, state.coupons, bugs);
  byTestId('subtotal').textContent = formatMoney(subtotal);
  byTestId('discount').textContent = formatMoney(discount);
  byTestId('tax').textContent = formatMoney(tax);
  byTestId('total').textContent = formatMoney(total);
}

function render() {
  renderLines();
  renderCoupons();
  renderSummary();
}

byTestId('coupon-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = byTestId('coupon-input');
  const result = applyCoupon(state.coupons, input.value, bugs);
  state.coupons = result.coupons;
  state.couponError = result.error;
  if (!result.error) input.value = '';
  render();
});

renderCatalog();
render();

byTestId('armed-bugs-label').textContent =
  bugs.size > 0 ? `armed defects: ${[...bugs].join(', ')}` : 'all defects disarmed';

// Tests wait on this instead of an arbitrary timeout.
document.body.dataset.ready = 'true';
