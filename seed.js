// Standalone re-seed: deletes the DB and reseeds demo data
const fs = require('fs');
const path = require('path');
const DB = process.env.DB_PATH || path.join(__dirname, 'data', 'palgharbites.db');
['', '-wal', '-shm'].forEach(s => { if (fs.existsSync(DB + s)) fs.unlinkSync(DB + s); });
require('./db');
console.log('Fresh demo database created at', DB);
