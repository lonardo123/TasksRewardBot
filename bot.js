const { Telegraf } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

// === 1. تأكد من DATABASE_URL ===
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:fdpGAaEUuSWDZXNJLLlqncuImnPLaviu@switchback.proxy.rlwy.net:49337/railway';

console.log("🔧 محاولة الاتصال بـ:", DATABASE_URL.replace(/:(.*)@/, ':*****@'));

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // مهم لبيئة Railway
  }
});

// === 2. الاتصال وإنشاء الجداول ===
async function connectDB() {
  try {
    await client.connect();
    console.log("✅ اتصال قاعدة البيانات ناجح");

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
    console.log("✅ الجداول أُنشئت أو موجودة");
  } catch (err) {
    console.error("❌ فشل الاتصال بقاعدة البيانات:", err.message);
    setTimeout(() => process.exit(1), 2000); // إعادة المحاولة لاحقًا
  }
}

// === 3. تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN || '8488029999:AAHZHiKR96TUike1X50Yael9AEeIb6ThmiA');

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  try {
    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    if (res.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
      res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    }
    const balance = res.rows[0].balance;

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n` +
      `💰 <b>رصيدك:</b> ${balance.toFixed(2)}$\n\n` +
      `اختر خيارًا:`,
      {
        reply_markup: {
          keyboard: [
            ['💰 رصيدك', '🎁 مصادر الربح'],
            ['📤 طلب سحب']
          ],
          resize_keyboard: true
        }
      }
    );
  } catch (err) {
    console.error('❌ /start خطأ:', err);
    await ctx.reply('حدث خطأ داخلي. انتظر قليلاً ثم حاول مرة أخرى.');
  }
});

// === 4. أمر رصيدك ===
bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = res.rows[0]?.balance || 0;
    await ctx.replyWithHTML(`💰 رصيدك: <b>${balance.toFixed(2)}$</b>`);
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
});

// === 5. مصادر الربح ===
bot.hears('🎁 مصادر الربح', (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.example.com/?user_id=${userId}`;
  const cpaleadUrl = `https://cpalead.com/myoffers.php?user_id=${userId}`;
  ctx.reply(
    'اختر مصدر ربح:',
    {
      inline_keyboard: [
        [{ text: '🕒 TimeWall', url: timewallUrl }],
        [{ text: '📊 cpalead', url: cpaleadUrl }]
      ]
    }
  );
});

// === 6. طلب سحب ===
bot.hears('📤 طلب سحب', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = res.rows[0]?.balance || 0;
    if (balance < 1.0) {
      return ctx.reply(`❌ الحد الأدنى للسحب هو 1$. رصيدك: ${balance.toFixed(2)}$`);
    }
    await ctx.reply(`أرسل رقم محفظة Payeer (P12345678):`);
    ctx.session = { awaiting_withdraw: true };
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
});

// === 7. معالجة رقم Payeer ===
bot.on('text', async (ctx) => {
  if (ctx.session?.awaiting_withdraw) {
    const wallet = ctx.message.text.trim();
    if (!/^P\d{8,}$/.test(wallet)) {
      return ctx.reply('❌ رقم غير صالح. يجب أن يكون مثل P12345678');
    }
    const userId = ctx.from.id;
    const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const amount = userRes.rows[0].balance;

    await client.query(
      'INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)',
      [userId, amount, wallet]
    );
    await client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

    ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${amount.toFixed(2)}$.`);
    ctx.session.awaiting_withdraw = false;
  }
});

// === 8. السيرفر ===
const express = require('express');
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! البوت نشط.');
});

// Postback
app.get('/callback', async (req, res) => {
  const { user_id, amount, secret } = req.query;
  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden');
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).send('Invalid amount');

  try {
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [parsedAmount, user_id]);
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'offer', parsedAmount, 'Offer Completed']
    );
    try {
      await bot.telegram.sendMessage(user_id, `🎉 حصلت على ${parsedAmount}$ من مهمة!`);
    } catch (e) {}
    res.status(200).send('OK');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Error');
  }
});

// === 9. التشغيل ===
(async () => {
  await connectDB();
  await bot.launch();
  console.log('✅ البوت شُغّل بنجاح');

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
  });
})();
