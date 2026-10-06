require('dotenv').config();
const path = require('path');
const fs = require('fs');

process.env.DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'palgharbites.db');
fs.mkdirSync(path.dirname(process.env.DB_PATH), { recursive: true });
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'palgharbites_dev_secret_change_me';
process.env.PORT = process.env.PORT || '3000';

const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- SCHEMA ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('student','hotel','delivery','admin')),
  status TEXT NOT NULL DEFAULT 'active',

  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  verification_expires_at TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS student_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  college TEXT DEFAULT 'St. John College of Engineering & Management, Palghar',
  default_address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS hotels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,
  distance_from_college REAL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  rating REAL DEFAULT 4.0,
  image_url TEXT,
  prep_time TEXT,
  is_open INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS food_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  image_url TEXT
);
CREATE TABLE IF NOT EXISTS food_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  category_id INTEGER REFERENCES food_categories(id),
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  image_url TEXT,
  image_alt TEXT,
  is_veg INTEGER NOT NULL DEFAULT 1,
  preparation_time TEXT,
  is_available INTEGER NOT NULL DEFAULT 1,
  is_popular INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  student_id INTEGER NOT NULL REFERENCES users(id),
  hotel_id INTEGER NOT NULL REFERENCES hotels(id),
  delivery_boy_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'ORDER_PLACED',
  subtotal REAL NOT NULL,
  delivery_charge REAL NOT NULL,
  total REAL NOT NULL,
  delivery_address TEXT NOT NULL,
  gate TEXT NOT NULL,
  delivery_instructions TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at TEXT,
  ready_at TEXT,
  delivered_at TEXT
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  food_item_id INTEGER REFERENCES food_items(id),
  name TEXT,
  image_url TEXT,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_order_id TEXT,
  provider_payment_id TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'PENDING',
  method TEXT,
  signature_verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS delivery_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  delivery_boy_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS cart_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  food_item_id INTEGER NOT NULL REFERENCES food_items(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  instructions TEXT,
  UNIQUE(user_id, food_item_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_student ON orders(student_id);
CREATE INDEX IF NOT EXISTS idx_orders_hotel ON orders(hotel_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery ON orders(delivery_boy_id);
CREATE INDEX IF NOT EXISTS idx_food_hotel ON food_items(hotel_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
`);

// ---------- EMAIL VERIFICATION MIGRATION ----------
function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing(
  'users',
  'email_verified',
  'INTEGER NOT NULL DEFAULT 0'
);

addColumnIfMissing(
  'users',
  'verification_token',
  'TEXT'
);

addColumnIfMissing(
  'users',
  'verification_expires_at',
  'TEXT'
);

// ---------- SEED ----------
function seed() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount > 0) return;
  const hash = (p) => require('bcryptjs').hashSync(p, 10);
  const insUser = db.prepare('INSERT INTO users (name,email,password_hash,phone,role,status) VALUES (?,?,?,?,?,?)');

  const admin = insUser.run('Admin', 'admin@palgharbites.com', hash('admin123'), '9800000001', 'admin', 'active').lastInsertRowid;
  const student = insUser.run('Tejas', 'student@palgharbites.com', hash('student123'), '9800000002', 'student', 'active').lastInsertRowid;
  const delivery = insUser.run('Ramesh (Delivery Boy)', 'delivery@palgharbites.com', hash('delivery123'), '9800000003', 'delivery', 'active').lastInsertRowid;
  const deviUser = insUser.run('Devi Krupa', 'devi@palgharbites.com', hash('hotel123'), '9800000004', 'hotel', 'active').lastInsertRowid;
  const badshahUser = insUser.run('Badshah Biryani', 'badshah@palgharbites.com', hash('hotel123'), '9800000005', 'hotel', 'active').lastInsertRowid;
  const topcakeUser = insUser.run('Top Cake', 'topcake@palgharbites.com', hash('hotel123'), '9800000006', 'hotel', 'active').lastInsertRowid;
  const delivery2 = insUser.run('Suresh (Delivery Boy)', 'delivery2@palgharbites.com', hash('delivery123'), '9800000007', 'delivery', 'active').lastInsertRowid;

  db.prepare('INSERT INTO student_profiles (user_id, college, default_address) VALUES (?,?,?)')
    .run(student, 'St. John College of Engineering & Management, Palghar', 'Hostel Block A');

  const insHotel = db.prepare(`INSERT INTO hotels (user_id,name,description,address,latitude,longitude,distance_from_college,phone,status,rating,image_url,prep_time,is_open)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const devi = insHotel.run(deviUser,'Devi Krupa','Authentic home-style meals & snacks near campus','Near Gholai Road, Palghar',19.6925,72.7671,1.2,'9800000004','active',4.4,'https://images.unsplash.com/photo-1585937421612-70a008356fbe?w=800&q=80','20-30 min',1).lastInsertRowid;
  const badshah = insHotel.run(badshahUser,'Badshah Biryani','The royal taste of biryani','Palghar Station Road',19.6959,72.7681,1.5,'9800000005','active',4.6,'https://images.unsplash.com/photo-1563379091339-03246963d4b0?w=800&q=80','25-35 min',1).lastInsertRowid;
  const topcake = insHotel.run(topcakeUser,'Top Cake','Fresh bakery, cakes & desserts','Mahim Road, Palghar',19.6990,72.7700,1.8,'9800000006','active',4.3,'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=800&q=80','15-25 min',1).lastInsertRowid;

  const cat = (n, d, i) => db.prepare('INSERT OR IGNORE INTO food_categories (name,description,image_url) VALUES (?,?,?)').run(n, d, i).lastInsertRowid;
  const meals = cat('Meals', 'Indian meals, thali, biryani etc.', 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?w=400&q=80');
  const breakfast = cat('Breakfast', 'Poha, Upma, Misal, Vada Pav etc.', 'https://images.unsplash.com/photo-1668236543094-5ca3f0770a9f?w=400&q=80');
  const snacks = cat('Snacks', 'Samosa, Burger, Pizza, Sandwich etc.', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&q=80');
  const desserts = cat('Desserts', 'Cake, Pastry, Ice Cream etc.', 'https://images.unsplash.com/photo-1488477181946-6428a0291777?w=400&q=80');
  const drinks = cat('Drinks', 'Cold drinks, Juice, Tea, Coffee etc.', 'https://images.unsplash.com/photo-1544145945-f90425340c7e?w=400&q=80');

  const img = {
    vegThali: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=600&q=80',
    chickenThali: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&q=80',
    paneerMeal: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&q=80',
    dalRice: 'https://images.unsplash.com/photo-1547928576-b822bd3a3e3a?w=600&q=80',
    friedRice: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=600&q=80',
    samosa: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=600&q=80',
    vadaPav: 'https://images.unsplash.com/photo-1601050690573-d07e5bd19031?w=600&q=80',
    sandwich: 'https://images.unsplash.com/photo-1528735602780-2552fd46c7af?w=600&q=80',
    coldDrink: 'https://images.unsplash.com/photo-1581636625402-29b2a704ef13?w=600&q=80',
    tea: 'https://images.unsplash.com/photo-1597318181408-456ebe00f580?w=600&q=80',
    juice: 'https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=600&q=80',
    chickenBiryani: 'https://images.unsplash.com/photo-1563379091339-03246963d4b0?w=600&q=80',
    vegBiryani: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?w=600&q=80',
    combo: 'https://images.unsplash.com/photo-1596793600365-de003b3bb8b9?w=600&q=80',
    kebab: 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600&q=80',
    water: 'https://images.unsplash.com/photo-1560023907-5f339617ea30?w=600&q=80',
    chocoCake: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=600&q=80',
    blackForest: 'https://images.unsplash.com/photo-1541783245831-57d6fb0926d3?w=600&q=80',
    chocoPastry: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=600&q=80',
    redVelvet: 'https://images.unsplash.com/photo-1586985289906-406988974504?w=600&q=80',
    brownie: 'https://images.unsplash.com/photo-1607920591987-1a4fdd0f9e28?w=600&q=80',
    iceCream: 'https://images.unsplash.com/photo-1497034825429-c343d7c92a5f?w=600&q=80',
    coldCoffee: 'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=600&q=80'
  };

  const insFood = db.prepare(`INSERT INTO food_items (hotel_id,category_id,name,description,price,image_url,image_alt,is_veg,preparation_time,is_available,is_popular)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const F = (h, c, n, d, p, iu, veg, pt, pop) =>
    insFood.run(h, c, n, d, p, iu, n, veg ? 1 : 0, pt, 1, pop ? 1 : 0);

  // Devi Krupa
  F(devi, meals, 'Veg Thali', 'Unlimited roti, rice, dal, sabji and pickle.', 120, img.vegThali, true, '15-20 min', true);
  F(devi, meals, 'Chicken Thali', 'Chicken curry, roti, rice and salad.', 180, img.chickenThali, false, '20-25 min', true);
  F(devi, meals, 'Paneer Meal', 'Paneer masala with rice and 3 rotis.', 140, img.paneerMeal, true, '15-20 min', false);
  F(devi, meals, 'Dal Rice', 'Comforting dal tadka with steamed rice.', 80, img.dalRice, true, '10-15 min', false);
  F(devi, meals, 'Fried Rice', 'Wok-tossed veg fried rice with schezwan chutney.', 110, img.friedRice, true, '15-20 min', false);
  F(devi, snacks, 'Samosa', '2 pcs crispy samosa with chutney.', 20, img.samosa, true, '5-10 min', true);
  F(devi, snacks, 'Vada Pav', 'Mumbai style vada pav with dry garlic chutney.', 15, img.vadaPav, true, '5-10 min', true);
  F(devi, snacks, 'Sandwich', 'Grilled veg cheese sandwich.', 60, img.sandwich, true, '10-15 min', false);
  F(devi, drinks, 'Cold Drink', 'Chilled soft drink 250ml.', 20, img.coldDrink, true, '1-2 min', false);
  F(devi, drinks, 'Tea', 'Hot cutting chai.', 10, img.tea, true, '3-5 min', false);
  F(devi, drinks, 'Juice', 'Fresh seasonal fruit juice.', 40, img.juice, true, '5-10 min', false);

  // Badshah Biryani
  F(badshah, meals, 'Chicken Biryani', 'Fragrant basmati rice cooked with tender chicken and aromatic spices.', 149, img.chickenBiryani, false, '20-25 min', true);
  F(badshah, meals, 'Veg Biryani', 'Aromatic basmati rice layered with garden vegetables and spices.', 119, img.vegBiryani, true, '20-25 min', true);
  F(badshah, meals, 'Chicken Biryani Combo', 'Biryani with raita, salad and gulab jamun.', 199, img.combo, false, '25-30 min', true);
  F(badshah, meals, 'Chicken Thali', 'Royal chicken thali with biryani, roti and dessert.', 220, img.chickenThali, false, '25-30 min', false);
  F(badshah, snacks, 'Kebab', 'Sizzling chicken seekh kebab (4 pcs).', 130, img.kebab, false, '15-20 min', false);
  F(badshah, drinks, 'Cold Drink', 'Chilled soft drink 250ml.', 20, img.coldDrink, true, '1-2 min', false);
  F(badshah, drinks, 'Water', 'Packaged drinking water 1L.', 15, img.water, true, '1 min', false);

  // Top Cake
  F(topcake, desserts, 'Chocolate Cake', 'Rich truffle chocolate cake slice.', 80, img.chocoCake, true, '2-5 min', true);
  F(topcake, desserts, 'Black Forest Cake', 'Classic black forest with cherry and cream.', 70, img.blackForest, true, '2-5 min', true);
  F(topcake, desserts, 'Chocolate Pastry', 'Dark chocolate pastry with ganache.', 50, img.chocoPastry, true, '2-5 min', false);
  F(topcake, desserts, 'Red Velvet Pastry', 'Creamy red velvet pastry.', 55, img.redVelvet, true, '2-5 min', false);
  F(topcake, desserts, 'Brownie', 'Fudgy walnut brownie.', 45, img.brownie, true, '2-5 min', false);
  F(topcake, desserts, 'Ice Cream', 'Vanilla scoop with chocolate sauce.', 40, img.iceCream, true, '1-2 min', false);
  F(topcake, drinks, 'Cold Coffee', 'Creamy iced coffee with whipped cream.', 60, img.coldCoffee, true, '5-10 min', true);

  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('delivery_charge', '20');
  db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run('cod_enabled', 'true');

  console.log('Database seeded with demo data.');
}

seed();

module.exports = db;
