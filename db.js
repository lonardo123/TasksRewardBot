const { Client } = require('pg');

// إعداد العميل
const client = new Client({
  connectionString: process.env.DATABASE_URL,  // من ملف .env
  ssl: { rejectUnauthorized: false }           // مطلوب في Railway / Supabase
});

// الاتصال عند بدء التشغيل
(async () => {
  try {
    await client.connect();
    console.log('✅ تم الاتصال بقاعدة البيانات بنجاح (db.js)');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
  }
})();

// تصدير العميل ليتم استخدامه في كل الملفات
module.exports = { client };

// عند إيقاف السيرفر يتم إغلاق الاتصال بأمان
process.on('SIGTERM', async () => {
  try {
    await client.end();
    console.log('🛑 تم إغلاق اتصال قاعدة البيانات بنجاح');
    process.exit(0);
  } catch (err) {
    console.error('⚠️ خطأ أثناء إغلاق قاعدة البيانات:', err.message);
    process.exit(1);
  }
});
