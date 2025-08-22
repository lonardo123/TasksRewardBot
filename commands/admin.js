const { adminMenu, mainMenu } = require('../views/keyboards');
const { client } = require('../database');
require('dotenv').config();

let adminMode = new Set();

const adminCommand = async (ctx) => {
  const userId = ctx.from.id;
  if (userId.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }

  adminMode.add(userId);
  ctx.session.isAdmin = true;
  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن', adminMenu());
};

const handleAdminActions = async (ctx) => {
  if (!ctx.session?.isAdmin) return;

  const text = ctx.message?.text;

  if (text === '📋 عرض الطلبات') {
    const res = await client.query('SELECT * FROM withdrawals WHERE status = $1', ['pending']);
    if (res.rows.length === 0) {
      await ctx.reply('✅ لا توجد طلبات معلقة.');
    } else {
      for (let req of res.rows) {
        await ctx.reply(
          `طلب سحب #${req.id}\n` +
          `المستخدم: ${req.user_id}\n` +
          `المبلغ: ${req.amount}$\n` +
          `Payeer: ${req.payeer_wallet}\n\n` +
          `أرسل: /pay ${req.id} لقبول أو /reject ${req.id} للرفض`,
          { reply_markup: { remove_keyboard: true } }
        );
      }
    }
  }

  else if (text === '📊 الإحصائيات') {
    const [users, earnings, pending] = await Promise.all([
      client.query('SELECT COUNT(*) FROM users'),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM earnings'),
      client.query('SELECT COUNT(*) FROM withdrawals WHERE status = $1', ['pending'])
    ]);

    await ctx.reply(
      `📈 الإحصائيات:\n` +
      `👥 عدد المستخدمين: ${users.rows[0].count}\n` +
      `💸 الأرباح الموزعة: ${earnings.rows[0].sum.toFixed(2)}$\n` +
      `⏳ طلبات معلقة: ${pending.rows[0].count}`
    );
  }

  else if (text === '🔧 تعديل الحد الأدنى') {
    await ctx.reply(`الحد الحالي: ${process.env.MIN_WITHDRAW}$. أرسل القيمة الجديدة:`);
    ctx.session.awaiting_min = true;
  }

  else if (text === '🚪 خروج من لوحة الأدمن') {
    adminMode.delete(ctx.from.id);
    ctx.session.isAdmin = false;
    await ctx.reply('✅ خرجت من لوحة الأدمن.', mainMenu());
  }
};

module.exports = { adminCommand, handleAdminActions };
