const { Markup } = require('telegraf');

const mainMenu = () =>
  Markup.keyboard([
    ['💰 رصيدك'],
    ['🎁 مصادر الربح'],
    ['📤 طلب سحب']
  ]).resize();

const offersMenu = () =>
  Markup.inlineKeyboard([
    Markup.button.url('TimeWall', 'https://timewall.example.com/?user_id=' + userId),
    Markup.button.url('cpalead', 'https://cpalead.example.com/?user_id=' + userId)
  ]);

const adminMenu = () =>
  Markup.keyboard([
    ['📋 عرض الطلبات'],
    ['🔧 تعديل الحد الأدنى'],
    ['📊 الإحصائيات'],
    ['🚪 خروج من لوحة الأدمن']
  ]).resize();

module.exports = { mainMenu, offersMenu, adminMenu };
