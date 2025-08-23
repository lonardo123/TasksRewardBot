require('dotenv').config();
const { Client } = require('pg');
const express = require('express');

// === قاعدة البيانات ===
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function connectDB() {
  try {
    await client.connect();
    console.log('✅ اتصال قاعدة البيانات ناجح');

    // ✅ إنشاء الجداول إذا لم تكن موجودة
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        balance DECIMAL(10,2) DEFAULT 0,
        payeer_wallet VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS earnings (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        source VARCHAR(50),
        amount DECIMAL(10,2),
        description TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        amount DECIMAL(10,2),
        payeer_wallet VARCHAR,
        status VARCHAR(20) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        admin_note TEXT
      );
    `);

    console.log('✅ الجداول أُنشئت أو موجودة مسبقًا');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    setTimeout(connectDB, 5000); // إعادة المحاولة
  }
}

// === السيرفر ===
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! Postback جاهز.');
});

app.get('/callback', async (req, res) => {
  const { user_id, amount, secret } = req.query;

  if (secret !== process.env.CALLBACK_SECRET) {
    console.log('🚫 سر خاطئ:', secret);
    return res.status(403).send('Forbidden: Invalid Secret');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).send('Invalid amount');
  }

  try {
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [parsedAmount, user_id]
    );
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'offer', parsedAmount, 'Offer Completed']
    );
    console.log(`🟢 أضيف ${parsedAmount}$ للمستخدم ${user_id}`);
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});

// === التشغيل ===
(async () => {
  await connectDB();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Postback Server يعمل على المنفذ ${PORT}`);
  });
})();
