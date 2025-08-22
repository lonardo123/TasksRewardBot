const { Markup } = require('telegraf');

const mainMenu = () =>
  Markup.keyboard([
    ['💰 رصيدك', '🎁 مصادر الربح'],
    ['📤 طلب سحب']
  ]).resize();

const adminMenu = () =>
  Markup.keyboard([
    ['📋 عرض الطلبات'],
    ['📊 الإحصائيات'],
    ['🔧 تعديل الحد الأدنى'],
    ['🚪 خروج من لوحة الأدمن']
  ]).resize();

module.exports = { mainMenu, adminMenu };
