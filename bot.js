const { Telegraf } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID, 'نوعه:', typeof process.env.ADMIN_ID);

// === قاعدة البيانات ===
const DATABASE_URL = process.env.DATABASE_URL;
const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function connectDB() {
  try {
    await client.connect();
    console.log('✅ bot.js: اتصال قاعدة البيانات ناجح');
  } catch (err) {
    console.error('❌ bot.js: فشل الاتصال:', err.message);
  }
}

// === تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN);

// ✅ أضف هذا السطر هنا — مباشرة بعد تعريف البوت
bot.use((ctx, next) => {
  console.log('📩 رسالة مستلمة:', ctx.updateType, 'من:', ctx.from?.id, 'النص:', ctx.message?.text || 'غير نص');
  return next();
});

// ✅ ثم أمر /admin (من الأفضل أن يكون مبكرًا)
bot.command('admin', async (ctx) => {
  const userId = ctx.from.id.toString();
  const adminId = process.env.ADMIN_ID;

  console.log('🎯 محاولة دخول لوحة الأدمن:', { userId, adminId });

  if (userId !== adminId) {
    console.log('❌ رفض الدخول: غير مسموح');
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }

  ctx.session = { isAdmin: true };
  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن', {
    reply_markup: {
      keyboard: [
        ['📋 عرض الطلبات'],
        ['📊 الإحصائيات'],
        ['🚪 خروج من لوحة الأدمن']
      ],
      resize_keyboard: true
    }
  });
});

// أمر /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  try {
    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = 0;

    if (res.rows.length > 0) {
      balance = parseFloat(res.rows[0].balance) || 0;
    } else {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n💰 <b>رصيدك:</b> ${balance.toFixed(2)}$`,
      {
        reply_markup: {
          keyboard: [
            ['💰 رصيدك', '🎁 مصادر الربح'],
            ['📤 طلب سحب']
          ],
          resize_keyboard: true
        }
      }
    );
  } catch (err) {
    console.error('❌ /start:', err);
    await ctx.reply('حدث خطأ.');
  }
});

// 💰 رصيدك
bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    await ctx.replyWithHTML(`💰 رصيدك: <b>${balance.toFixed(2)}$</b>`);
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
});

// 🎁 مصادر الربح
bot.hears('🎁 مصادر الربح', (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.example.com/?user_id=${userId}`;
  const cpaleadUrl = `https://cpalead.com/myoffers.php?user_id=${userId}`;
  ctx.reply('اختر مصدر ربح:', {
    inline_keyboard: [
      [{ text: '🕒 TimeWall', url: timewallUrl }],
      [{ text: '📊 cpalead', url: cpaleadUrl }]
    ]
  });
});

// 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    if (balance < 1.0) return ctx.reply(`❌ الحد الأدنى للسحب هو 1$. رصيدك: ${balance.toFixed(2)}$`);

    await ctx.reply(`أرسل رقم محفظة Payeer (P12345678):`);
    ctx.session = { awaiting_withdraw: true };
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
});

// معالجة Payeer
bot.on('text', async (ctx) => {
  if (ctx.session?.awaiting_withdraw) {
    const wallet = ctx.message.text.trim();
    if (!/^P\d{8,}$/.test(wallet)) {
      return ctx.reply('❌ رقم غير صالح.');
    }

    const userId = ctx.from.id;
    const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const amount = parseFloat(userRes.rows[0]?.balance) || 0;

    await client.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)', [userId, amount, wallet]);
    await client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

    await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${amount.toFixed(2)}$.`);
    ctx.session.awaiting_withdraw = false;
  }
});

// 🔐 أمر /admin — يجب أن يكون أولًا
bot.hears('📋 عرض الطلبات', async (ctx) => {
  const userId = ctx.from.id;

  if (userId.toString() !== process.env.ADMIN_ID) {
    return;
  }

  try {
    const res = await client.query('SELECT * FROM withdrawals WHERE status = $1', ['pending']);

    if (res.rows.length === 0) {
      await ctx.reply('✅ لا توجد طلبات معلقة.');
    } else {
      for (const req of res.rows) {
        await ctx.reply(
          `طلب سحب #${req.id}\n` +
          `👤 المستخدم: ${req.user_id}\n` +
          `💵 المبلغ: ${req.amount}$\n` +
          `💳 Payeer: ${req.payeer_wallet}\n` +
          `📅 ${new Date(req.requested_at).toLocaleString()}\n\n` +
          `✅ انسخ الأمر:\n/pay ${req.id}  لقبول\n/reject ${req.id} لرفض`
        );
      }
    }
  } catch (err) {
    console.error('❌ خطأ في عرض الطلبات:', err);
    await ctx.reply('حدث خطأ فني. راجع السجلات.');
  }
});

bot.hears('📊 الإحصائيات', async (ctx) => {
  const userId = ctx.from.id;

  if (userId.toString() !== process.env.ADMIN_ID) return;

  try {
    const [users, earnings, paid, pending] = await Promise.all([
      client.query('SELECT COUNT(*) FROM users'),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM earnings'),
      client.query('SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE status = $1', ['paid']),
      client.query('SELECT COUNT(*) FROM withdrawals WHERE status = $1', ['pending'])
    ]);

    await ctx.reply(
      `📈 <b>الإحصائيات</b>\n\n` +
      `👥 عدد المستخدمين: <b>${users.rows[0].count}</b>\n` +
      `💰 الأرباح الموزعة: <b>${earnings.rows[0].sum.toFixed(2)}$</b>\n` +
      `📤 المدفوعات: <b>${paid.rows[0].sum.toFixed(2)}$</b>\n` +
      `⏳ طلبات معلقة: <b>${pending.rows[0].count}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    console.error('❌ خطأ في الإحصائيات:', err);
    await ctx.reply('حدث خطأ في جلب الإحصائيات.');
  }
});

bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => {
  const userId = ctx.from.id;

  if (userId.toString() !== process.env.ADMIN_ID) return;

  ctx.session = {};

  await ctx.reply('✅ خرجت من لوحة الأدمن.', {
    reply_markup: {
      keyboard: [
        ['💰 رصيدك', '🎁 مصادر الربح'],
        ['📤 طلب سحب']
      ],
      resize_keyboard: true
    }
  });
});


// === التشغيل ===
(async () => {
  await connectDB();
  await bot.launch();
  console.log('✅ bot.js: البوت شُغّل بنجاح');
})();
