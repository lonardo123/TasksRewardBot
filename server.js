require('dotenv').config();
const { Client } = require('pg');
const express = require('express');
const crypto = require('crypto');

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

// === دالة إضافة الرصيد ===
async function addBalance(userId, amount, source = 'offer', transactionId = null) {
  const percentage = 0.60;
  const finalAmount = amount * percentage;

  // تحقق من التكرار
  if (transactionId) {
    const existing = await client.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [userId, source, `Transaction: ${transactionId}`]
    );
    if (existing.rows.length > 0) {
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transactionId}`);
      return;
    }
  }

  // تحديث الرصيد
  await client.query(
    'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
    [finalAmount, userId]
  );

  // تسجيل العملية
  await client.query(
    'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
    [userId, source, finalAmount, transactionId ? `Transaction: ${transactionId}` : 'No Transaction ID']
  );

  console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${amount}$) للمستخدم ${userId} (Transaction: ${transactionId || 'N/A'})`);
}

// === السيرفر ===
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! Postback جاهز.');
});

// ✅ TimeWall وغيره
app.get('/callback', async (req, res) => {
  const { user_id, amount, transaction_id, secret, network } = req.query;

  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden: Invalid Secret');
  }

  if (!transaction_id) {
    return res.status(400).send('Missing transaction_id');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).send('Invalid amount');
  }

  const source = network === 'bitcotasks' ? 'bitcotasks' : 'offer';

  try {
    await addBalance(user_id, parsedAmount, source, transaction_id);
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});

// ✅ BitcoTasks مخصص
app.get('/bitcotasks-callback', async (req, res) => {
  try {
    const { user_id, amount, transaction_id, sign } = req.query;

    const SECRET = "ضع_Secret_Key_هنا"; // ضع Secret Key من BitcoTasks
    if (!user_id || !amount || !transaction_id) {
      return res.status(400).send("Missing parameters");
    }

    // تحقق من التوقيع إذا مطلوب
    // const expectedSign = crypto.createHash("md5").update(user_id + amount + SECRET).digest("hex");
    // if (expectedSign !== sign) return res.status(403).send("Invalid signature");

    await addBalance(user_id, parseFloat(amount), 'bitcotasks', transaction_id);

    console.log(`✅ BitcoTasks: Added ${amount} to user ${user_id} (tx: ${transaction_id})`);
    res.send("OK");
  } catch (err) {
    console.error("BitcoTasks callback error:", err);
    res.status(500).send("Server error");
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
