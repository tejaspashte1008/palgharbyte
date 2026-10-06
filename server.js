require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const nodemailer = require('nodemailer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SESSION_SECRET || 'palgharbites_dev_secret_change_me';
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false') === 'true';
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

const APP_URL = (
  process.env.APP_URL || `http://localhost:${PORT}`
).replace(/\/$/, '');

const mailer = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASSWORD
  }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------------- HELPERS ----------------
const sign = (user) => jwt.sign(
  { id: user.id, role: user.role, name: user.name },
  SECRET,
  { expiresIn: '7d' }
);

function auth(roles) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Please login to continue.' });
    try {
      req.user = jwt.verify(token, SECRET);
    } catch {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    if (roles && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You are not authorized to access this area.' });
    }
    next();
  };
}

const getSetting = (key, def) => {
  const r = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return r ? r.value : def;
};

function notify(userId, orderId, title, message) {
  db.prepare('INSERT INTO notifications (user_id, order_id, title, message) VALUES (?,?,?,?)')
    .run(userId, orderId, title, message);
}

function verifyRazorpaySignature(razorpayOrderId, razorpayPaymentId, signature) {
  if (!RZP_KEY_SECRET) return false;
  const expected = crypto.createHmac('sha256', RZP_KEY_SECRET)
    .update(razorpayOrderId + '|' + razorpayPaymentId).digest('hex');
  return expected === signature;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function sendVerificationEmail(email, name, token) {
  const verificationUrl =
    `${APP_URL}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  await mailer.sendMail({
    from: SMTP_FROM,
    to: email,
    subject: 'Verify your PalgharBites account',
    text: `Hello ${name},

Thank you for registering with PalgharBites.

Please verify your email address by opening this link:

${verificationUrl}

This verification link will expire in 30 minutes.

If you did not create this account, you can ignore this email.

PalgharBites`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:24px;background:#f8f8f8;">
        <div style="background:#ffffff;border-radius:14px;padding:28px;">
          <h2 style="margin-top:0;color:#222;">
            🍽️ Palghar<span style="color:#f97316;">Bites</span>
          </h2>

          <h3>Verify your email address</h3>

          <p>Hello <b>${escapeHtml(name)}</b>,</p>

          <p>
            Thank you for creating your PalgharBites student account.
            Please verify your email address before logging in.
          </p>

          <div style="text-align:center;margin:28px 0;">
            <a
              href="${verificationUrl}"
              style="
                display:inline-block;
                background:#f97316;
                color:#ffffff;
                text-decoration:none;
                padding:13px 24px;
                border-radius:8px;
                font-weight:bold;
              "
            >
              Verify My Email
            </a>
          </div>

          <p style="font-size:13px;color:#666;">
            This verification link will expire in <b>30 minutes</b>.
          </p>

          <p style="font-size:13px;color:#666;">
            If you did not create this account, you can safely ignore this email.
          </p>

          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">

          <p style="font-size:12px;color:#888;">
            PalgharBites — College Food Ordering Platform
          </p>
        </div>
      </div>
    `
  });
}

// ---------------- AUTH API ----------------
app.get('/api/auth/verify-email', (req, res) => {
  try {
    const token = String(req.query.token || '');

    if (!token) {
      return res.status(400).send(`
        <h2>Email verification failed</h2>
        <p>Verification token is missing.</p>
      `);
    }

    const user = db.prepare(`
      SELECT id, name, email, email_verified, verification_expires_at
      FROM users
      WHERE verification_token=?
    `).get(token);

    if (!user) {
      return res.status(400).send(`
        <h2>Invalid verification link</h2>
        <p>This verification link is invalid or has already been used.</p>
      `);
    }

    if (Number(user.email_verified) === 1) {
      return res.send(`
        <h2>Email already verified ✅</h2>
        <p>Your PalgharBites account is already verified.</p>
        <p><a href="${APP_URL}">Go to PalgharBites</a></p>
      `);
    }

    if (
      !user.verification_expires_at ||
      new Date(user.verification_expires_at).getTime() < Date.now()
    ) {
      return res.status(400).send(`
        <h2>Verification link expired</h2>
        <p>This verification link has expired. Please register again.</p>
      `);
    }

    db.prepare(`
      UPDATE users
      SET
        email_verified=1,
        verification_token=NULL,
        verification_expires_at=NULL
      WHERE id=?
    `).run(user.id);

    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Email Verified - PalgharBites</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">

        <style>
          body {
            font-family: Arial, sans-serif;
            background: #f8f8f8;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
          }

          .card {
            background: white;
            padding: 35px;
            border-radius: 16px;
            max-width: 420px;
            width: 90%;
            text-align: center;
            box-shadow: 0 5px 25px rgba(0,0,0,.08);
          }

          h1 {
            margin-bottom: 10px;
          }

          p {
            color: #666;
            line-height: 1.5;
          }

          a {
            display: inline-block;
            margin-top: 15px;
            padding: 12px 22px;
            background: #f97316;
            color: white;
            text-decoration: none;
            border-radius: 8px;
            font-weight: bold;
          }
        </style>
      </head>

      <body>
        <div class="card">
          <h1>🎉 Email Verified!</h1>

          <p>
            Your PalgharBites account has been successfully verified.
          </p>

          <p>
            You can now log in using your email and password.
          </p>

          <a href="${APP_URL}">
            Go to PalgharBites
          </a>
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    console.error('Email verification error:', error);

    res.status(500).send(`
      <h2>Verification failed</h2>
      <p>Something went wrong. Please try again later.</p>
    `);
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    if (!name || !email || !password || !phone) {
      return res.status(400).json({
        error: 'Name, email, password and mobile number are required.'
      });
    }

    if (!/^[0-9]{10}$/.test(String(phone).trim())) {
      return res.status(400).json({
        error: 'Please enter a valid 10-digit mobile number.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const exists = db
      .prepare('SELECT id FROM users WHERE email=?')
      .get(normalizedEmail);

    if (exists) {
      return res.status(409).json({
        error: 'An account with this email already exists.'
      });
    }

    const verificationToken = crypto
      .randomBytes(32)
      .toString('hex');

    const verificationExpiresAt =
      new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const passwordHash = bcrypt.hashSync(password, 10);

    const id = db.prepare(`
      INSERT INTO users (
        name,
        email,
        password_hash,
        phone,
        role,
        status,
        email_verified,
        verification_token,
        verification_expires_at
      )
      VALUES (?, ?, ?, ?, 'student', 'active', 0, ?, ?)
    `).run(
      String(name).trim(),
      normalizedEmail,
      passwordHash,
      String(phone).trim(),
      verificationToken,
      verificationExpiresAt
    ).lastInsertRowid;

    db.prepare(
      'INSERT INTO student_profiles (user_id) VALUES (?)'
    ).run(id);

    try {
      await sendVerificationEmail(
        normalizedEmail,
        String(name).trim(),
        verificationToken
      );
    } catch (mailError) {
      console.error('Verification email failed:', mailError);

      db.prepare(
        'DELETE FROM student_profiles WHERE user_id=?'
      ).run(id);

      db.prepare(
        'DELETE FROM users WHERE id=?'
      ).run(id);

      return res.status(500).json({
        error: 'Unable to send verification email. Please check your email address or try again later.'
      });
    }

    res.json({
      ok: true,
      requiresVerification: true,
      message: 'Registration successful. Please check your email and verify your account before logging in.'
    });

  } catch (e) {
    console.error('Registration error:', e);

    res.status(500).json({
      error: 'Registration failed. Please try again.'
    });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (user.status !== 'active') return res.status(403).json({ error: 'Your account has been deactivated.' });
  if (user.role === 'student' && Number(user.email_verified) !== 1) {
  return res.status(403).json({
    error: 'Please verify your email before logging in. Check your inbox for the verification email.'
  });
}
  res.json({ token: sign(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.get('/api/auth/me', auth(), (req, res) => {
  const u = db.prepare('SELECT id,name,email,phone,role,status FROM users WHERE id=?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  let profile = null;
  if (u.role === 'student') profile = db.prepare('SELECT college,default_address FROM student_profiles WHERE user_id=?').get(u.id) || null;
  res.json({ user: u, profile });
});

// ---------------- PUBLIC: HOTELS / FOOD ----------------
app.get('/api/hotels', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let sql = `SELECT h.id,h.name,h.description,h.image_url,h.rating,h.distance_from_college as distance,h.prep_time,h.is_open,h.status,
    (SELECT COUNT(*) FROM food_items f WHERE f.hotel_id=h.id AND f.is_available=1) AS items
    FROM hotels h WHERE h.status='active'`;
  const rows = db.prepare(sql).all().filter(h => !q || h.name.toLowerCase().includes(q) || (h.description||'').toLowerCase().includes(q));
  res.json(rows);
});

app.get('/api/hotels/:id', (req, res) => {
  const h = db.prepare(`SELECT id,name,description,image_url,rating,distance_from_college as distance,prep_time,is_open,address,phone
    FROM hotels WHERE id=? AND status='active'`).get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hotel not found.' });
  const menu = db.prepare(`SELECT f.*, c.name AS category FROM food_items f
    LEFT JOIN food_categories c ON c.id=f.category_id
    WHERE f.hotel_id=? AND f.is_available=1 ORDER BY f.is_popular DESC, f.name`).all(h.id);
  h.menu = menu;
  res.json(h);
});

app.get('/api/food', (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const cat = req.query.category || '';
  const veg = req.query.veg || ''; // 'veg' | 'nonveg' | ''
  const sort = req.query.sort || 'popular';
  const maxPrice = req.query.maxPrice || '';
  let sql = `SELECT f.*, h.name AS hotel_name, h.distance_from_college AS hotel_distance, c.name AS category
    FROM food_items f JOIN hotels h ON h.id=f.hotel_id LEFT JOIN food_categories c ON c.id=f.category_id
    WHERE f.is_available=1 AND h.status='active' AND h.is_open=1`;
  const rows = db.prepare(sql).all();
  let out = rows.filter(f => {
    if (q && !(f.name.toLowerCase().includes(q) || f.hotel_name.toLowerCase().includes(q) || (f.category||'').toLowerCase().includes(q))) return false;
    if (cat && f.category !== cat) return false;
    if (veg === 'veg' && !f.is_veg) return false;
    if (veg === 'nonveg' && f.is_veg) return false;
    if (maxPrice && f.price > parseFloat(maxPrice)) return false;
    return true;
  });
  if (sort === 'price_low') out.sort((a,b)=>a.price-b.price);
  else if (sort === 'price_high') out.sort((a,b)=>b.price-a.price);
  else if (sort === 'fastest') out.sort((a,b)=>(a.preparation_time||'').localeCompare(b.preparation_time||''));
  else if (sort === 'nearest') out.sort((a,b)=>a.hotel_distance-b.hotel_distance);
  else out.sort((a,b)=>(b.is_popular-a.is_popular)||(a.price-b.price));
  res.json(out);
});

app.get('/api/food/:id', (req, res) => {
  const f = db.prepare(`SELECT f.*, h.name AS hotel_name, c.name AS category FROM food_items f
    JOIN hotels h ON h.id=f.hotel_id LEFT JOIN food_categories c ON c.id=f.category_id
    WHERE f.id=? AND f.is_available=1`).get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Food item not found or unavailable.' });
  res.json(f);
});

app.get('/api/categories', (req, res) => {
  res.json(db.prepare('SELECT * FROM food_categories').all());
});

// ---------------- CART (students) ----------------
app.get('/api/cart', auth(['student']), (req, res) => {
  const items = db.prepare(`SELECT ci.id, ci.quantity, ci.instructions, f.id AS food_item_id, f.name, f.price, f.image_url, f.is_veg, h.name AS hotel_name, h.id AS hotel_id
    FROM cart_items ci JOIN food_items f ON f.id=ci.food_item_id JOIN hotels h ON h.id=f.hotel_id
    WHERE ci.user_id=?`).all(req.user.id);
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const delivery = items.length ? parseFloat(getSetting('delivery_charge', '20')) : 0;
  res.json({ items, subtotal, delivery_charge: delivery, total: subtotal + delivery, hotel_id: items.length ? items[0].hotel_id : null });
});

app.post('/api/cart', auth(['student']), (req, res) => {
  const { food_item_id, quantity, instructions } = req.body;
  const f = db.prepare('SELECT * FROM food_items WHERE id=? AND is_available=1').get(food_item_id);
  if (!f) return res.status(400).json({ error: 'This item is unavailable.' });
  const existing = db.prepare('SELECT * FROM cart_items WHERE user_id=? AND food_item_id=?').get(req.user.id, food_item_id);
  if (existing) {
    db.prepare('UPDATE cart_items SET quantity=quantity+?, instructions=COALESCE(?,instructions) WHERE id=?')
      .run(quantity || 1, instructions || null, existing.id);
  } else {
    // one hotel per cart
    const other = db.prepare(`SELECT ci.id FROM cart_items ci JOIN food_items f ON f.id=ci.food_item_id WHERE ci.user_id=? AND f.hotel_id != ?`).get(req.user.id, f.hotel_id);
    if (other) db.prepare('DELETE FROM cart_items WHERE user_id=?').run(req.user.id);
    db.prepare('INSERT INTO cart_items (user_id,food_item_id,quantity,instructions) VALUES (?,?,?,?)')
      .run(req.user.id, food_item_id, quantity || 1, instructions || null);
  }
  res.json({ ok: true });
});

app.patch('/api/cart/:id', auth(['student']), (req, res) => {
  const { quantity, instructions } = req.body;
  const item = db.prepare('SELECT * FROM cart_items WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'Cart item not found.' });
  if (quantity !== undefined) {
    if (quantity <= 0) db.prepare('DELETE FROM cart_items WHERE id=?').run(item.id);
    else db.prepare('UPDATE cart_items SET quantity=? WHERE id=?').run(quantity, item.id);
  }
  if (instructions !== undefined) db.prepare('UPDATE cart_items SET instructions=? WHERE id=?').run(instructions, item.id);
  res.json({ ok: true });
});

app.delete('/api/cart/:id', auth(['student']), (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------------- ORDERS ----------------
const ORDER_FLOW = ['ORDER_PLACED','ACCEPTED','PREPARING','READY','DELIVERY_ASSIGNED','PICKED_UP','ON_THE_WAY','REACHED_GATE','DELIVERED'];

function orderWithItems(o) {
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id);
  return o;
}

app.post('/api/orders', auth(['student']), (req, res) => {
  const { gate, delivery_instructions, payment_method } = req.body;
  const cart = db.prepare(`SELECT ci.quantity, ci.instructions, f.id AS food_item_id, f.name, f.price, f.image_url, f.hotel_id
    FROM cart_items ci JOIN food_items f ON f.id=ci.food_item_id WHERE ci.user_id=?`).all(req.user.id);
  if (!cart.length) return res.status(400).json({ error: 'Your cart is empty.' });
  if (!gate) return res.status(400).json({ error: 'Please select a pickup gate.' });
  const codEnabled = getSetting('cod_enabled', 'true') === 'true';
  const method = payment_method === 'COD' ? 'COD' : 'ONLINE';
  if (method === 'COD' && !codEnabled) return res.status(400).json({ error: 'Cash on collection is currently disabled.' });

  const hotelId = cart[0].hotel_id;
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=? AND is_open=1').get(hotelId);
  if (!hotel) return res.status(400).json({ error: 'This outlet is currently closed.' });

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const delivery = parseFloat(getSetting('delivery_charge', '20'));
  const total = subtotal + delivery;
  const orderNumber = 'PB' + (10245 + db.prepare('SELECT COUNT(*) c FROM orders').get().c);

  const tx = db.transaction(() => {
    const oid = db.prepare(`INSERT INTO orders (order_number,student_id,hotel_id,status,subtotal,delivery_charge,total,delivery_address,gate,delivery_instructions)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(orderNumber, req.user.id, hotelId, 'ORDER_PLACED', subtotal, delivery, total,
      'St. John College of Engineering & Management, Palghar', gate, delivery_instructions || '').lastInsertRowid;
    const insItem = db.prepare('INSERT INTO order_items (order_id,food_item_id,name,image_url,quantity,price) VALUES (?,?,?,?,?,?)');
    for (const i of cart) insItem.run(oid, i.food_item_id, i.name, i.image_url, i.quantity, i.price);
    if (method === 'COD') {
      db.prepare('INSERT INTO payments (order_id,provider,amount,currency,status,method) VALUES (?,?,?,?,?,?)')
        .run(oid, 'cod', total, 'INR', 'COD', 'Cash on Delivery');
    }
    db.prepare('DELETE FROM cart_items WHERE user_id=?').run(req.user.id);
    return oid;
  });
  const oid = tx();
  const order = orderWithItems(db.prepare('SELECT * FROM orders WHERE id=?').get(oid));
  // notify hotel owner
  const hu = db.prepare('SELECT user_id FROM hotels WHERE id=?').get(hotelId);
  if (hu) notify(hu.user_id, oid, 'New Order 🔔', `New order ${orderNumber} received. Please accept or reject.`);
  res.json({ order, payment_method: method });
});

app.get('/api/orders', auth(), (req, res) => {
  let rows;
  if (req.user.role === 'student') rows = db.prepare('SELECT * FROM orders WHERE student_id=? ORDER BY id DESC').all(req.user.id);
  else if (req.user.role === 'hotel') rows = db.prepare('SELECT o.*, u.name AS student_name, u.phone AS student_phone FROM orders o JOIN users u ON u.id=o.student_id WHERE o.hotel_id=(SELECT id FROM hotels WHERE user_id=?) ORDER BY o.id DESC').all(req.user.id);
  else if (req.user.role === 'delivery') rows = db.prepare('SELECT o.*, u.name AS student_name, u.phone AS student_phone, h.name AS hotel_name FROM orders o JOIN users u ON u.id=o.student_id JOIN hotels h ON h.id=o.hotel_id WHERE o.delivery_boy_id=? ORDER BY o.id DESC').all(req.user.id);
  else rows = db.prepare('SELECT o.*, u.name AS student_name FROM orders o JOIN users u ON u.id=o.student_id ORDER BY o.id DESC').all();
  res.json(rows.map(orderWithItems));
});

app.get('/api/orders/:id', auth(), (req, res) => {
  const o = db.prepare(`SELECT o.*, u.name AS student_name, u.phone AS student_phone, h.name AS hotel_name, h.image_url AS hotel_image
    FROM orders o JOIN users u ON u.id=o.student_id JOIN hotels h ON h.id=o.hotel_id WHERE o.id=?`).get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const allowed = (req.user.role === 'student' && o.student_id === req.user.id) ||
    (req.user.role === 'hotel' && db.prepare('SELECT user_id FROM hotels WHERE id=?').get(o.hotel_id)?.user_id === req.user.id) ||
    (req.user.role === 'delivery' && o.delivery_boy_id === req.user.id) ||
    req.user.role === 'admin';
  if (!allowed) return res.status(403).json({ error: 'Not authorized.' });
  orderWithItems(o);
  const pay = db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id DESC').get(o.id);
  o.payment = pay || null;
  res.json(o);
});

// status transitions with role checks
app.patch('/api/orders/:id/status', auth(['hotel', 'delivery']), (req, res) => {
  const { status } = req.body;
  const o = db.prepare('SELECT * FROM orders WHERE id=?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });

  if (req.user.role === 'hotel') {
    const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(o.hotel_id);
    if (!hotel || hotel.user_id !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });
    const allowed = ['ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'DELIVERY_ASSIGNED'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status for hotel.' });
    if (status === 'DELIVERY_ASSIGNED') {
      const dbid = req.body.delivery_boy_id;
      const duser = db.prepare(`SELECT * FROM users WHERE id=? AND role='delivery' AND status='active'`).get(dbid);
      if (!duser) return res.status(400).json({ error: 'Please select a valid delivery boy.' });
      db.prepare('UPDATE orders SET delivery_boy_id=? WHERE id=?').run(dbid, o.id);
      db.prepare('INSERT INTO delivery_tracking (order_id,delivery_boy_id,status) VALUES (?,?,?)').run(o.id, dbid, 'ASSIGNED');
      notify(dbid, o.id, 'New Delivery 🛵', `You have been assigned order ${o.order_number}. Please pick it up from the hotel.`);
    }
    if (status === 'ACCEPTED') db.prepare('UPDATE orders SET accepted_at=CURRENT_TIMESTAMP WHERE id=?').run(o.id);
    if (status === 'READY') db.prepare('UPDATE orders SET ready_at=CURRENT_TIMESTAMP WHERE id=?').run(o.id);
    if (status === 'REJECTED' && o.payment) { /* keep payment record; refund handled by admin in production */ }
  } else if (req.user.role === 'delivery') {
    if (o.delivery_boy_id !== req.user.id) return res.status(403).json({ error: 'Not authorized.' });
    const allowed = ['PICKED_UP', 'ON_THE_WAY', 'REACHED_GATE', 'DELIVERED'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status for delivery.' });
    if (status === 'DELIVERED') db.prepare('UPDATE orders SET delivered_at=CURRENT_TIMESTAMP WHERE id=?').run(o.id);
    db.prepare('INSERT INTO delivery_tracking (order_id,delivery_boy_id,status) VALUES (?,?,?)').run(o.id, req.user.id, status);
  }
  db.prepare('UPDATE orders SET status=? WHERE id=?').run(status, o.id);

  const titles = {
    ACCEPTED: 'Order Accepted ✓', REJECTED: 'Order Rejected', PREPARING: 'Preparing Your Food 👨‍🍳',
    READY: 'Food Ready 🍽️', DELIVERY_ASSIGNED: 'Delivery Assigned 🛵', PICKED_UP: 'Order Picked Up 🛵',
    ON_THE_WAY: 'On The Way 🛵', REACHED_GATE: 'Your order has arrived! 📍', DELIVERED: 'Order Delivered 🎉'
  };
  const msgs = {
    REACHED_GATE: `Your PalgharBites order ${o.order_number} has reached the college gate. Please come to the gate to collect your order.`,
    DELIVERED: `Your order ${o.order_number} has been delivered. Enjoy your meal!`
  };
  if (titles[status]) notify(o.student_id, o.id, titles[status], msgs[status] || `Order ${o.order_number}: ${titles[status].replace(' ✓','').replace(' 📍',' at the college gate')}.`);
  if (status === 'DELIVERED') notify(o.student_id, o.id, titles.DELIVERED, msgs.DELIVERED);
  const updated = orderWithItems(db.prepare('SELECT * FROM orders WHERE id=?').get(o.id));
  res.json(updated);
});

// ---------------- PAYMENTS ----------------
app.post('/api/payments/create', auth(['student']), async (req, res) => {
  const { order_id } = req.body;
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND student_id=?').get(order_id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const existing = db.prepare('SELECT * FROM payments WHERE order_id=?').get(o.id);
  if (existing && existing.status === 'PAID') return res.status(409).json({ error: 'Order is already paid.' });

  if (RZP_KEY_ID && RZP_KEY_SECRET) {
    try {
      const auth = Buffer.from(RZP_KEY_ID + ':' + RZP_KEY_SECRET).toString('base64');
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Authorization': 'Basic ' + auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Math.round(o.total * 100), currency: 'INR', receipt: o.order_number })
      });
      const rzp = await r.json();
      if (!rzp.id) throw new Error('gateway error');
      if (existing) db.prepare('UPDATE payments SET provider_order_id=?, status="PROCESSING", updated_at=CURRENT_TIMESTAMP WHERE id=?').run(rzp.id, existing.id);
      else db.prepare('INSERT INTO payments (order_id,provider,provider_order_id,amount,currency,status) VALUES (?,?,?,?,?,?)')
        .run(o.id, 'razorpay', rzp.id, o.total, 'INR', 'PROCESSING');
      return res.json({ mode: 'razorpay', key_id: RZP_KEY_ID, razorpay_order_id: rzp.id, amount: Math.round(o.total * 100), order_number: o.order_number });
    } catch (e) {
      return res.status(502).json({ error: 'Payment gateway unavailable. Please try again or use Cash on Collection.' });
    }
  }
  // Dev mode: simulated gateway
  const mockId = 'order_dev_' + crypto.randomBytes(8).toString('hex');
  if (existing) db.prepare('UPDATE payments SET provider_order_id=?, status="PROCESSING", updated_at=CURRENT_TIMESTAMP WHERE id=?').run(mockId, existing.id);
  else db.prepare('INSERT INTO payments (order_id,provider,provider_order_id,amount,currency,status) VALUES (?,?,?,?,?,?)')
    .run(o.id, 'razorpay_dev', mockId, o.total, 'INR', 'PROCESSING');
  res.json({ mode: 'dev', razorpay_order_id: mockId, amount: Math.round(o.total * 100), order_number: o.order_number });
});

app.post('/api/payments/verify', auth(['student']), (req, res) => {
  const { order_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  const o = db.prepare('SELECT * FROM orders WHERE id=? AND student_id=?').get(order_id, req.user.id);
  if (!o) return res.status(404).json({ error: 'Order not found.' });
  const pay = db.prepare('SELECT * FROM payments WHERE order_id=?').get(o.id);
  if (!pay) return res.status(400).json({ error: 'No payment initiated for this order.' });
  if (pay.status === 'PAID') return res.json({ ok: true, already: true });

  let verified = false, paymentId = razorpay_payment_id || ('pay_dev_' + crypto.randomBytes(8).toString('hex'));
  if (pay.provider === 'razorpay') {
    verified = verifyRazorpaySignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!verified) return res.status(400).json({ error: 'Payment signature verification failed. Order not confirmed.' });
  } else {
    verified = true; // dev simulated gateway
  }
  db.prepare(`UPDATE payments SET provider_payment_id=?, status='PAID', method=COALESCE(method,'Online'), signature_verified=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(paymentId, verified ? 1 : 0, pay.id);
  const hu = db.prepare('SELECT user_id FROM hotels WHERE id=?').get(o.hotel_id);
  if (hu) notify(hu.user_id, o.id, 'Payment Received 💳', `Payment of ₹${o.total} received for order ${o.order_number}.`);
  notify(req.user.id, o.id, 'Payment Successful 🎉', `Your payment of ₹${o.total} for order ${o.order_number} was successful.`);
  res.json({ ok: true, order_number: o.order_number });
});

app.post('/api/payments/webhook', express.json({ type: '*/*' }), (req, res) => {
  // Optional webhook support: mark payment paid on payment.captured when signature valid
  res.json({ ok: true });
});

// ---------------- NOTIFICATIONS ----------------
app.get('/api/notifications', auth(), (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(req.user.id);
  const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND is_read=0').get(req.user.id).c;
  res.json({ notifications: rows, unread });
});
app.patch('/api/notifications/read', auth(), (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.user.id);
  res.json({ ok: true });
});

// ---------------- PROFILE ----------------
app.patch('/api/profile', auth(), (req, res) => {
  const { name, phone, default_address } = req.body;
  if (name) db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
  if (phone !== undefined) db.prepare('UPDATE users SET phone=? WHERE id=?').run(phone, req.user.id);
  if (req.user.role === 'student' && default_address !== undefined) {
    if (!db.prepare('SELECT id FROM student_profiles WHERE user_id=?').get(req.user.id))
      db.prepare('INSERT INTO student_profiles (user_id, default_address) VALUES (?,?)').run(req.user.id, default_address);
    else db.prepare('UPDATE student_profiles SET default_address=? WHERE user_id=?').run(default_address, req.user.id);
  }
  res.json({ ok: true });
});

// ---------------- HOTEL DASHBOARD ----------------
app.get('/api/hotel/dashboard', auth(['hotel']), (req, res) => {
  const hotel = db.prepare('SELECT * FROM hotels WHERE user_id=?').get(req.user.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel profile not found.' });
  const stats = {
    new_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE hotel_id=? AND status='ORDER_PLACED'`).get(hotel.id).c,
    preparing: db.prepare(`SELECT COUNT(*) c FROM orders WHERE hotel_id=? AND status IN ('ACCEPTED','PREPARING')`).get(hotel.id).c,
    ready: db.prepare(`SELECT COUNT(*) c FROM orders WHERE hotel_id=? AND status='READY'`).get(hotel.id).c,
    completed: db.prepare(`SELECT COUNT(*) c FROM orders WHERE hotel_id=? AND status='DELIVERED'`).get(hotel.id).c,
    today_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE hotel_id=? AND date(created_at)=date('now')`).get(hotel.id).c,
    today_revenue: db.prepare(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE hotel_id=? AND date(created_at)=date('now') AND status != 'REJECTED'`).get(hotel.id).s
  };
  const menu = db.prepare(`SELECT f.*, c.name AS category FROM food_items f LEFT JOIN food_categories c ON c.id=f.category_id WHERE f.hotel_id=? ORDER BY f.id DESC`).all(hotel.id);
  res.json({ hotel, stats, menu });
});

app.get('/api/hotel/delivery-boys', auth(['hotel']), (req, res) => {
  res.json(db.prepare(`SELECT id, name FROM users WHERE role='delivery' AND status='active'`).all());
});

app.post('/api/hotel/food', auth(['hotel']), (req, res) => {
  const hotel = db.prepare('SELECT * FROM hotels WHERE user_id=?').get(req.user.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel profile not found.' });
  const { name, description, price, category_id, image_url, image_alt, is_veg, preparation_time, is_available } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Food name and price are required.' });
  const id = db.prepare(`INSERT INTO food_items (hotel_id,category_id,name,description,price,image_url,image_alt,is_veg,preparation_time,is_available)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(hotel.id, category_id || null, name, description || '', parseFloat(price),
    image_url || '', image_alt || name, is_veg ? 1 : 0, preparation_time || '10-15 min', is_available === false ? 0 : 1).lastInsertRowid;
  res.json(db.prepare('SELECT * FROM food_items WHERE id=?').get(id));
});

app.patch('/api/hotel/food/:id', auth(['hotel']), (req, res) => {
  const hotel = db.prepare('SELECT * FROM hotels WHERE user_id=?').get(req.user.id);
  const f = db.prepare('SELECT * FROM food_items WHERE id=?').get(req.params.id);
  if (!f || !hotel || f.hotel_id !== hotel.id) return res.status(404).json({ error: 'Food item not found.' });
  const b = req.body;
  db.prepare(`UPDATE food_items SET name=?, description=?, price=?, category_id=?, image_url=?, image_alt=?, is_veg=?, preparation_time=?, is_available=? WHERE id=?`)
    .run(b.name ?? f.name, b.description ?? f.description, b.price ?? f.price, b.category_id ?? f.category_id,
      b.image_url ?? f.image_url, b.image_alt ?? f.image_alt, b.is_veg !== undefined ? (b.is_veg ? 1 : 0) : f.is_veg,
      b.preparation_time ?? f.preparation_time, b.is_available !== undefined ? (b.is_available ? 1 : 0) : f.is_available, f.id);
  res.json(db.prepare('SELECT * FROM food_items WHERE id=?').get(f.id));
});

app.delete('/api/hotel/food/:id', auth(['hotel']), (req, res) => {
  const hotel = db.prepare('SELECT * FROM hotels WHERE user_id=?').get(req.user.id);
  const f = db.prepare('SELECT * FROM food_items WHERE id=?').get(req.params.id);
  if (!f || !hotel || f.hotel_id !== hotel.id) return res.status(404).json({ error: 'Food item not found.' });
  db.prepare('DELETE FROM food_items WHERE id=?').run(f.id);
  res.json({ ok: true });
});

app.patch('/api/hotel/settings', auth(['hotel']), (req, res) => {
  const hotel = db.prepare('SELECT * FROM hotels WHERE user_id=?').get(req.user.id);
  if (!hotel) return res.status(404).json({ error: 'Hotel profile not found.' });
  const { is_open, image_url, description } = req.body;
  if (is_open !== undefined) db.prepare('UPDATE hotels SET is_open=? WHERE id=?').run(is_open ? 1 : 0, hotel.id);
  if (image_url) db.prepare('UPDATE hotels SET image_url=? WHERE id=?').run(image_url, hotel.id);
  if (description) db.prepare('UPDATE hotels SET description=? WHERE id=?').run(description, hotel.id);
  res.json({ ok: true });
});

// ---------------- DELIVERY DASHBOARD ----------------
app.get('/api/delivery/dashboard', auth(['delivery']), (req, res) => {
  const orders = db.prepare(`SELECT o.*, u.name AS student_name, u.phone AS student_phone, h.name AS hotel_name, h.address AS hotel_address
    FROM orders o JOIN users u ON u.id=o.student_id JOIN hotels h ON h.id=o.hotel_id
    WHERE o.delivery_boy_id=? AND o.status IN ('DELIVERY_ASSIGNED','PICKED_UP','ON_THE_WAY','REACHED_GATE')
    ORDER BY o.id DESC`).all(req.user.id).map(orderWithItems);
  const history = db.prepare(`SELECT o.*, u.name AS student_name, h.name AS hotel_name
    FROM orders o JOIN users u ON u.id=o.student_id JOIN hotels h ON h.id=o.hotel_id
    WHERE o.delivery_boy_id=? AND o.status IN ('DELIVERED','CANCELLED','REJECTED')
    ORDER BY o.id DESC LIMIT 20`).all(req.user.id).map(orderWithItems);
  res.json({ active: orders, history });
});

// ---------------- ADMIN ----------------
app.get('/api/admin/stats', auth(['admin']), (req, res) => {
  const s = {
    students: db.prepare(`SELECT COUNT(*) c FROM users WHERE role='student'`).get().c,
    hotels: db.prepare(`SELECT COUNT(*) c FROM hotels`).get().c,
    delivery_boys: db.prepare(`SELECT COUNT(*) c FROM users WHERE role='delivery'`).get().c,
    today_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE date(created_at)=date('now')`).get().c,
    active_orders: db.prepare(`SELECT COUNT(*) c FROM orders WHERE status NOT IN ('DELIVERED','CANCELLED','REJECTED')`).get().c,
    today_revenue: db.prepare(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE date(created_at)=date('now') AND status != 'REJECTED'`).get().s,
    online_payments: db.prepare(`SELECT COUNT(*) c FROM payments WHERE status='PAID' AND method != 'Cash on Delivery'`).get().c,
    cod_orders: db.prepare(`SELECT COUNT(*) c FROM payments WHERE method='Cash on Delivery'`).get().c,
    total_revenue: db.prepare(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE status != 'REJECTED'`).get().s
  };
  res.json(s);
});
app.get('/api/admin/users', auth(['admin']), (req, res) => {
  res.json(db.prepare(`SELECT id,name,email,phone,role,status,created_at FROM users ORDER BY id`).all());
});
app.patch('/api/admin/users/:id', auth(['admin']), (req, res) => {
  const { status } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.role === 'admin') return res.status(400).json({ error: 'Cannot modify admin accounts.' });
  if (status) db.prepare('UPDATE users SET status=? WHERE id=?').run(status, u.id);
  res.json({ ok: true });
});
app.get('/api/admin/hotels', auth(['admin']), (req, res) => {
  res.json(db.prepare(`SELECT h.*, u.email, u.status AS user_status FROM hotels h JOIN users u ON u.id=h.user_id ORDER BY h.id`).all());
});
app.patch('/api/admin/hotels/:id', auth(['admin']), (req, res) => {
  const { status } = req.body;
  const h = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Hotel not found.' });
  if (status) db.prepare('UPDATE hotels SET status=? WHERE id=?').run(status, h.id);
  res.json({ ok: true });
});
app.post('/api/admin/hotels', auth(['admin']), (req, res) => {
  const { name, email, password, phone, description, address, latitude, longitude, distance_from_college, image_url } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase())) return res.status(409).json({ error: 'Email already exists.' });
  const uid = db.prepare('INSERT INTO users (name,email,password_hash,phone,role,status) VALUES (?,?,?,?,?,?)')
    .run(name, email.toLowerCase(), bcrypt.hashSync(password, 10), phone || '', 'hotel', 'active').lastInsertRowid;
  const hid = db.prepare(`INSERT INTO hotels (user_id,name,description,address,latitude,longitude,distance_from_college,phone,status,image_url)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uid, name, description || '', address || '', latitude || null, longitude || null,
    distance_from_college || null, phone || '', 'active', image_url || '').lastInsertRowid;
  res.json(db.prepare('SELECT * FROM hotels WHERE id=?').get(hid));
});
app.patch('/api/admin/settings', auth(['admin']), (req, res) => {
  const { delivery_charge, cod_enabled } = req.body;
  if (delivery_charge !== undefined) {
    if (!db.prepare('SELECT key FROM settings WHERE key=?').get('delivery_charge'))
      db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('delivery_charge', String(delivery_charge));
    else db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(delivery_charge), 'delivery_charge');
  }
  if (cod_enabled !== undefined) {
    if (!db.prepare('SELECT key FROM settings WHERE key=?').get('cod_enabled'))
      db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('cod_enabled', String(cod_enabled));
    else db.prepare('UPDATE settings SET value=? WHERE key=?').run(String(cod_enabled), 'cod_enabled');
  }
  res.json({ ok: true });
});
app.get('/api/admin/settings', auth(['admin']), (req, res) => {
  res.json({
    delivery_charge: parseFloat(getSetting('delivery_charge', '20')),
    cod_enabled: getSetting('cod_enabled', 'true') === 'true'
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`PalgharBites running on http://localhost:${PORT}`);
  console.log(`Payment gateway: ${RZP_KEY_ID ? 'Razorpay (live keys)' : 'Development simulator (set RAZORPAY_KEY_ID/SECRET in .env for real payments)'}`);
});
