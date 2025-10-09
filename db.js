// db.js
require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let isConnected = false;

async function connectDB() {
  if (isConnected) return;
  try {
    await client.connect();
    isConnected = true;
    console.log('✅ قاعدة البيانات متصلة بنجاح');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    setTimeout(connectDB, 5000); // إعادة المحاولة بعد 5 ثواني
  }
}

// تصدير client والدالة connectDB
module.exports = { client, connectDB };
