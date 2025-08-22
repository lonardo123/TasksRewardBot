const { Markup } = require('telegraf');

const offersCommand = (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.example.com/?user_id=${userId}`;
  const cpaleadUrl = `https://cpalead.example.com/?user_id=${userId}`;

  ctx.reply(
    'اختر مصدر ربح:',
    Markup.inlineKeyboard([
      Markup.button.url('🕒 TimeWall', timewallUrl),
      Markup.button.url('📊 cpalead', cpaleadUrl)
    ])
  );
};

module.exports = offersCommand;
