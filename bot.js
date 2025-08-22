const { Telegraf } = require('telegraf');
const express = require('express');
const { client, initDB } = require('./database');
require('dotenv').config();

// === تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN);

// === تشغيل السيرفر ===
const app = express();
app.use(express.json());

// === أوامر البوت (مثال بسيط) ===
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  try {
    const res = await client.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
    if (res.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }
    await ctx.reply(`مرحبًا ${firstName}! رصيدك: 0.00$`);
  } catch (err) {
    console.error('Error in /start:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
});

bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = res.rows[0]?.balance || 0;
    await ctx.reply(`💰 رصيدك: ${balance.toFixed(2)}$`);
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ في جلب الرصيد.');
  }
});

// === Postback من Offerwalls ===
app.get('/callback', async (req, res) => {
  const { user_id, amount, secret } = req.query;

  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).send('Invalid amount');

  try {
    await client.query('BEGIN');

    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [parsedAmount, user_id]
    );

    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'offer', parsedAmount, 'Offer Completed']
    );

    await client.query('COMMIT');

    // إشعار للمستخدم (اختياري)
    try {
      await bot.telegram.sendMessage(user_id, `🎉 حصلت على ${parsedAmount}$ من مهمة!`);
    } catch (e) {
      console.log(`لا يمكن إرسال رسالة لـ ${user_id}`);
    }

    res.status(200).send('OK');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});

// === صفحة رئيسية ===
app.get('/', (req, res) => {
  res.send('✅ البوت يعمل! استخدم /start في التيلغرام.');
});

// === التشغيل ===
(async () => {
  try {
    await initDB(); // إنشاء الجداول
    await bot.launch();
    console.log('✅ البوت شُغّل بنجاح');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 السيرفر يستمع على المنفذ ${PORT}`);
    });
  } catch (error) {
    console.error('فشل في تشغيل البوت:', error);
    process.exit(1); // إيقاف العملية بوضوح
  }
})();
