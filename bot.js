const { Telegraf, session, Markup } = require('telegraf');
const { Pool } = require('pg');
require('dotenv').config();

// ====== Debug env ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);

const userSessions = {};

// ====== Postgres Pool ======
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🟢 تجربة الاتصال مرة واحدة
async function connectDB() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('✅ bot.js: اتصال قاعدة البيانات ناجح:', res.rows[0].now);
  } catch (err) {
    console.error('❌ bot.js: فشل الاتصال:', err.message);
    setTimeout(connectDB, 5000);
  }
}

// 🔵 إنشاء/تحديث جميع الجداول عند الإقلاع
async function initSchema() {
  try {
    // جدول المستخدمين
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        balance NUMERIC(12,6) DEFAULT 0,
        payeer_wallet VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول الأرباح
    await pool.query(`
      CREATE TABLE IF NOT EXISTS earnings (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        source VARCHAR(50),
        amount NUMERIC(12,6),
        description TEXT,
        watched_seconds INTEGER,
        video_id INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // جدول الإحالات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id BIGINT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول أرباح الإحالة
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_earnings (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id BIGINT NOT NULL,
        amount NUMERIC(12,6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول المهمات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        price NUMERIC(12,6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // إضافة العمود duration_seconds لو مش موجود
    await pool.query(`
      ALTER TABLE tasks 
      ADD COLUMN IF NOT EXISTS duration_seconds INT DEFAULT 2592000;
    `);

    // جدول إثباتات المهمات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_proofs (
        id SERIAL PRIMARY KEY,
        task_id INT NOT NULL,
        user_id BIGINT NOT NULL,
        proof TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // جدول تتبع حالة المهمة لكل مستخدم
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        task_id INT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending', -- pending | approved | rejected
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, task_id)
      );
    `);

    // جدول السحوبات
    await pool.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount NUMERIC(12,6) NOT NULL,
        payeer_wallet VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ initSchema: تم تجهيز كل الجداول بنجاح');
  } catch (e) {
    console.error('❌ initSchema:', e);
  }
}

// ====== Bot setup ======
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في ملف .env');
  process.exit(1);
}
const bot = new Telegraf(process.env.BOT_TOKEN);

// Enable in-memory sessions
bot.use(session());

// Simple logger
bot.use((ctx, next) => {
  const from = ctx.from ? `${ctx.from.id} (${ctx.from.username || ctx.from.first_name})` : 'unknown';
  const text = ctx.message?.text || ctx.updateType;
  console.log('📩', from, '→', text);
  return next();
});

// ====== Start bot ======
(async () => {
  await connectDB();
  await initSchema();

  bot.start((ctx) => ctx.reply('👋 أهلاً بك في البوت!'));

  bot.launch();
  console.log('🚀 البوت شغال الآن');
})();
