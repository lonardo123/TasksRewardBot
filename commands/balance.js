const { client } = require('../database');
const { mainMenu } = require('../views/keyboards');

const balanceCommand = async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = res.rows[0]?.balance || 0;
    await ctx.replyWithHTML(
      `💰 <b>رصيدك الحالي:</b> ${balance.toFixed(2)}$`,
      mainMenu()
    );
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
};

module.exports = balanceCommand;
