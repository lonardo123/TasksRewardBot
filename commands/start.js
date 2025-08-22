const { mainMenu } = require('../views/keyboards');
const { client } = require('../database');

const startCommand = async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  // تحقق من وجود المستخدم
  const res = await client.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
  if (res.rows.length === 0) {
    await client.query(
      'INSERT INTO users (telegram_id, balance) VALUES ($1, $2)',
      [userId, 0]
    );
  }

  await ctx.reply(
    `مرحبًا ${firstName}! 🎉\nهذا بوتك للربح من العروض.\nاختر خيارًا من القائمة:`,
    mainMenu()
  );
};

module.exports = startCommand;
