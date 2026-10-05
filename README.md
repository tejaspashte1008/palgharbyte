# 🍽️ PalgharBites —  Food Ordering & Delicious Meal

**Best Meal, Tasty Bites.**

A complete, production-style, full-stack food ordering platform for **St. John College of Engineering & Management, Palghar**. Students order from nearby outlets (1–2 km), the hotel prepares the food, a delivery boy brings it to the **college gate**, and the student collects it there.

> **Single-folder full-stack app** — one Express server serves the frontend UI and the `/api` backend from the same root. No separate frontend/backend folders, no CORS setup needed.

---

## ✨ Features

- **4 roles with separate dashboards**: Student, Hotel, Delivery Boy, Admin
- Full student flow: browse hotels → menu with individual food images → food detail → cart → checkout → online payment → live order tracking
- **College-gate delivery workflow** with a real order state machine:
  `ORDER_PLACED → ACCEPTED → PREPARING → READY → DELIVERY_ASSIGNED → PICKED_UP → ON_THE_WAY → REACHED_GATE → DELIVERED` (+ CANCELLED/REJECTED)
- **Online payment (Razorpay)**: order created & verified server-side, HMAC signature verification, duplicate payment protection, secrets only in env vars. Without keys, a built-in **development payment simulator** is used so the flow is fully testable.
- **Cash on Delivery/Collection** (toggleable by admin)
- Database-backed **notifications** for every status change (incl. "Your order has arrived! 📍" at the gate)
- Hotel dashboard: accept/reject orders, start preparing, mark ready, assign delivery boy, menu CRUD, open/close outlet, today's revenue
- Delivery dashboard: accept → picked up → on the way → reached gate → delivered
- Admin dashboard: platform stats, all orders, user management, add/approve nearby outlets, payment records, delivery charge & COD settings
- Search (food/hotel/category), filters (veg/non-veg/price), sorting (popular/nearest/fastest/price)
- Mobile-first responsive UI, bottom nav, sticky cart, skeletons, toasts, empty/error states

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS SPA + Poppins, served by the backend (single origin) |
| Backend | Node.js + Express (REST API) |
| Database | SQLite via better-sqlite3 (WAL, foreign keys, indexes, transactions) |
| Auth | JWT + bcryptjs password hashing + role-based middleware |
| Payment | Razorpay (server-side create/verify) + dev simulator |

## 📁 Project Structure (one folder)

```
palgharbites/
├── server.js        # Express entry point: static UI + REST API
├── db.js            # SQLite schema + demo seed data
├── seed.js          # (optional) standalone re-seed script
├── test-e2e.js      # Automated end-to-end lifecycle test (40 checks)
├── package.json
├── .env.example     # All environment variables
├── .gitignore
├── data/            # SQLite DB (auto-created)
└── public/          # Frontend served at /
    ├── index.html
    ├── style.css
    └── app.js
```

## 🚀 Run Locally

```bash
cd palgharbites
npm install          # installs express, better-sqlite3, bcryptjs, jsonwebtoken, dotenv
npm start            # → http://localhost:3000
```

The database is created and seeded automatically on first start (demo users, 3 hotels, ~25 food items with images).

Run the automated lifecycle test (server must be running):

```bash
node test-e2e.js
```

## 🔐 Environment Variables

Copy `.env.example` → `.env` and fill in:

| Variable | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | JWT signing secret — use a long random string |
| `DB_PATH` | SQLite path (default `./data/palgharbites.db` — deployment-safe, no machine-specific paths) |
| `RAZORPAY_KEY_ID` | Razorpay API key id — empty = dev payment simulator |
| `RAZORPAY_KEY_SECRET` | Razorpay secret — never exposed to frontend |

Card numbers/CVV/UPI PINs are **never** stored or touched — Razorpay's checkout handles them; only the payment id + signature hit your backend.

## 👥 Demo Accounts (development only)

| Role | Email | Password |
|---|---|---|
| 🎓 Student | student@palgharbites.com | student123 |
| 🏨 Devi Krupa | devi@palgharbites.com | hotel123 |
| 🏨 Badshah Biryani | badshah@palgharbites.com | hotel123 |
| 🏨 Top Cake | topcake@palgharbites.com | hotel123 |
| 🛵 Delivery Boy | delivery@palgharbites.com | delivery123 |
| 🛡️ Admin | admin@palgharbites.com | admin123 |

## 🧪 The Complete Real-World Test (must-try scenario)

1. Login as **student** → see 3 nearby hotels (Devi Krupa 1.2 km, Badshah Biryani 1.5 km, Top Cake 1.8 km)
2. Open **Devi Krupa** → every item has its own image
3. Add **Chicken Thali ×2** + **Cold Drink ×1** to cart
4. Checkout → gate **Main Gate**, instruction *"Call me when you reach the gate."*
5. Pay online (simulated in dev mode; real Razorpay with keys in `.env`)
6. Order confirmed → login as **Devi Krupa (hotel)** in another tab → order is already there → Accept → Start Preparing → Mark Ready → assign delivery boy
7. Login as **delivery boy** → Accept/Picked Up → On The Way → **Reached College Gate** → student gets "Your order has arrived! 📍" notification → Delivered
8. Student sees the order in history with payment **PAID** ✓

## 🌐 Deploy

The app is deployment-ready: relative `/api` calls, env-var config, no localhost hardcoding, no machine-specific DB paths.

- **Render / Railway / Fly.io**: start command `npm start`. For persistent SQLite, mount a disk and set `DB_PATH=/data/palgharbites.db`; or switch the single `db.js` module to Postgres (all queries are plain SQL).
- **Set env vars** on the host: `SESSION_SECRET`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `DB_PATH`.
- Payments should always use `https://` in production for Razorpay checkout.

## 🧰 Troubleshooting

| Problem | Fix |
|---|---|
| `Cannot open database because the directory does not exist` | Already handled — the `data/` dir is auto-created |
| Payment says "gateway unavailable" | Razorpay keys missing/invalid → use dev simulator (empty keys) or fix `.env` |
| "This is a X account" on login | Use the matching role tab — each role logs in through its own tab |
| Port already in use | Change `PORT` in `.env` |

## 🖼 Image Sources

Demo food/hotel images are hot-linked from Unsplash (freely usable). For production, hotels/admin add their own images via menu management (`image_url` + `image_alt` stored in the database). Broken images gracefully fall back to a placeholder — never a broken-image icon.
