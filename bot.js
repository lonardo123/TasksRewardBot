const { Telegraf, session, Markup } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

// ====== Debug env ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);

// ====== Postgres client ======
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function connectDB() {
  try {
    await client.connect();
    console.log('✅ bot.js: اتصال قاعدة البيانات ناجح');
  } catch (err) {
    console.error('❌ bot.js: فشل الاتصال:', err.message);
    setTimeout(connectDB, 5000);
  }
}

// ====== Bot setup ======
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في ملف .env');
  process.exit(1);
}
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Utility: check admin
const isAdmin = (ctx) => String(ctx.from?.id) === String(process.env.ADMIN_ID);

// 🛠 أمر /admin
bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  ctx.session.isAdmin = true;
  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن', Markup.keyboard([
      ['📋 عرض الطلبات'],
      ['📊 الإحصائيات'],
      ['🚪 خروج من لوحة الأدمن']
    ]).resize()
  );
});

// 🏠 /start (مع رابط الإحالة)
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || '';
  const args = ctx.message.text.split(' ');

  try {
    let res = await client.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);

    if (res.rows.length === 0) {
      // تحقق إن فيه referrer_id
      let referrerId = null;
      if (args.length > 1) {
        const maybeRef = parseInt(args[1]);
        if (!isNaN(maybeRef) && maybeRef !== userId) {
          referrerId = maybeRef;
        }
      }

      await client.query(
        'INSERT INTO users (telegram_id, balance, referrer_id, ref_progress) VALUES ($1, $2, $3, $4)',
        [userId, 0, referrerId, 0]
      );

      if (referrerId) {
        await ctx.reply(`🎉 تم تسجيلك عبر رابط إحالة! المحيل: ${referrerId}`);
      }
      res = await client.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
    }

    const balance = parseFloat(res.rows[0].balance) || 0;
    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n💰 <b>رصيدك:</b> ${balance.toFixed(2)}$`,
      Markup.keyboard([
        ['💰 رصيدك', '🎁 مصادر الربح'],
        ['📤 طلب سحب']
      ]).resize()
    );

    // رابط الإحالة الخاص بالعضو
    const botUsername = (await bot.telegram.getMe()).username;
    await ctx.reply(
      `🔗 رابط الإحالة الخاص بك:\nhttps://t.me/${botUsername}?start=${userId}`
    );

  } catch (err) {
    console.error('❌ /start:', err);
    await ctx.reply('حدث خطأ داخلي.');
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
    console.error('❌ رصيدك:', err);
    await ctx.reply('حدث خطأ.');
  }
});

// 🎁 مصادر الربح
bot.hears('🎁 مصادر الربح', (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.example.com/?user_id=${userId}`;
  const cpaleadUrl = `https://cpalead.com/myoffers.php?user_id=${userId}`;
  return ctx.reply(
    'اختر مصدر ربح:',
    Markup.inlineKeyboard([
      [Markup.button.url('🕒 TimeWall', timewallUrl)],
      [Markup.button.url('📊 cpalead', cpaleadUrl)]
    ])
  );
});

// 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    if (balance < 1.0) {
      return ctx.reply(`❌ الحد الأدنى للسحب هو 1$. رصيدك: ${balance.toFixed(2)}$`);
    }
    ctx.session.awaiting_withdraw = true;
    await ctx.reply(`🟢 رصيدك مؤهل للسحب.\nأرسل رقم محفظة Payeer (مثل: P12345678):`);
  } catch (err) {
    console.error('❌ طلب سحب:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
});

// معالجة رقم Payeer
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim();
  const menuTexts = new Set(['💰 رصيدك','🎁 مصادر الربح','📤 طلب سحب','📋 عرض الطلبات','📊 الإحصائيات','🚪 خروج من لوحة الأدمن']);
  if (menuTexts.has(text)) return next();

  if (ctx.session.awaiting_withdraw) {
    if (!/^P\d{8,}$/i.test(text)) {
      return ctx.reply('❌ رقم محفظة غير صالح.');
    }
    const userId = ctx.from.id;
    try {
      const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
      const amount = parseFloat(userRes.rows[0]?.balance) || 0;

      await client.query(
        'INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)',
        [userId, amount, text.toUpperCase()]
      );
      await client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

      await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${amount.toFixed(2)}$.`);
      ctx.session.awaiting_withdraw = false;
    } catch (err) {
      console.error('❌ خطأ في معالجة السحب:', err);
      await ctx.reply('حدث خطأ داخلي.');
    }
  } else {
    return next();
  }
});

// ✅ وظيفة: تحديث الرصيد + مكافأة الإحالة
async function updateUserBalance(userId, amount) {
  const userRes = await client.query('SELECT * FROM users WHERE telegram_id = $1', [userId]);
  if (userRes.rows.length === 0) return;

  const user = userRes.rows[0];
  const newBalance = parseFloat(user.balance) + amount;
  const oldProgress = parseFloat(user.ref_progress) || 0;
  const referrerId = user.referrer_id;

  await client.query('UPDATE users SET balance=$1, ref_progress=$2 WHERE telegram_id=$3',
    [newBalance, newBalance, userId]);

  if (referrerId) {
    const oldDollars = Math.floor(oldProgress);
    const newDollars = Math.floor(newBalance);
    const completed = newDollars - oldDollars;
    if (completed > 0) {
      const bonus = completed * 0.05;
      await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id=$2', [bonus, referrerId]);
      console.log(`🎁 تمت إضافة ${bonus}$ للمحيل ${referrerId} بسبب ${completed}$ من إحالة ${userId}`);
    }
  }
}

// 🔐 لوحة الأدمن - عرض الطلبات
bot.hears('📋 عرض الطلبات', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ الوصول مرفوض.');
  try {
    const res = await client.query('SELECT * FROM withdrawals WHERE status = $1 ORDER BY id DESC', ['pending']);
    if (res.rows.length === 0) return ctx.reply('✅ لا توجد طلبات معلقة.');
    for (const req of res.rows) {
      await ctx.reply(
        `طلب سحب #${req.id}\n` +
        `👤 المستخدم: ${req.user_id}\n` +
        `💵 المبلغ: ${Number(req.amount).toFixed(2)}$\n` +
        `💳 Payeer: ${req.payeer_wallet}\n\n` +
        `لقبول: /pay ${req.id}\nلرفض: /reject ${req.id}`
      );
    }
  } catch (err) {
    console.error('❌ عرض الطلبات:', err);
    await ctx.reply('حدث خطأ.');
  }
});

// 🔐 لوحة الأدمن - الإحصائيات
bot.hears('📊 الإحصائيات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const [users, paid, pending] = await Promise.all([
      client.query('SELECT COUNT(*) AS c FROM users'),
      client.query('SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE status = $1', ['paid']),
      client.query('SELECT COUNT(*) AS c FROM withdrawals WHERE status = $1', ['pending'])
    ]);
    await ctx.replyWithHTML(
      `📈 <b>الإحصائيات</b>\n\n` +
      `👥 عدد المستخدمين: <b>${users.rows[0].c}</b>\n` +
      `📤 المدفوعات: <b>${Number(paid.rows[0].s).toFixed(2)}$</b>\n` +
      `⏳ طلبات معلقة: <b>${pending.rows[0].c}</b>`
    );
  } catch (err) {
    console.error('❌ إحصائيات:', err);
    await ctx.reply('حدث خطأ.');
  }
});

// 🔐 خروج الأدمن
bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session = {};
  await ctx.reply('✅ خرجت من لوحة الأدمن.', Markup.keyboard([
      ['💰 رصيدك', '🎁 مصادر الربح'],
      ['📤 طلب سحب']
    ]).resize()
  );
});

// ==================== التشغيل النهائي ====================
(async () => {
  try {
    await connectDB();
    await bot.launch();
    console.log('✅ bot.js: البوت شُغّل بنجاح');
  } catch (error) {
    console.error('❌ فشل في التشغيل:', error);
  }
})();
