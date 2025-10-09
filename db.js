// db.js
const { Client } = require('pg');
require('dotenv').config();

let client; // نحفظ الاتصال هنا

function getClient() {
  if (client) return client; // ✅ لو الاتصال موجود، نرجعه بدون تكرار

  client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  client.connect()
    .then(() => console.log('✅ اتصال قاعدة البيانات ناجح (db.js)'))
    .catch(err => console.error('❌ db.js: فشل الاتصال:', err.message));

  return client;
}

module.exports = { client: getClient() };
