const { Telegraf } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

// === 1. رابط قاعدة البيانات (استخدم القيمة من Railway) ===
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:fdpGAaEUuSWDZXNJLLlqncuImnPLaviu@switchback.proxy.rlwy.net:49337/railway';

console.log('🔧 محاولة الاتصال بقاعدة البيانات...');

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // ضروري على Railway
  }
});

// === 2. الاتصال بقاعدة البيانات وإنشاء الجداول ===
async function connectDB() {
  try {
    await client.connect();
    console.log('✅ اتصال قاعدة البيانات ناجح');

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
    // إعادة المحاولة بعد 5 ثوانٍ
    setTimeout(connectDB, 5000);
  }
}

// === 3. تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN || '8488029999:AAHZHiKR96TUike1X50Yael9AEeIb6ThmiA');

// أمر /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  try {
    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);

    let balance = 0;
    if (res.rows.length > 0) {
      balance = parseFloat(res.rows[0].balance) || 0; // ✅ التأكد من أن القيمة رقم
    } else {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n` +
      `💰 <b>رصيدك الحالي:</b> ${balance.toFixed(2)}$\n\n` +
      `اختر خيارًا من القائمة أدناه:`,
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
    console.error('❌ خطأ في /start:', err);
    await ctx.reply('حدث خطأ داخلي. يُرجى المحاولة لاحقًا.');
  }
});

// أمر: 💰 رصيدك
bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    await ctx.replyWithHTML(`💰 <b>رصيدك الحالي:</b> ${balance.toFixed(2)}$`);
  } catch (err) {
    console.error('❌ خطأ في جلب الرصيد:', err);
    await ctx.reply('حدث خطأ في جلب الرصيد.');
  }
});

// أمر: 🎁 مصادر الربح
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

// أمر: 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    const MIN_WITHDRAW = 1.0;

    if (balance < MIN_WITHDRAW) {
      return ctx.reply(`❌ الحد الأدنى للسحب هو ${MIN_WITHDRAW}$. رصيدك: ${balance.toFixed(2)}$`);
    }

    await ctx.reply(`🟢 رصيدك مؤهل للسحب.\nأرسل رقم محفظة Payeer (مثل: P12345678):`);
    ctx.session = { awaiting_withdraw: true };
  } catch (err) {
    console.error('❌ خطأ في طلب السحب:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
});

// معالجة رقم Payeer
bot.on('text', async (ctx) => {
  if (ctx.session?.awaiting_withdraw) {
    const wallet = ctx.message.text.trim();

    // التحقق من تنسيق Payeer
    if (!/^P\d{8,}$/.test(wallet)) {
      return ctx.reply('❌ رقم محفظة غير صالح. يجب أن يبدأ بـ P ويحتوي على 8 أرقام على الأقل.');
    }

    const userId = ctx.from.id;
    const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const amount = parseFloat(userRes.rows[0]?.balance) || 0;

    // حفظ طلب السحب
    await client.query(
      'INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)',
      [userId, amount, wallet]
    );

    // صفر الرصيد
    await client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

    await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${amount.toFixed(2)}$.`);
    ctx.session.awaiting_withdraw = false;
  }
});

// === 4. تشغيل السيرفر (يسمح للرابط أن يعمل) ===
const express = require('express');
const app = express();
app.use(express.json());

// الصفحة الرئيسية
app.get('/', (req, res) => {
  res.status(200).send('✅ السيرفر يعمل! البوت نشط.');
});

// Postback من TimeWall / cpalead
app.get('/callback', async (req, res) => {
  const { user_id, amount, offer, secret } = req.query;

  // التحقق من السر
  if (secret !== process.env.CALLBACK_SECRET) {
    console.log(`🚫 callback مرفوض: سر خاطئ من المستخدم ${user_id}`);
    return res.status(403).send('Forbidden');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).send('Invalid amount');
  }

  try {
    // تحديث الرصيد
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [parsedAmount, user_id]
    );

    // تسجيل الأرباح
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'offer', parsedAmount, offer || 'Offer Completed']
    );

    // (اختياري) إرسال إشعار
    try {
      await bot.telegram.sendMessage(user_id, `🎉 حصلت على ${parsedAmount.toFixed(2)}$ من مهمة!`);
    } catch (e) {
      console.log(`لا يمكن إرسال رسالة للمستخدم ${user_id}`);
    }

    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    console.error('❌ خطأ في callback:', err);
    res.status(500).send('Server Error');
  }
});

// === 5. التشغيل النهائي ===
(async () => {
  try {
    await connectDB();

    // تشغيل البوت
    await bot.launch();
    console.log('✅ البوت شُغّل بنجاح');

    // تشغيل السيرفر
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    });
  } catch (error) {
    console.error('فشل في التشغيل:', error);
  }
})();
