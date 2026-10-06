// PalgharBites frontend (served by the same Express server — relative /api, single origin)
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let token = localStorage.getItem('pb_token') || '';
let user = JSON.parse(localStorage.getItem('pb_user') || 'null');
let cartCache = { items: [], count: 0 };
let currentView = 'home';
let hotelTab = 'New', adminTab = 'overview';

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({ error: 'Network error. Please try again.' }));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ---------- UI helpers ----------
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
const money = (n) => '₹' + Number(n).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusLabel = (s) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const badge = (s) => `<span class="badge-status st-${esc(s)}">${statusLabel(s)}</span>`;

const PLACEHOLDER = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=80';

const foodImg = (f, className = '') => `
  <img
    class="${className}"
    src="${esc(f.image_url || PLACEHOLDER)}"
    alt="${esc(f.image_alt || f.name)}"
    loading="lazy"
    onerror="this.src='${PLACEHOLDER}'"
  >
`;
// ---------- Views switching ----------
function show(id) {
  $$('.view').forEach(v => v.classList.add('hidden'));
  $('#view-' + id).classList.remove('hidden');
}
function logout() {
  localStorage.removeItem('pb_token'); localStorage.removeItem('pb_user');
  token = ''; user = null; show('auth');
}
function routeByRole() {
  if (!user) return show('auth');
  if (user.role === 'student') { show('student'); go('home'); }
  else if (user.role === 'hotel') { show('hotel'); renderHotel(); }
  else if (user.role === 'delivery') { show('delivery'); renderDelivery(); }
  else if (user.role === 'admin') { show('admin'); renderAdmin(); }
}

// ---------- AUTH ----------
$$('.role-tab').forEach(b => b.onclick = () => {
  $$('.role-tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
});
$('#auth-toggle').onclick = () => {
  show('register');

  $('#register-error').classList.add('hidden');

  $('#reg-name').value = '';
  $('#reg-phone').value = '';
  $('#reg-email').value = $('#auth-email').value || '';
  $('#reg-password').value = '';
  $('#reg-confirm-password').value = '';
};
$('#btn-login').onclick = async () => {
  try {
    $('#auth-error').classList.add('hidden');
    const role = $('.role-tab.active').dataset.role;
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: $('#auth-email').value, password: $('#auth-pass').value }) });
    if (role !== data.user.role) throw new Error(`This is a ${data.user.role} account. Please use the ${data.user.role} tab to login.`);
    token = data.token; user = data.user;
    localStorage.setItem('pb_token', token); localStorage.setItem('pb_user', JSON.stringify(user));
    toast('Welcome back, ' + user.name + '!', 'success');
    routeByRole();
  } catch (e) {
    const el = $('#auth-error'); el.textContent = e.message; el.classList.remove('hidden');
  }
};
$('#btn-register').onclick = async () => {
  const errorBox = $('#register-error');

  try {
    errorBox.classList.add('hidden');

    const name = $('#reg-name').value.trim();
    const phone = $('#reg-phone').value.trim();
    const email = $('#reg-email').value.trim();
    const password = $('#reg-password').value;
    const confirmPassword = $('#reg-confirm-password').value;

    if (!name || !phone || !email || !password || !confirmPassword) {
      throw new Error('Please fill in all registration fields.');
    }

    if (!/^[0-9]{10}$/.test(phone)) {
      throw new Error('Please enter a valid 10-digit mobile number.');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters.');
    }

    if (password !== confirmPassword) {
      throw new Error('Password and confirm password do not match.');
    }

    const button = $('#btn-register');

    button.disabled = true;
    button.textContent = 'Creating Account...';

    await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name,
        phone,
        email,
        password,
        role: 'student'
      })
    });

    button.disabled = false;
    button.textContent = 'Create Student Account';

    show('auth');

    $('#auth-email').value = email;
    $('#auth-pass').value = '';

    $('#auth-error').textContent =
      'Registration successful! We sent a verification link to your email. Please verify your email before logging in.';

    $('#auth-error').classList.remove('hidden');

    toast('Verification email sent! 📧', 'success');

  } catch (e) {

    $('#btn-register').disabled = false;
    $('#btn-register').textContent = 'Create Student Account';

    errorBox.textContent = e.message;
    errorBox.classList.remove('hidden');
  }
};
$('#btn-logout').onclick = logout; $('#btn-logout-h').onclick = logout;
$('#btn-logout-d').onclick = logout; $('#btn-logout-a').onclick = logout;

// ---------- STUDENT ----------
const $main = () => $('#student-main');

async function refreshCart() {
  try {
    cartCache = await api('/cart');
    const n = cartCache.items.reduce((s, i) => s + i.quantity, 0);
    const b = $('#cart-count');
    if (n) { b.textContent = n; b.classList.remove('hidden'); } else b.classList.add('hidden');
  } catch {}
}

async function go(tab) {
  currentView = tab;
  $$('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.goto === tab));
  if (tab === 'home') await studentHome();
  else if (tab === 'explore') await studentExplore();
  else if (tab === 'cart') await studentCart();
  else if (tab === 'orders') await studentOrders();
  else if (tab === 'profile') await studentProfile();
  else if (tab === 'notifications') await studentNotifications();
}

$$('.bottom-nav button').forEach(b => b.onclick = () => go(b.dataset.goto));
$$('[data-goto]').forEach(b => { if (!b.classList.contains('bottom-nav') ) b.onclick = () => go(b.dataset.goto); });

async function studentHome() {
  $main().innerHTML = `<div class="skeleton"></div>`;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const [hotels, popular, notif] = await Promise.all([api('/hotels'), api('/food?sort=popular'), api('/notifications')]);
  const nb = $('#notif-badge');
  if (notif.unread) { nb.textContent = notif.unread; nb.classList.remove('hidden'); } else nb.classList.add('hidden');
  $main().innerHTML = `
    <div class="hero">
      <h1>${greet} 👋<br>Hungry? We've Got You Covered.</h1>
      <p>Order delicious food from nearby outlets and collect it at your college gate.</p>
      <button class="btn" data-goto="explore">Explore Food</button>
      <button class="btn" style="margin-left:8px" onclick="scrollToHotels()">View Nearby Hotels</button>
    </div>
    <div class="searchbar"><input id="search-input" placeholder='Search food, hotel or category...' value=""><button class="btn btn-primary" data-goto="explore">Search</button></div>
    <h3 class="section-title">🍜 Categories</h3>
    <div class="chips" id="cat-chips">
      ${['Meals','Breakfast','Snacks','Desserts','Drinks'].map(c => `<button class="chip" data-cat="${c}">${c}</button>`).join('')}
    </div>
    <h3 class="section-title" id="hotels-anchor">🏨 Nearby Hotels</h3>
    <div class="grid grid-3">${hotels.map(hotelCard).join('')}</div>
    <h3 class="section-title">🔥 Popular Food</h3>
    <div class="grid grid-3">${popular.slice(0, 6).map(foodCard).join('')}</div>`;
  $$('[data-goto]', $main()).forEach(b => b.onclick = () => go(b.dataset.goto));
  $$('#cat-chips .chip').forEach(c => c.onclick = () => openExplore(c.dataset.cat));
  $$('.food-card', $main()).forEach(c => c.onclick = () => openFood(c.dataset.id));
  $$('.hotel-card', $main()).forEach(c => c.onclick = () => openHotel(c.dataset.id));
  await refreshCart();
}
window.scrollToHotels = () => $('#hotels-anchor').scrollIntoView({ behavior: 'smooth' });

function hotelCard(h) {
  return `<div class="hotel-card" data-id="${h.id}">
    <img src="${esc(h.image_url || PLACEHOLDER)}" alt="${esc(h.name)}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
    <div class="card-body">
      <b>${esc(h.name)}</b>
      <span class="muted">📍 ${h.distance ?? '—'} km ${h.is_open ? '' : '· <b style="color:var(--error)">Closed</b>'}</span>
      <div class="row-between"><span class="muted">⭐ ${h.rating} · ${esc(h.prep_time || '')}</span><span class="muted">View Menu →</span></div>
    </div></div>`;
}
function foodCard(f) {
  return `<div class="food-card" data-id="${f.id}">
    ${foodImg(f)}
    <div class="card-body">
      <div class="row-between"><span class="food-name">${esc(f.name)}</span><span class="${f.is_veg ? 'veg-dot' : 'nonveg-dot'}"></span></div>
      <span class="muted"> ${esc(f.hotel_name || '')}</span>
      <div class="row-between"><span class="price">${money(f.price)}</span><button class="btn btn-primary btn-sm">Add +</button></div>
    </div></div>`;
}

async function openExplore(cat = '') {
  currentView = 'explore';
  $$('.bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.goto === 'explore'));
  $main().innerHTML = `<div class="searchbar"><input id="search-input" placeholder="Search food, hotel or category..."></div>
    <div class="chips" id="filter-chips">
      ${['', 'veg', 'nonveg'].map(v => `<button class="chip" data-veg="${v}">${v === '' ? 'All' : v === 'veg' ? '🟢 Veg' : '🍗 Non-Veg'}</button>`).join('')}
    </div>
    <div class="chips" id="sort-chips">
      ${[['popular','Popular'],['nearest','Nearest'],['fastest','Fastest'],['price_low','Price ↓'],['price_high','Price ↑']].map(([v,l]) => `<button class="chip" data-sort="${v}">${l}</button>`).join('')}
    </div>
    <div id="explore-grid" class="grid grid-3"><div class="skeleton"></div></div>`;
  let veg = '', sort = 'popular', q = '';
  const load = async () => {
    $('#explore-grid').innerHTML = `<div class="skeleton"></div>`;
    const foods = await api(`/food?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}&veg=${veg}&sort=${sort}`);
    $('#explore-grid').innerHTML = foods.length ? foods.map(foodCard).join('') : `<div class="empty"><div class="big">🍽️</div>No food found. Try a different search.</div>`;
    $$('.food-card', $main()).forEach(c => c.onclick = () => openFood(c.dataset.id));
  };
  $('#search-input').oninput = (e) => { q = e.target.value; load(); };
  $$('#filter-chips .chip').forEach(c => c.onclick = () => { $$('#filter-chips .chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); veg = c.dataset.veg; load(); });
  $$('#sort-chips .chip').forEach(c => c.onclick = () => { $$('#sort-chips .chip').forEach(x => x.classList.remove('active')); c.classList.add('active'); sort = c.dataset.sort; load(); });
  if (cat) { const chip = $(`#filter-chips .chip[data-veg=""]`); chip && chip.classList.add('active'); }
  await load();
}

async function openHotel(id) {
  const h = await api('/hotels/' + id);
  const cats = [...new Set(h.menu.map(m => m.category || 'Other'))];
  $main().innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="go('home')">← Back</button>
    <div class="card" style="margin:12px 0">
      <div class="row" style="gap:14px">
        <img src="${esc(h.image_url || PLACEHOLDER)}" style="width:72px;height:72px;border-radius:14px" onerror="this.src='${PLACEHOLDER}'">
        <div><b style="font-size:18px">${esc(h.name)}</b><br>
        <span class="muted">⭐ ${h.rating} · 📍 ${h.distance} km · ⏱ ${esc(h.prep_time || '')}</span><br>
        <span class="muted">${h.is_open ? '🟢 Open Now' : '🔴 Closed'}</span></div>
      </div>
      <p class="muted" style="margin-top:8px">${esc(h.description || '')}</p>
    </div>
    ${cats.map(c => `<h3 class="section-title">${c}</h3><div class="grid grid-3">${h.menu.filter(m => (m.category || 'Other') === c).map(foodCard).join('')}</div>`).join('')}
    <div id="sticky-cart-slot"></div>`;
  $$('.food-card', $main()).forEach(c => c.onclick = () => openFood(c.dataset.id));
  window.go = go;
}

async function openFood(id) {
  const f = await api('/food/' + id);
  $main().innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="history.back()">← Back</button>
    <div class="detail-hero" style="margin:12px 0">${foodImg(f)}</div>
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="row-between"><b style="font-size:20px">${esc(f.name)}</b><span class="${f.is_veg ? 'veg-dot' : 'nonveg-dot'}"></span></div>
      <span class="muted">🏨 ${esc(f.hotel_name)} · ${esc(f.category || '')}</span>
      <span class="price" style="font-size:20px">${money(f.price)}</span>
      <span class="muted">⏱ Preparation: ${esc(f.preparation_time || '')}</span>
      <p>${esc(f.description || '')}</p>
      <label class="muted">Special instructions</label>
      <input id="food-notes" placeholder="e.g. Less spicy, extra chutney...">
      <button id="add-cart-btn" class="btn btn-primary btn-full">Add to Cart — ${money(f.price)}</button>
    </div>`;
  $('#add-cart-btn').onclick = async (e) => {
    e.stopPropagation();
    try {
      await api('/cart', { method: 'POST', body: JSON.stringify({ food_item_id: f.id, quantity: 1, instructions: $('#food-notes').value }) });
      toast(f.name + ' added to cart 🛒', 'success');
      await refreshCart();
      showStickyCart();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function showStickyCart() {
  const slot = $('#sticky-cart-slot');
  if (!slot) return;
  if (!cartCache.items.length) return;
  const n = cartCache.items.reduce((s, i) => s + i.quantity, 0);
  slot.innerHTML = `<button class="sticky-cart" onclick="go('cart')">🛒 ${n} Items • ${money(cartCache.total)} →</button>`;
}

async function studentCart() {
  await refreshCart();
  const c = cartCache;
  if (!c.items.length) {
    $main().innerHTML = `<div class="empty"><div class="big">🛒</div>Your cart is empty.<br><br><button class="btn btn-primary" data-goto="explore">Browse Food</button></div>`;
    $$('[data-goto]', $main()).forEach(b => b.onclick = () => go(b.dataset.goto));
    return;
  }
  $main().innerHTML = `
    <h3 class="section-title">Your Cart</h3>
    ${c.items.map(i => `
      <div class="order-card">
        <div class="row-between">
          <div class="row">${foodImg(i,'cart-food-img')}<div><b>${esc(i.name)}</b><br><span class="muted">${esc(i.hotel_name)} · ${money(i.price)} each</span></div></div>
          <div class="qty-ctrl">
            <button data-dec="${i.id}">−</button><b>${i.quantity}</b><button data-inc="${i.id}">+</button>
          </div>
        </div>
        <div class="row-between" style="margin-top:8px"><span class="muted">Item total</span><b>${money(i.price * i.quantity)}</b></div>
        <button class="btn btn-danger btn-sm" style="margin-top:6px" data-del="${i.id}">Remove</button>
      </div>`).join('')}
    <div class="card" style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
      <div class="row-between"><span class="muted">Subtotal</span><b>${money(c.subtotal)}</b></div>
      <div class="row-between"><span class="muted">Delivery</span><b>${money(c.delivery_charge)}</b></div>
      <div class="row-between" style="font-size:17px"><b>Total</b><b class="price">${money(c.total)}</b></div>
      <button id="btn-checkout" class="btn btn-primary btn-full">Proceed to Checkout →</button>
    </div>`;
  $$('[data-inc]', $main()).forEach(b => b.onclick = () => updateCartItem(b.dataset.inc, 1));
  $$('[data-dec]', $main()).forEach(b => b.onclick = () => updateCartItem(b.dataset.dec, -1));
  $$('[data-del]', $main()).forEach(b => b.onclick = () => deleteCartItem(b.dataset.del));
  $('#btn-checkout').onclick = checkoutPage;
}
async function updateCartItem(id, delta) {
  const item = cartCache.items.find(i => i.id == id);
  await api('/cart/' + id, { method: 'PATCH', body: JSON.stringify({ quantity: item.quantity + delta }) });
  studentCart();
}
async function deleteCartItem(id) { await api('/cart/' + id, { method: 'DELETE' }); studentCart(); }

async function checkoutPage() {
  const c = await api('/cart');
  $main().innerHTML = `
    <h3 class="section-title">Checkout</h3>
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <div><b>Your Order</b><br><span class="muted">Hotel: ${esc(c.items[0].hotel_name)}</span>
      ${c.items.map(i => `<div class="row-between"><span>${esc(i.name)} × ${i.quantity}</span><span>${money(i.price * i.quantity)}</span></div>`).join('')}
      <div class="row-between"><span class="muted">Subtotal</span><span>${money(c.subtotal)}</span></div>
      <div class="row-between"><span class="muted">Delivery</span><span>${money(c.delivery_charge)}</span></div>
      <div class="row-between" style="font-size:16px"><b>Total</b><b class="price">${money(c.total)}</b></div></div>
      <label><b>Delivery Location</b><br><span class="muted">St. John College of Engineering & Management, Palghar</span></label>
      <select id="gate-select">
        <option value="Main Gate">Main Gate</option>
        <option value="Other Gate">Other Gate</option>
        <option value="College Pickup Point">College Pickup Point</option>
      </select>
      <label class="muted">📍 Delivery is made to the college gate/pickup point, not the classroom.</label>
      <label><b>Delivery Instructions</b></label>
      <select id="instr-select">
        <option value="">— Choose a quick instruction (optional) —</option>
        <option>Call me when you reach</option><option>I will come outside</option>
        <option>Please wait for 2 minutes</option><option>Contact me on phone</option><option>Meet me near main entrance</option>
      </select>
      <input id="instr-custom" placeholder="Or type your own instruction...">
      <label><b>Payment Method</b></label>
      <label class="row" style="gap:8px"><input type="radio" name="pm" value="ONLINE" checked style="width:auto"> 💳 Online Payment (UPI / Card / NetBanking)</label>
      <label class="row" style="gap:8px"><input type="radio" name="pm" value="COD" style="width:auto"> 💵 Cash on Delivery / Collection</label>
      <button id="btn-place" class="btn btn-primary btn-full">Place Order & Pay ${money(c.total)}</button>
    </div>`;
  $('#instr-select').onchange = (e) => { if (e.target.value) $('#instr-custom').value = e.target.value; };
  $('#btn-place').onclick = placeOrder;
}

async function placeOrder() {
  const btn = $('#btn-place');
  btn.disabled = true; btn.textContent = 'Placing order...';
  try {
    const pm = $$('input[name=pm]').find(r => r.checked).value;
    const { order, payment_method } = await api('/orders', { method: 'POST', body: JSON.stringify({
      gate: $('#gate-select').value,
      delivery_instructions: $('#instr-custom').value,
      payment_method: pm
    }) });
    if (payment_method === 'ONLINE') return payOnline(order);
    // COD → confirmed directly
    toast('Order placed! Pay cash at collection.', 'success');
    orderSuccess(order, 'COD');
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Place Order'; }
}

async function payOnline(order) {
  try {
    const p = await api('/payments/create', { method: 'POST', body: JSON.stringify({ order_id: order.id }) });
    if (p.mode === 'razorpay') {
      const rz = new window.Razorpay({
        key: p.key_id, amount: p.amount, currency: 'INR', name: 'PalgharBites',
        description: 'Order ' + p.order_number, order_id: p.razorpay_order_id,
        handler: async (resp) => {
          try {
            await api('/payments/verify', { method: 'POST', body: JSON.stringify({ order_id: order.id, ...resp }) });
            toast('Payment successful! 🎉', 'success');
            orderSuccess(order, 'PAID');
          } catch (e) { paymentFailed(e.message); }
        },
        modal: { ondismiss: () => paymentFailed('Payment was cancelled.') }
      });
      rz.on('payment.failed', () => paymentFailed('Payment failed. Please try again.'));
      rz.open();
    } else {
      // Development simulator
      await api('/payments/verify', { method: 'POST', body: JSON.stringify({ order_id: order.id, razorpay_order_id: p.razorpay_order_id }) });
      toast('Simulated payment successful (dev mode) 🎉', 'success');
      orderSuccess(order, 'PAID');
    }
  } catch (e) { paymentFailed(e.message); }
}

function paymentFailed(msg) {
  $main().innerHTML = `<div class="empty"><div class="big">❌</div><h3>Payment Failed</h3>
    <p class="muted">${esc(msg)}<br>Your order has not been confirmed.<br>No duplicate order will be created on retry.</p><br>
    <button class="btn btn-primary" onclick="go('cart')">Try Again</button>
    <button class="btn btn-outline" style="margin-left:8px" onclick="go('cart')">Change Payment Method</button></div>`;
}

function orderSuccess(order, payStatus) {
  $main().innerHTML = `<div class="empty">
    <div class="big">🎉</div><h2>Payment Successful!</h2>
    <p class="muted">Your order has been confirmed.</p><br>
    <div class="card" style="text-align:left;display:inline-block;min-width:280px;text-align:left">
      <div class="row-between"><span class="muted">Order</span><b>#${esc(order.order_number)}</b></div>
      <div class="row-between"><span class="muted">Total</span><b>${money(order.total)} ${payStatus === 'COD' ? '(COD)' : '(PAID)'}</b></div>
      <div class="row-between"><span class="muted">Delivery</span><span>${esc(order.gate)}, St. John College</span></div>
      <div class="row-between"><span class="muted">Est. preparation</span><span>20–30 minutes</span></div>
    </div><br><br>
    <button class="btn btn-primary" onclick="go('orders');openTracking(${order.id})">Track My Order</button>
  </div>`;
}

async function studentOrders() {
  const orders = await api('/orders');
  const active = orders.filter(o => !['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
  const past = orders.filter(o => ['DELIVERED', 'CANCELLED', 'REJECTED'].includes(o.status));
  const card = (o) => `<div class="order-card" data-oid="${o.id}">
    <div class="row-between"><b>#${esc(o.order_number)}</b>${badge(o.status)}</div>
    <div class="muted">${esc(o.items.map(i => `${esc(i.name)} × ${i.quantity}`).join(', '))}</div>
    <div class="row-between" style="margin-top:6px"><span class="muted">${new Date(o.created_at + 'Z').toLocaleString()}</span><b class="price">${money(o.total)}</b></div>
    <div class="muted">Payment: ${esc(o.payment ? o.payment.status : 'COD')}</div>
    <button class="btn btn-outline btn-sm" style="margin-top:8px" data-track="${o.id}">View Details / Track →</button>
  </div>`;
  $main().innerHTML = `
    <h3 class="section-title">Active Orders</h3>
    ${active.length ? active.map(card).join('') : `<div class="empty">No active orders 🍽️</div>`}
    <h3 class="section-title">Past Orders</h3>
    ${past.length ? past.map(card).join('') : `<div class="empty">No past orders yet.</div>`}`;
  $$('[data-track]', $main()).forEach(b => b.onclick = () => openTracking(b.dataset.track));
}

async function openTracking(id) {
  const o = await api('/orders/' + id);
  const flow = ['ORDER_PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERY_ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'REACHED_GATE', 'DELIVERED'];
  const idx = flow.indexOf(o.status);
  const arrived = o.status === 'REACHED_GATE';
  $main().innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="go('orders')">← Back to Orders</button>
    ${arrived ? `<div class="gate-pulse" style="margin:14px 0"><b style="font-size:17px">📍 Your order is at the college gate!</b><br><span class="muted">Please come to the ${esc(o.gate)} to collect it.</span></div>` : ''}
    <div class="card" style="margin-top:12px;display:flex;flex-direction:column;gap:8px">
      <div class="row-between"><b>Order #${esc(o.order_number)}</b>${badge(o.status)}</div>
      <span class="muted">🏨 ${esc(o.hotel_name)} · ${money(o.total)} · Payment: ${o.payment ? esc(o.payment.status) : 'COD'}</span>
      <div class="row-between"><span class="muted">Delivery</span><span>📍 ${esc(o.gate)}, St. John College</span></div>
      ${o.delivery_instructions ? `<div class="muted">📝 "${esc(o.delivery_instructions)}"</div>` : ''}
      <h3 class="section-title" style="margin:6px 0">Tracking</h3>
      <div class="timeline">${flow.map((s, i) => `
        <div class="tl-item ${i < idx ? 'done' : ''} ${i === idx ? 'current' : ''}">
          <div class="tl-dot">${i < idx ? '✓' : i === idx ? '●' : ''}</div>
          <div class="tl-label">${statusLabel(s)}</div>
          ${i < flow.length - 1 ? '<div class="tl-line"></div>' : ''}
        </div>`).join('')}</div>
      ${['ON_THE_WAY', 'REACHED_GATE'].includes(o.status) ? '<b>🛵 Arriving in approximately 10 minutes</b>' : ''}
    </div>`;
  if (currentView !== 'orders-tracking') setTimeout(() => { if (currentView === 'orders' || currentView === 'home') return; }, 0);
}

async function studentNotifications() {
  const { notifications, unread } = await api('/notifications');
  $('#notif-badge').classList.add('hidden');
  $main().innerHTML = `
    <h3 class="section-title">🔔 Notifications</h3>
    ${notifications.length ? notifications.map(n => `
      <div class="notif-item ${n.is_read ? '' : 'unread'}">
        <b>${esc(n.title)}</b><br><span class="muted">${esc(n.message)}</span><br>
        <span class="muted" style="font-size:11px">${new Date(n.created_at + 'Z').toLocaleString()}</span>
        ${n.order_id ? ` <button class="btn btn-ghost btn-sm" data-track="${n.order_id}">View order</button>` : ''}
      </div>`).join('') : `<div class="empty">No notifications yet.</div>`}`;
  $$('[data-track]', $main()).forEach(b => b.onclick = () => openTracking(b.dataset.track));
  await api('/notifications/read', { method: 'PATCH' });
}

async function studentProfile() {
  const { user: u, profile } = await api('/auth/me');
  $main().innerHTML = `
    <h3 class="section-title">👤 Profile</h3>
    <div class="card" style="display:flex;flex-direction:column;gap:12px">
      <label>Name<input id="pf-name" value="${esc(u.name)}"></label>
      <label>Phone<input id="pf-phone" value="${esc(u.phone || '')}"></label>
      <label>College<input value="${esc(profile?.college || 'St. John College of Engineering & Management, Palghar')}" disabled></label>
      <label>Default address<input id="pf-addr" value="${esc(profile?.default_address || '')}" placeholder="e.g. Hostel Block A"></label>
      <button id="pf-save" class="btn btn-primary">Save Profile</button>
    </div>`;
  $('#pf-save').onclick = async () => {
    await api('/profile', { method: 'PATCH', body: JSON.stringify({ name: $('#pf-name').value, phone: $('#pf-phone').value, default_address: $('#pf-addr').value }) });
    toast('Profile saved ✓', 'success');
  };
}

// ---------- HOTEL ----------
async function renderHotel() {
  const data = await api('/hotel/dashboard');
  const { hotel, stats, menu } = data;
  const orders = await api('/orders');
  const tabs = ['New', 'Accepted', 'Preparing', 'Ready', 'Completed', 'Cancelled'];
  const tabMap = { New: ['ORDER_PLACED'], Accepted: ['ACCEPTED'], Preparing: ['PREPARING'], Ready: ['READY'], Completed: ['DELIVERED'], Cancelled: ['CANCELLED', 'REJECTED'] };
  if (!orders.some(o => tabMap[hotelTab]?.includes(o.status))) hotelTab = 'New';
  const shown = orders.filter(o => tabMap[hotelTab].includes(o.status));
  const deliveryBoys = await api('/hotel/delivery-boys');
  const actionFor = (o) => {
    if (o.status === 'ORDER_PLACED') return `<button class="btn btn-green btn-sm" data-act="ACCEPTED">Accept</button> <button class="btn btn-danger btn-sm" data-act="REJECTED">Reject</button>`;
    if (o.status === 'ACCEPTED') return `<button class="btn btn-primary btn-sm" data-act="PREPARING">Start Preparing</button>`;
    if (o.status === 'PREPARING') return `<button class="btn btn-primary btn-sm" data-act="READY">Mark Ready 🍽️</button>`;
    if (o.status === 'READY') return `<select data-assign="${o.id}"><option value="">Assign delivery boy…</option>${deliveryBoys.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>`;
    return '';
  };
  $('#hotel-main').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><b>${stats.new_orders}</b><span>New Orders</span></div>
      <div class="stat-card"><b>${stats.preparing}</b><span>Preparing</span></div>
      <div class="stat-card"><b>${stats.ready}</b><span>Ready</span></div>
      <div class="stat-card"><b>${stats.completed}</b><span>Completed</span></div>
      <div class="stat-card"><b>${stats.today_orders}</b><span>Today's Orders</span></div>
      <div class="stat-card"><b>${money(stats.today_revenue)}</b><span>Today's Revenue</span></div>
    </div>
    <div class="card row-between" style="margin-bottom:14px">
      <div class="row">🏨 <b>${esc(hotel.name)}</b> ${hotel.is_open ? '🟢 Open' : '🔴 Closed'}</div>
      <button class="btn btn-outline btn-sm" id="btn-toggle-open">${hotel.is_open ? 'Close Outlet' : 'Open Outlet'}</button>
    </div>
    <div class="tab-row">${tabs.map(t => `<button data-htab="${t}" class="${t === hotelTab ? 'active' : ''}">${t}</button>`).join('')}</div>
    <div id="hotel-orders">${shown.length ? shown.map(o => `
      <div class="order-card" data-oid="${o.id}">
        <div class="row-between"><b>#${esc(o.order_number)}</b><div>${badge(o.status)} <span class="muted">${o.payment ? esc(o.payment.status === 'COD' ? 'COD' : o.payment.status) : ''}</span></div></div>
        <div class="muted">Student: ${esc(o.student_name)} · 📍 ${esc(o.gate)}, St. John College</div>
        ${o.delivery_instructions ? `<div class="muted">📝 "${esc(o.delivery_instructions)}"</div>` : ''}
        ${o.items.map(i => `<div class="oi-row">${foodImg(i)}<div><b>${esc(i.name)} × ${i.quantity}</b><br><span class="muted">${money(i.price * i.quantity)}</span></div></div>`).join('')}
        <div class="row-between"><b>Total: ${money(o.total)}</b><div class="row">${actionFor(o)}</div></div>
      </div>`).join('') : `<div class="empty">No ${hotelTab.toLowerCase()} orders.</div>`}</div>
    <h3 class="section-title">🍽️ Menu Management</h3>
    <div class="card" style="margin-bottom:12px;display:flex;flex-direction:column;gap:10px" id="food-form">
      <b>Add New Food</b>
      <input id="ff-name" placeholder="Food name">
      <input id="ff-desc" placeholder="Description">
      <div class="row"><input id="ff-price" type="number" placeholder="Price ₹"><input id="ff-img" placeholder="Image URL (Unsplash/Pexels)"></div>
      <div class="row">
        <select id="ff-cat">${['Meals','Breakfast','Snacks','Desserts','Drinks'].map(c => `<option>${c}</option>`).join('')}</select>
        <select id="ff-veg"><option value="1">🟢 Veg</option><option value="0">🍗 Non-Veg</option></select>
      </div>
      <div class="row"><input id="ff-time" placeholder="Prep time e.g. 10-15 min"><label class="row" style="gap:6px;width:auto"><input type="checkbox" id="ff-avail" checked style="width:auto"> Available</label></div>
      <button id="ff-save" class="btn btn-primary">Save Food</button>
    </div>
    ${menu.map(f => `
      <div class="order-card row-between">
        <div class="row">${foodImg(f)}<div><b>${esc(f.name)}</b> <span class="${f.is_veg ? 'veg-dot' : 'nonveg-dot'}"></span><br>
        <span class="muted">${money(f.price)} · ${esc(f.category || '')} · ${f.is_available ? '🟢 Available' : '🔴 Disabled'}</span></div></div>
        <div class="row">
          <button class="btn btn-ghost btn-sm" data-toggle-avail="${f.id}">${f.is_available ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger btn-sm" data-del-food="${f.id}">Delete</button>
        </div>
      </div>`).join('')}`;

  $$('[data-htab]').forEach(b => b.onclick = () => { hotelTab = b.dataset.htab; renderHotel(); });
  $('#btn-toggle-open').onclick = async () => { await api('/hotel/settings', { method: 'PATCH', body: JSON.stringify({ is_open: !hotel.is_open }) }); toast('Outlet updated ✓', 'success'); renderHotel(); };
  $('#ff-save').onclick = async () => {
    try {
      const catId = ({ Meals: 1, Breakfast: 2, Snacks: 3, Desserts: 4, Drinks: 5 })[$('#ff-cat').value];
      await api('/hotel/food', { method: 'POST', body: JSON.stringify({
        name: $('#ff-name').value, description: $('#ff-desc').value, price: $('#ff-price').value,
        category_id: catId, image_url: $('#ff-img').value, is_veg: $('#ff-veg').value === '1',
        preparation_time: $('#ff-time').value, is_available: $('#ff-avail').checked }) });
      toast('Food added — now live on student menu ✓', 'success');
      renderHotel();
    } catch (e) { toast(e.message, 'error'); }
  };
  // wire status action buttons
  $$('.order-card').forEach(card => {
    const oid = card.dataset.oid;
    $$('button[data-act]', card).forEach(b => b.onclick = async () => {
      try {
        await api(`/orders/${oid}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.act }) });
        toast('Order updated ✓', 'success'); renderHotel();
      } catch (e) { toast(e.message, 'error'); }
    });
    $$('select[data-assign]', card).forEach(s => s.onchange = async () => {
      if (!s.value) return;
      try {
        await api(`/orders/${oid}/status`, { method: 'PATCH', body: JSON.stringify({ status: 'DELIVERY_ASSIGNED', delivery_boy_id: s.value }) });
        toast('Delivery boy assigned 🛵', 'success'); renderHotel();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
  $$('[data-toggle-avail]').forEach(b => b.onclick = async () => {
    const f = menu.find(x => x.id == b.dataset.toggleAvail);
    await api(`/hotel/food/${f.id}`, { method: 'PATCH', body: JSON.stringify({ is_available: !f.is_available }) });
    renderHotel();
  });
  $$('[data-del-food]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete this food item?')) return;
    await api(`/hotel/food/${b.dataset.delFood}`, { method: 'DELETE' });
    toast('Food deleted', 'success'); renderHotel();
  });
}

// ---------- DELIVERY ----------
async function renderDelivery() {
  const { active, history } = await api('/delivery/dashboard');
  const card = (o, isActive) => {
    const next = { DELIVERY_ASSIGNED: ['PICKED_UP', 'Accept Delivery / Picked Up'], PICKED_UP: ['ON_THE_WAY', 'On The Way 🛵'], ON_THE_WAY: ['REACHED_GATE', 'Reached College Gate 📍'], REACHED_GATE: ['DELIVERED', 'Delivered ✅'] };
    const [nstatus, label] = next[o.status] || [];
    return `<div class="order-card" data-doid="${o.id}">
      <div class="row-between"><b>#${esc(o.order_number)}</b>${badge(o.status)}</div>
      <div class="muted">Pickup: 🏨 ${esc(o.hotel_name)}<br>Drop: 📍 St. John College ${esc(o.gate)}<br>
      Student: ${esc(o.student_name)} · 📞 ${esc(o.student_phone || '')}</div>
      ${o.delivery_instructions ? `<div class="muted">📝 "${esc(o.delivery_instructions)}"</div>` : ''}
      <div class="muted">${o.items.map(i => `${esc(i.name)} × ${i.quantity}`).join(', ')} — ${money(o.total)}</div>
      ${isActive && nstatus ? `<button class="btn btn-primary" style="margin-top:8px" data-dstatus="${nstatus}">${label}</button>` : ''}
    </div>`;
  };
  $('#delivery-main').innerHTML = `
    <h3 class="section-title">🛵 Active Deliveries</h3>
    ${active.length ? active.map(o => card(o, true)).join('') : '<div class="empty">No active deliveries. New assignments will appear here.</div>'}
    <h3 class="section-title">✅ Completed</h3>
    ${history.length ? history.map(o => card(o, false)).join('') : '<div class="empty">No completed deliveries yet.</div>'}`;
  $$('[data-dstatus]').forEach(b => b.onclick = async () => {
    try {
      await api(`/orders/${b.closest('.order-card').dataset.doid}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.dstatus }) });
      toast(b.dataset.dstatus === 'REACHED_GATE' ? 'Student notified: order at college gate! 📍' : 'Status updated ✓', 'success');
      renderDelivery();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------- ADMIN ----------
$$('.admin-tabs button').forEach(b => b.onclick = () => { adminTab = b.dataset.tab; $$('.admin-tabs button').forEach(x => x.classList.toggle('active', x === b)); renderAdmin(); });
async function renderAdmin() {
  const m = $('#admin-main');
  if (adminTab === 'overview') {
    const s = await api('/admin/stats');
    m.innerHTML = `<div class="stat-grid">
      <div class="stat-card"><b>${s.students}</b><span>Total Students</span></div>
      <div class="stat-card"><b>${s.hotels}</b><span>Total Hotels</span></div>
      <div class="stat-card"><b>${s.delivery_boys}</b><span>Delivery Boys</span></div>
      <div class="stat-card"><b>${s.today_orders}</b><span>Today's Orders</span></div>
      <div class="stat-card"><b>${s.active_orders}</b><span>Active Orders</span></div>
      <div class="stat-card"><b>${money(s.today_revenue)}</b><span>Today's Revenue</span></div>
      <div class="stat-card"><b>${s.online_payments}</b><span>Online Payments</span></div>
      <div class="stat-card"><b>${s.cod_orders}</b><span>COD Orders</span></div>
      <div class="stat-card"><b>${money(s.total_revenue)}</b><span>Total Revenue</span></div>
    </div>`;
  } else if (adminTab === 'orders') {
    const orders = await api('/orders');
    m.innerHTML = `<table><tr><th>Order</th><th>Student</th><th>Items</th><th>Total</th><th>Status</th><th>Payment</th></tr>
      ${orders.map(o => `<tr><td><b>#${esc(o.order_number)}</b></td><td>${esc(o.student_name || '')}</td>
      <td>${esc(o.items.map(i => `${i.name}×${i.quantity}`).join(', '))}</td><td>${money(o.total)}</td>
      <td>${badge(o.status)}</td><td>${o.payment ? esc(o.payment.status) : 'COD'}</td></tr>`).join('')}</table>`;
  } else if (adminTab === 'users') {
    const users = await api('/admin/users');
    m.innerHTML = `<table><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Action</th></tr>
      ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td>${u.role}</td><td>${u.status}</td>
      <td>${u.role !== 'admin' ? `<button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-green'}" data-uid="${u.id}" data-ust="${u.status}">${u.status === 'active' ? 'Deactivate' : 'Activate'}</button>` : '—'}</td></tr>`).join('')}</table>`;
    $$('[data-uid]').forEach(b => b.onclick = async () => {
      await api(`/admin/users/${b.dataset.uid}`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.ust === 'active' ? 'inactive' : 'active' }) });
      toast('User updated ✓', 'success'); renderAdmin();
    });
  } else if (adminTab === 'hotels') {
    const hotels = await api('/admin/hotels');
    m.innerHTML = `
      <div class="card" style="margin-bottom:14px;display:flex;flex-direction:column;gap:10px">
        <b>➕ Add Nearby Outlet (1–2 km of St. John College)</b>
        <div class="row"><input id="ah-name" placeholder="Outlet name"><input id="ah-email" placeholder="Login email"></div>
        <div class="row"><input id="ah-pass" placeholder="Login password"><input id="ah-dist" type="number" step="0.1" placeholder="Distance km"></div>
        <div class="row"><input id="ah-lat" type="number" step="0.0001" placeholder="Latitude"><input id="ah-lng" type="number" step="0.0001" placeholder="Longitude"></div>
        <button id="ah-save" class="btn btn-primary">Add Outlet</button>
      </div>
      <table><tr><th>Hotel</th><th>Email</th><th>Distance</th><th>Status</th><th>Action</th></tr>
      ${hotels.map(h => `<tr><td>${esc(h.name)}</td><td>${esc(h.email)}</td><td>${h.distance_from_college ?? '—'} km</td><td>${h.status}</td>
      <td><button class="btn btn-sm ${h.status === 'active' ? 'btn-danger' : 'btn-green'}" data-hid="${h.id}" data-hst="${h.status}">${h.status === 'active' ? 'Deactivate' : 'Approve'}</button></td></tr>`).join('')}</table>`;
    $('#ah-save').onclick = async () => {
      try {
        await api('/admin/hotels', { method: 'POST', body: JSON.stringify({
          name: $('#ah-name').value, email: $('#ah-email').value, password: $('#ah-pass').value,
          latitude: $('#ah-lat').value, longitude: $('#ah-lng').value, distance_from_college: $('#ah-dist').value }) });
        toast('Outlet added ✓', 'success'); renderAdmin();
      } catch (e) { toast(e.message, 'error'); }
    };
    $$('[data-hid]').forEach(b => b.onclick = async () => {
      await api(`/admin/hotels/${b.dataset.hid}`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.hst === 'active' ? 'inactive' : 'active' }) });
      toast('Hotel updated ✓', 'success'); renderAdmin();
    });
  } else if (adminTab === 'payments') {
    const orders = await api('/orders');
    const pays = orders.filter(o => o.payment).map(o => ({ ...o.payment, order_number: o.order_number, student: o.student_name }));
    m.innerHTML = `<table><tr><th>Order</th><th>Provider</th><th>Method</th><th>Amount</th><th>Status</th><th>Verified</th></tr>
      ${pays.map(p => `<tr><td>#${esc(p.order_number)}</td><td>${esc(p.provider)}</td><td>${esc(p.method || '—')}</td>
      <td>${money(p.amount)}</td><td>${esc(p.status)}</td><td>${p.signature_verified ? '✓' : '—'}</td></tr>`).join('') || '<tr><td colspan="6">No payments yet.</td></tr>'}</table>`;
  } else if (adminTab === 'settings') {
    const s = await api('/admin/settings');
    m.innerHTML = `<div class="card" style="max-width:420px;display:flex;flex-direction:column;gap:12px">
      <label>Delivery charge (₹)<input id="s-del" type="number" value="${s.delivery_charge}"></label>
      <label class="row" style="gap:8px"><input type="checkbox" id="s-cod" ${s.cod_enabled ? 'checked' : ''} style="width:auto"> Enable Cash on Delivery/Collection</label>
      <button id="s-save" class="btn btn-primary">Save Settings</button></div>`;
    $('#s-save').onclick = async () => {
      await api('/admin/settings', { method: 'PATCH', body: JSON.stringify({ delivery_charge: $('#s-del').value, cod_enabled: $('#s-cod').checked }) });
      toast('Settings saved ✓', 'success');
    };
  }
}

// ---------- Polling notifications (reliable refresh; WebSockets optional upgrade) ----------
setInterval(async () => {
  if (!user || user.role !== 'student' || currentView === 'auth') return;
  try {
    const { unread } = await api('/notifications');
    const nb = $('#notif-badge');
    if (unread) { nb.textContent = unread; nb.classList.remove('hidden'); } else nb.classList.add('hidden');
  } catch {}
}, 15000);

// ---------- BOOT ----------
if (token && user) routeByRole(); else show('auth');
window.go = go; window.openFood = openFood; window.openHotel = openHotel; window.openTracking = openTracking;

$('#btn-back-login').onclick = () => {
  show('auth');
  $('#register-error').classList.add('hidden');
};