const { client } = require('../database');
require('dotenv').config();

const MIN_WITHDRAW = parseFloat(process.env.MIN_WITHDRAW);

const withdrawCommand = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = res.rows[0]?.balance || 0;

    if (balance < MIN_WITHDRAW) {
      return ctx.reply(`❌ الحد الأدنى للسحب هو ${MIN_WITHDRAW}$. رصيدك: ${balance.toFixed(2)}$`);
    }

    await ctx.reply(`🟢 رصيدك مؤهل للسحب.\nأرسل رقم محفظة Payeer (P12345678):`);
    ctx.session.awaiting_withdraw = true;
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
};

module.exports = withdrawCommand;
