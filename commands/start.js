const { mainMenu } = require('../views/keyboards');
const { client } = require('../database');

const startCommand = async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    if (res.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }
    const balance = res.rows[0]?.balance || 0;

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n` +
      `💰 <b>رصيدك الحالي:</b> ${balance.toFixed(2)}$\n\n` +
      `اختر خيارًا من القائمة أدناه:`,
      mainMenu()
    );
  } catch (err) {
    console.error('خطأ في /start:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
};

module.exports = startCommand;
