const { client } = require('../database');

const balanceCommand = async (ctx) => {
  const userId = ctx.from.id;
  const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
  const balance = res.rows[0]?.balance || 0;

  await ctx.reply(`💰 رصيدك الحالي: ${balance.toFixed(2)}$`);
};

module.exports = balanceCommand;
