// db.js
require('dotenv').config();
const { Client } = require('pg');

// ✅ إنشاء اتصال واحد فقط بقاعدة بيانات Supabase
const client = new Client({
  connectionString: process.env.SUPABASE_DB_URL || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await client.connect();
    console.log('✅ تم الاتصال بقاعدة بيانات Supabase بنجاح');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة بيانات Supabase:', err.message);
  }
})();

module.exports = { client };
