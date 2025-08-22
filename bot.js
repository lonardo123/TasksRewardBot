const { Telegraf } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

// === 1. إعداد قاعدة البيانات ===
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ اتصال قاعدة البيانات ناجح");

    // إنشاء الجداول
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
    console.log("✅ الجداول جاهزة");
  } catch (err) {
    console.error("فشل الاتصال بقاعدة البيانات:", err.message);
  }
}

// === 2. تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  try {
    // تحقق من وجود المستخدم
    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    if (res.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
      res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    }

    const balance = res.rows[0].balance;

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n` +
      `💰 <b>رصيدك الحالي:</b> ${balance.toFixed(2)}$\n\n` +
      `اختر خيارًا من القائمة أدناه:`,
      {
        reply_markup: {
          keyboard: [
            [{ text: '💰 رصيدك' }, { text: '🎁 مصادر الربح' }],
            [{ text: '📤 طلب سحب' }]
          ],
          resize_keyboard: true
        }
      }
    );
  } catch (err) {
    console.error('❌ خطأ في /start:', err);
    await ctx.reply('حدث خطأ داخلي. تأكد من أن الاتصال بقاعدة البيانات يعمل.');
  }
});

// === 3. أمر رصيدك ===
bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = res.rows[0]?.balance || 0;
    await ctx.replyWithHTML(`💰 رصيدك: <b>${balance.toFixed(2)}$</b>`);
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ في جلب الرصيد.');
  }
});

// === 4. مصدر الربح ===
bot.hears('🎁 مصادر الربح', (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.example.com/?user_id=${userId}`;
  const cpaleadUrl = `https://cpalead.example.com/?user_id=${userId}`;

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

// === 5. طلب سحب ===
bot.hears('📤 طلب سحب', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = res.rows[0]?.balance || 0;
    const MIN_WITHDRAW = 1.0;

    if (balance < MIN_WITHDRAW) {
      return ctx.reply(`❌ الحد الأدنى للسحب هو ${MIN_WITHDRAW}$. رصيدك: ${balance.toFixed(2)}$`);
    }

    await ctx.reply(`أرسل رقم محفظة Payeer (P12345678):`);
    ctx.session = { ...ctx.session, awaiting_withdraw: true };
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
});

// === 6. معالجة رقم Payeer ===
bot.on('text', async (ctx) => {
  if (ctx.session?.awaiting_withdraw) {
    const wallet = ctx.message.text.trim();
    if (!/^P\d{8,}$/.test(wallet)) {
      return ctx.reply('❌ رقم محفظة غير صالح. يجب أن يبدأ بـ P ويتكون من 8 أرقام على الأقل.');
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

// === 7. أمر الأدمن ===
bot.command('admin', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('❌ ليس لديك صلاحيات.');
  }

  const res = await client.query('SELECT COUNT(*) FROM withdrawals WHERE status = $1', ['pending']);
  await ctx.reply(
    `🔐 لوحة الأدمن\n` +
    `📋 طلبات معلقة: ${res.rows[0].count}`,
    {
      reply_markup: {
        keyboard: [
          ['📋 عرض الطلبات'],
          ['📊 الإحصائيات'],
          ['🚪 خروج']
        ],
        resize_keyboard: true
      }
    }
  );
});

// === 8. السيرفر (يبدأ مع البوت) ===
const express = require('express');
const app = express();
app.use(express.json());

// الصفحة الرئيسية
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

    // إشعار (اختياري)
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
  try {
    await connectDB();
    await bot.launch();
    console.log('✅ البوت شُغّل بنجاح');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    });
  } catch (error) {
    console.error('فشل التشغيل:', error);
  }
})();
