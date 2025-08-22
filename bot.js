const { Telegraf } = require('telegraf');
const { initDB } = require('./database');
require('dotenv').config();

const bot = new Telegraf(process.env.BOT_TOKEN);

// تحميل الأوامر
const startCommand = require('./commands/start');
const balanceCommand = require('./commands/balance');
const offersCommand = require('./commands/offers');
const withdrawCommand = require('./commands/withdraw');
const { adminCommand, handleAdminActions } = require('./commands/admin');

// أوامر البوت
bot.start(startCommand);
bot.hears('💰 رصيدك', balanceCommand);
bot.hears('🎁 مصادر الربح', offersCommand);
bot.hears('📤 طلب سحب', withdrawCommand);
bot.command('admin', adminCommand);

// معالجة الرسائل في وضع الأدمن
bot.on('text', async (ctx) => {
  if (ctx.session?.isAdmin) {
    await handleAdminActions(ctx);
  }

  // معالجة طلب السحب
  if (ctx.session?.awaiting_withdraw) {
    const wallet = ctx.message.text.trim();
    if (!wallet.startsWith('P') || wallet.length < 9) {
      return ctx.reply('❌ رقم محفظة Payeer غير صالح. يجب أن يكون مثل P12345678');
    }

    const userId = ctx.from.id;
    const userRes = await bot.telegram.db.client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = userRes.rows[0].balance;

    await bot.telegram.db.client.query(
      'INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)',
      [userId, balance, wallet]
    );

    await bot.telegram.db.client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

    ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${balance.toFixed(2)}$.`);
    ctx.session.awaiting_withdraw = false;
  }
});

// تشغيل البوت
(async () => {
  await initDB();
  await bot.launch();
  console.log('✅ البوت يعمل الآن');
})();
