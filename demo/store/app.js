/* AgentReady Demo Store — deliberately ordinary vanilla TS, compiled by tsc. */
const PRODUCTS = [
    { id: 'k1', name: 'MechKeyboard Pro', category: 'Keyboards', price: 149, rating: 4.8 },
    { id: 'k2', name: 'Compact 65% Board', category: 'Keyboards', price: 89, rating: 4.4 },
    { id: 'k3', name: 'Silent Low-Profile KB', category: 'Keyboards', price: 119, rating: 4.6 },
    { id: 'm1', name: 'Precision Mouse XL', category: 'Mice', price: 79, rating: 4.7 },
    { id: 'm2', name: 'Travel Mouse Mini', category: 'Mice', price: 45, rating: 4.2 },
    { id: 'mo1', name: 'Ultrawide Monitor 34"', category: 'Monitors', price: 699, rating: 4.9 },
    { id: 'mo2', name: '4K Monitor 27"', category: 'Monitors', price: 379, rating: 4.5 },
    { id: 'a1', name: 'Studio Headphones', category: 'Audio', price: 199, rating: 4.6 },
    { id: 'a2', name: 'Conference Speaker', category: 'Audio', price: 129, rating: 4.3 },
    { id: 'k4', name: 'Ergo Split Keyboard', category: 'Keyboards', price: 229, rating: 4.7 },
    { id: 'm3', name: 'Vertical Ergo Mouse', category: 'Mice', price: 69, rating: 4.1 },
    { id: 'a3', name: 'USB Podcast Mic', category: 'Audio', price: 99, rating: 4.4 },
];
const state = {
    cart: [],
    orders: [],
    view: 'products',
};
const $ = (sel) => document.querySelector(sel);
function money(n) {
    return `$${n.toLocaleString('en-US')}`;
}
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function renderProducts() {
    const q = $('#q').value.trim().toLowerCase();
    const cat = $('#category').value;
    const max = parseFloat($('#max_price').value);
    const hits = PRODUCTS.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) &&
        (!cat || p.category === cat) &&
        (Number.isNaN(max) || p.price <= max));
    $('#results').innerHTML = hits.length
        ? hits
            .map((p) => `
      <article class="card" data-id="${p.id}">
        <h3>${escapeHtml(p.name)}</h3>
        <p class="muted">${p.category} · ★ ${p.rating}</p>
        <p class="price">${money(p.price)}</p>
        <button class="add" data-add="${p.id}" aria-label="Add ${escapeHtml(p.name)} to cart">Add to cart</button>
      </article>`)
            .join('')
        : '<p class="muted">No products match your search.</p>';
}
function renderCart() {
    $('#cart-count').textContent = String(state.cart.length);
    $('#cart-items').innerHTML = state.cart.length
        ? state.cart
            .map((i) => `<li>${escapeHtml(i.name)} <span class="muted">×${i.qty}</span> <b>${money(i.price * i.qty)}</b></li>`)
            .join('')
        : '<li class="muted">Cart is empty.</li>';
    $('#cart-total').textContent = state.cart.length
        ? `Total: ${money(state.cart.reduce((s, i) => s + i.price * i.qty, 0))}`
        : '';
}
function show(view) {
    state.view = view;
    for (const v of ['products', 'orders', 'account', 'checkout']) {
        $(`#view-${v}`).hidden = v !== view;
    }
    document.querySelectorAll('nav a[data-view]').forEach((a) => {
        a.classList.toggle('active', a.dataset.view === view);
    });
    $('#cart-drawer').hidden = true;
}
document.addEventListener('click', (e) => {
    const target = e.target;
    const add = target.closest('[data-add]');
    if (add) {
        const p = PRODUCTS.find((x) => x.id === add.dataset.add);
        if (!p)
            return;
        const line = state.cart.find((i) => i.id === p.id);
        if (line)
            line.qty++;
        else
            state.cart.push({ id: p.id, name: p.name, price: p.price, qty: 1 });
        renderCart();
        flash(add, '✓ Added');
        return;
    }
    const nav = target.closest('nav a[data-view]');
    if (nav) {
        e.preventDefault();
        show(nav.dataset.view ?? 'products');
        return;
    }
    if (target.closest('#cart-btn')) {
        $('#cart-drawer').hidden = !$('#cart-drawer').hidden;
        return;
    }
    if (target.closest('#checkout-btn')) {
        if (!state.cart.length) {
            alert('Cart is empty');
            return;
        }
        show('checkout');
        return;
    }
    if (target.closest('#clear-orders')) {
        state.orders = [];
        renderOrders();
    }
});
$('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    show('products');
    renderProducts();
});
$('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    flash($('#profile-form button[type=submit]'), '✓ Saved');
});
$('#checkout-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const items = state.cart.map((i) => `${i.qty}× ${i.name}`).join(', ');
    const order = {
        id: `ORD-${Math.floor(Math.random() * 9000 + 1000)}`,
        items,
        total: state.cart.reduce((s, i) => s + i.price * i.qty, 0),
        name: $('#co_name').value,
        email: $('#co_email').value,
    };
    state.orders.push(order);
    state.cart = [];
    renderCart();
    renderOrders();
    show('orders');
    alert(`Order ${order.id} placed for ${order.name} — total ${money(order.total)}. Receipt sent to ${order.email}.`);
});
function renderOrders() {
    $('#order-list').innerHTML = state.orders.length
        ? state.orders
            .map((o) => `<div class="order"><b>${o.id}</b> — ${escapeHtml(o.items)} · <b>${money(o.total)}</b><br><span class="muted">ship to ${escapeHtml(o.name)} &lt;${escapeHtml(o.email)}&gt;</span></div>`)
            .join('')
        : '<p class="muted">No orders yet. Checkout to create one.</p>';
}
function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(() => {
        btn.textContent = old;
        btn.disabled = false;
    }, 900);
}
renderProducts();
renderCart();
export {};
