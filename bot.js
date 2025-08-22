const { Telegraf } = require('telegraf');
const { initDB } = require('./database');
const express = require('express');
require('dotenv').config();

// === 1. تشغيل بوت التيلغرام ===
const bot = new Telegraf(process.env.BOT_TOKEN);

// تحميل الأوامر (كما في مشروعك)
const startCommand = require('./commands/start');
const balanceCommand = require('./commands/balance');
const offersCommand = require('./commands/offers');
const withdrawCommand = require('./commands/withdraw');
const { adminCommand, handleAdminActions } = require('./commands/admin');

bot.start(startCommand);
bot.hears('💰 رصيدك', balanceCommand);
bot.hears('🎁 مصادر الربح', offersCommand);
bot.hears('📤 طلب سحب', withdrawCommand);
bot.command('admin', adminCommand);

// ... باقي الأوامر كما هي

// === 2. تشغيل سيرفر Express داخل نفس الملف ===
const app = express();
app.use(express.json());

// Postback من TimeWall / cpalead
app.get('/callback', async (req, res) => {
  const { user_id, amount, offer, secret } = req.query;

  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).send('Invalid amount');

  try {
    await bot.telegram.db.client.query('BEGIN');

    await bot.telegram.db.client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [parsedAmount, user_id]
    );

    await bot.telegram.db.client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'cpa_offer', parsedAmount, offer || 'Offer Completed']
    );

    await bot.telegram.db.client.query('COMMIT');

    // (اختياري) إرسال إشعار للمستخدم
    try {
      await bot.telegram.sendMessage(user_id, `🎉 حصلت على ${parsedAmount}$ من مهمة!`);
    } catch (err) {
      console.log(`مستخدم ${user_id} قد يكون قد حظر البوت`);
    }

    res.status(200).send('OK');
  } catch (err) {
    await bot.telegram.db.client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Error');
  }
});

// صفحة رئيسية للتحقق
app.get('/', (req, res) => {
  res.send('✅ البوت + السيرفر يعملان بنجاح!');
});

// === 3. التشغيل ===
(async () => {
  await initDB();

  // تشغيل البوت
  await bot.launch();
  console.log('✅ البوت يعمل الآن');

  // تشغيل السيرفر على المنفذ الصحيح
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يستمع على المنفذ ${PORT}`);
  });
})();
