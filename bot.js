const { Telegraf } = require('telegraf');
const express = require('express');
require('dotenv').config();

// === تحميل المكونات ===
const { client, initDB } = require('./database');
const { mainMenu } = require('./views/keyboards');

// === أوامر البوت ===
const startCommand = require('./commands/start');
const balanceCommand = require('./commands/balance');
const offersCommand = require('./commands/offers');
const withdrawCommand = require('./commands/withdraw');
const { adminCommand, handleAdminActions } = require('./commands/admin');

// === تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(startCommand);
bot.hears('💰 رصيدك', balanceCommand);
bot.hears('🎁 مصادر الربح', offersCommand);
bot.hears('📤 طلب سحب', withdrawCommand);
bot.command('admin', adminCommand);

// === معالجة الرسائل ===
bot.on('text', async (ctx) => {
  const text = ctx.message.text;

  // معالجة طلب السحب
  if (ctx.session?.awaiting_withdraw) {
    const wallet = text.trim();
    if (!wallet.startsWith('P') || !/P\d{8,}/.test(wallet)) {
      return ctx.reply('❌ رقم محفظة Payeer غير صالح. يجب أن يكون مثل P12345678');
    }

    const userId = ctx.from.id;
    const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = userRes.rows[0].balance;

    await client.query(
      'INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)',
      [userId, balance, wallet]
    );

    await client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

    ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${balance.toFixed(2)}$.`);
    ctx.session.awaiting_withdraw = false;
    return;
  }

  // لوحة الأدمن
  if (ctx.session?.isAdmin) {
    await handleAdminActions(ctx);
    return;
  }
});

// === تشغيل السيرفر ===
const app = express();
app.use(express.json());

// Postback
app.get('/callback', async (req, res) => {
  const { user_id, amount, offer, secret } = req.query;

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
      [user_id, 'offer', parsedAmount, offer || 'Offer Completed']
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
    res.status(500).send('Error');
  }
});

// صفحة رئيسية
app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! استخدم /start في البوت.');
});

// === التشغيل ===
(async () => {
  try {
    await initDB();
    await bot.launch();
    console.log('✅ البوت شُغّل بنجاح');

    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    });
  } catch (error) {
    console.error('فشل في التشغيل:', error);
    process.exit(1);
  }
})();
