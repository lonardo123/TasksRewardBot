require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let isConnected = false;

// الاتصال عند استيراد الملف مرة واحدة فقط
async function initDB() {
  if (isConnected) return;
  try {
    await client.connect();
    isConnected = true;
    console.log('✅ قاعدة البيانات متصلة بنجاح');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    setTimeout(initDB, 5000); // إعادة المحاولة بعد 5 ثواني
  }
}

// الاتصال عند التحميل
initDB();

module.exports = { client };
