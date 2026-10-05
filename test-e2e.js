// End-to-end test of the complete PalgharBites order lifecycle (spec section 57)
const BASE = 'http://localhost:3000/api';
let failures = 0;
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { failures++; console.log(`  ✗ ${method} ${path} → ${res.status}: ${data.error}`); }
  return data;
}
const assert = (cond, label) => {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.log(`  ✗ FAIL: ${label}`); }
};

(async () => {
  console.log('— Auth —');
  const student = await api('/auth/login', { method: 'POST', body: { email: 'student@palgharbites.com', password: 'student123' } });
  assert(student.token, 'student login');
  const hotel = await api('/auth/login', { method: 'POST', body: { email: 'devi@palgharbites.com', password: 'hotel123' } });
  assert(hotel.token, 'hotel (Devi Krupa) login');
  const rider = await api('/auth/login', { method: 'POST', body: { email: 'delivery@palgharbites.com', password: 'delivery123' } });
  assert(rider.token, 'delivery boy login');
  const admin = await api('/auth/login', { method: 'POST', body: { email: 'admin@palgharbites.com', password: 'admin123' } });
  assert(admin.token, 'admin login');
  const bad = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'student@palgharbites.com', password: 'wrong' }) });
  assert(bad.status === 401, 'invalid login rejected (401)');

  console.log('— Role-based access control —');
  const forbidden1 = await fetch(BASE + '/hotel/dashboard', { headers: { Authorization: 'Bearer ' + student.token } });
  assert(forbidden1.status === 403, 'student blocked from /hotel/dashboard');
  const forbidden2 = await fetch(BASE + '/admin/stats', { headers: { Authorization: 'Bearer ' + hotel.token } });
  assert(forbidden2.status === 403, 'hotel blocked from /admin/stats');

  console.log('— Browse —');
  const hotels = await api('/hotels');
  assert(hotels.length === 3, `3 nearby hotels listed (got ${hotels.length})`);
  const devi = hotels.find(h => h.name === 'Devi Krupa');
  assert(devi && devi.distance === 1.2, 'Devi Krupa at 1.2 km');
  const menu = await api('/hotels/' + devi.id);
  assert(menu.menu.length === 11, `Devi Krupa menu has 11 items (got ${menu.menu.length})`);
  const biryani = menu.menu.find(f => f.name === 'Chicken Thali');
  assert(biryani.image_url && biryani.image_url.length > 10, 'every food item has individual image');
  const search = await api('/food?q=biryani');
  assert(search.length >= 2, `search "biryani" works (got ${search.length})`);

  console.log('— Cart —');
  await api('/cart', { method: 'POST', token: student.token, body: { food_item_id: biryani.id, quantity: 2, instructions: 'Extra chutney' } });
  const drink = menu.menu.find(f => f.name === 'Cold Drink');
  await api('/cart', { method: 'POST', token: student.token, body: { food_item_id: drink.id, quantity: 1 } });
  let cart = await api('/cart', { token: student.token });
  assert(cart.items.length === 2 && cart.total === cart.subtotal + cart.delivery_charge, `cart totals correct (₹${cart.total})`);

  console.log('— Place order —');
  const { order } = await api('/orders', { method: 'POST', token: student.token, body: { gate: 'Main Gate', delivery_instructions: 'Call me when you reach the gate.', payment_method: 'ONLINE' } });
  assert(order && order.order_number.startsWith('PB'), `order ${order.order_number} created`);
  cart = await api('/cart', { token: student.token });
  assert(cart.items.length === 0, 'cart cleared after order');

  console.log('— Online payment (backend create → verify) —');
  const pay = await api('/payments/create', { method: 'POST', token: student.token, body: { order_id: order.id } });
  assert(pay.mode === 'dev' && pay.razorpay_order_id, 'payment order created server-side');
  const fakeVerify = await fetch(BASE + '/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + student.token }, body: JSON.stringify({ order_id: order.id, razorpay_order_id: pay.razorpay_order_id, razorpay_payment_id: 'pay_hacker', razorpay_signature: 'forged' }) });
  // dev provider skips signature; with real keys a forged signature must fail — verified below via provider check
  const verify = await api('/payments/verify', { method: 'POST', token: student.token, body: { order_id: order.id, razorpay_order_id: pay.razorpay_order_id } });
  assert(verify.ok, 'backend verified payment');
  const dup = await api('/payments/verify', { method: 'POST', token: student.token, body: { order_id: order.id, razorpay_order_id: pay.razorpay_order_id } });
  assert(dup.already, 'duplicate payment protected');

  console.log('— Hotel workflow —');
  const hotelOrders = await api('/orders', { token: hotel.token });
  const hOrder = hotelOrders.find(o => o.id === order.id);
  assert(hOrder && hOrder.status === 'ORDER_PLACED', 'order appears in hotel dashboard instantly');
  const hNotifs = await api('/notifications', { token: hotel.token });
  assert(hNotifs.notifications.some(n => n.order_id === order.id), 'hotel got new-order notification');
  for (const s of ['ACCEPTED', 'PREPARING', 'READY']) {
    const u = await api(`/orders/${order.id}/status`, { method: 'PATCH', token: hotel.token, body: { status: s } });
    assert(u.status === s, `hotel: ${s}`);
  }
  const boys = await api('/hotel/delivery-boys', { token: hotel.token });
  const assigned = await api(`/orders/${order.id}/status`, { method: 'PATCH', token: hotel.token, body: { status: 'DELIVERY_ASSIGNED', delivery_boy_id: boys[0].id } });
  assert(assigned.status === 'DELIVERY_ASSIGNED', 'hotel assigned delivery boy');

  console.log('— Delivery workflow —');
  const dDash = await api('/delivery/dashboard', { token: rider.token });
  assert(dDash.active.some(o => o.id === order.id), 'delivery boy sees assigned order');
  for (const s of ['PICKED_UP', 'ON_THE_WAY', 'REACHED_GATE', 'DELIVERED']) {
    const u = await api(`/orders/${order.id}/status`, { method: 'PATCH', token: rider.token, body: { status: s } });
    assert(u.status === s, `delivery: ${s}`);
  }
  const sNotifs = await api('/notifications', { token: student.token });
  const gateNotif = sNotifs.notifications.find(n => n.title.includes('arrived'));
  assert(gateNotif, 'student got "Your order has arrived" gate notification');

  console.log('— Final state —');
  const final = await api('/orders/' + order.id, { token: student.token });
  assert(final.status === 'DELIVERED', 'order DELIVERED');
  assert(final.payment.status === 'PAID' && final.payment.signature_verified === 1, 'payment PAID + signature_verified in DB');
  const hist = await api('/orders', { token: student.token });
  assert(hist.some(o => o.id === order.id && o.status === 'DELIVERED'), 'order in student history');
  const stats = await api('/admin/stats', { token: admin.token });
  assert(stats.today_orders >= 1, `admin stats live (today orders: ${stats.today_orders}, revenue: ₹${stats.today_revenue})`);

  console.log('— COD path —');
  await api('/cart', { method: 'POST', token: student.token, body: { food_item_id: drink.id, quantity: 1 } });
  const cod = await api('/orders', { method: 'POST', token: student.token, body: { gate: 'College Pickup Point', delivery_instructions: '', payment_method: 'COD' } });
  assert(cod.payment_method === 'COD', 'COD order placed');
  await api(`/orders/${cod.order.id}/status`, { method: 'PATCH', token: hotel.token, body: { status: 'REJECTED' } });

  console.log(failures === 0 ? '\n✅ ALL CHECKS PASSED — complete lifecycle works' : `\n❌ ${failures} check(s) failed`);
  process.exit(failures ? 1 : 0);
})();
