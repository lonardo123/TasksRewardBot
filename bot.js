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

// Enable in-memory sessions
bot.use(session());

// Simple logger
bot.use((ctx, next) => {
  const from = ctx.from ? `${ctx.from.id} (${ctx.from.username || ctx.from.first_name})` : 'unknown';
  const text = ctx.message?.text || ctx.updateType;
  console.log('📩', from, '→', text);
  return next();
});

// Utility: ensure admin
const isAdmin = (ctx) => String(ctx.from?.id) === String(process.env.ADMIN_ID);

// 🛠 أمر /admin
bot.command('admin', async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const userId = String(ctx.from.id);
  const adminId = String(process.env.ADMIN_ID);
  console.log('🎯 محاولة دخول لوحة الأدمن:', { userId, adminId });

  if (userId !== adminId) {
    console.log('❌ رفض الدخول');
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }

  ctx.session.isAdmin = true;

  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن. اختر العملية:', Markup.keyboard([
      ['📋 عرض الطلبات', '📊 الإحصائيات'],
      ['➕ إضافة رصيد', '➖ خصم رصيد'],
      ['🚪 خروج من لوحة الأدمن']
    ]).resize()
  );
});


// 🏠 /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || '';

  try {
    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = 0;

    if (res.rows.length > 0) {
      balance = parseFloat(res.rows[0].balance) || 0;
    } else {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n💰 <b>رصيدك:</b> ${balance.toFixed(4)}$`,
      Markup.keyboard([
        ['💰 رصيدك', '🎁 مصادر الربح'],
        ['📤 طلب سحب']
      ]).resize()
    );


    
 // رسالة الشرح (تظهر لكل مستخدم/زائر)
    await ctx.replyWithHTML(
      `📌 <b>طريقة العمل:</b>\n
1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.\n
2️⃣ اختر 🕒 <b>TimeWall</b>.\n
3️⃣ اربط حسابك عبر الرابط الظاهر.\n
4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).\n
\n
🔑 <b>طريقة سحب المال من TimeWall:</b>\n
- ادخل صفحة Withdraw\n
- اضغط على زر "سحب" أعلى الصفحة\n
- الأرباح تضاف لحسابك مباشرة 💵\n
\n
💰 <b>السحب من البوت:</b>\n
- الحد الأدنى: 1$\n
- اختر 📤 <b>طلب سحب</b>\n
- أدخل محفظة <b>Payeer</b>\n
- بعد مراجعة الأدمن يتم الدفع ✅`
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
    await ctx.replyWithHTML(`💰 رصيدك: <b>${balance.toFixed(4)}$</b>`);
  } catch (err) {
    console.error('❌ رصيدك:', err);
    await ctx.reply('حدث خطأ.');
  }
});

// 🎁 مصادر الربح
bot.hears('🎁 مصادر الربح', (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.io/users/login?oid=b328534e6b994827&uid=${userId}`;
  const tasksRewardBotUrl = "https://safetradefx.neocities.org/";

  return ctx.reply(
    'اختر مصدر ربح:',
    Markup.inlineKeyboard([
      [Markup.button.url('🕒 TimeWall', timewallUrl)],
      [Markup.button.url('📊 TasksRewardBot', tasksRewardBotUrl )]
    ])
  );
});

// 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;

    if (balance < 1.0) {
      return ctx.reply(`❌ الحد الأدنى للسحب هو 1$. رصيدك: ${balance.toFixed(4)}$`);
    }

    ctx.session.awaiting_withdraw = true;
    await ctx.reply(`🟢 رصيدك مؤهل للسحب.\nأرسل رقم محفظة Payeer (مثل: P12345678):`);
  } catch (err) {
    console.error('❌ طلب سحب:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
});

// معالجة رقم Payeer أو أوامر الرصيد للأدمن
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim();

  const menuTexts = new Set([
    '💰 رصيدك','🎁 مصادر الربح','📤 طلب سحب',
    '📋 عرض الطلبات','📊 الإحصائيات',
    '➕ إضافة رصيد','➖ خصم رصيد',
    '🚪 خروج من لوحة الأدمن'
  ]);
  if (menuTexts.has(text)) return next();

  // —— طلب السحب —— 
  if (ctx.session.awaiting_withdraw) {
    if (!/^P\d{8,}$/i.test(text)) {
      return ctx.reply('❌ رقم محفظة غير صالح. يجب أن يبدأ بـ P ويحتوي على 8 أرقام على الأقل.');
    }

    const userId = ctx.from.id;
    try {
      const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
      let balance = parseFloat(userRes.rows[0]?.balance) || 0;

      if (balance < 1.0) {
        return ctx.reply(`❌ الحد الأدنى للسحب هو 1$. رصيدك: ${balance.toFixed(4)}$`);
      }

      const withdrawAmount = Math.floor(balance * 100) / 100;
      const remaining = balance - withdrawAmount;

      await client.query(
        'INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)',
        [userId, withdrawAmount, text.toUpperCase()]
      );

      await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [remaining, userId]);

      await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${withdrawAmount.toFixed(2)}$. رصيدك المتبقي: ${remaining.toFixed(4)}$`);
      ctx.session.awaiting_withdraw = false;
    } catch (err) {
      console.error('❌ خطأ في معالجة السحب:', err);
      await ctx.reply('حدث خطأ داخلي.');
    }
  }

  // —— إضافة / خصم رصيد —— 
  else if (ctx.session.awaitingAction === 'add_balance' || ctx.session.awaitingAction === 'deduct_balance') {
    if (!ctx.session.targetUser) {
      ctx.session.targetUser = text;
      return ctx.reply('💵 أرسل المبلغ:');
    } else {
      const userId = ctx.session.targetUser;
      const amount = parseFloat(text);

      if (isNaN(amount)) {
        ctx.session = {};
        return ctx.reply('❌ المبلغ غير صالح.');
      }

      try {
        const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
        if (res.rows.length === 0) {
          ctx.session = {};
          return ctx.reply('❌ المستخدم غير موجود.');
        }

        let balance = parseFloat(res.rows[0].balance) || 0;
        let newBalance = ctx.session.awaitingAction === 'add_balance' ? balance + amount : balance - amount;
        if (newBalance < 0) newBalance = 0;

        await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, userId]);

        ctx.reply(`✅ تم ${ctx.session.awaitingAction === 'add_balance' ? 'إضافة' : 'خصم'} ${amount.toFixed(4)}$ للمستخدم ${userId}.\n💰 رصيده الجديد: ${newBalance.toFixed(4)}$`);
      } catch (err) {
        console.error('❌ خطأ تحديث الرصيد:', err);
        ctx.reply('❌ فشل تحديث الرصيد.');
      }

      ctx.session = {};
    }
  }

  else {
    return next();
  }
});

// 🔐 لوحة الأدمن - عرض الطلبات
bot.hears('📋 عرض الطلبات', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ الوصول مرفوض.');
  try {
    const res = await client.query('SELECT * FROM withdrawals WHERE status = $1 ORDER BY id DESC', ['pending']);
    if (res.rows.length === 0) {
      await ctx.reply('✅ لا توجد طلبات معلقة.');
    } else {
      for (const req of res.rows) {
        await ctx.reply(
          `طلب سحب #${req.id}\n` +
          `👤 المستخدم: ${req.user_id}\n` +
          `💵 المبلغ: ${Number(req.amount).toFixed(2)}$\n` +
          `💳 Payeer: ${req.payeer_wallet}\n\n` +
          `لقبول: /pay ${req.id}\nلرفض: /reject ${req.id}`
        );
      }
    }
  } catch (err) {
    console.error('❌ خطأ في عرض الطلبات:', err);
    await ctx.reply('حدث خطأ فني.');
  }
});

// 🔐 لوحة الأدمن - الإحصائيات
bot.hears('📊 الإحصائيات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const [users, earnings, paid, pending] = await Promise.all([
      client.query('SELECT COUNT(*) AS c FROM users'),
      client.query('SELECT COALESCE(SUM(amount), 0) AS s FROM earnings'),
      client.query('SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE status = $1', ['paid']),
      client.query('SELECT COUNT(*) AS c FROM withdrawals WHERE status = $1', ['pending'])
    ]);

    await ctx.replyWithHTML(
      `📈 <b>الإحصائيات</b>\n\n` +
      `👥 عدد المستخدمين: <b>${users.rows[0].c}</b>\n` +
      `💰 الأرباح الموزعة: <b>${Number(earnings.rows[0].s).toFixed(2)}$</b>\n` +
      `📤 المدفوعات: <b>${Number(paid.rows[0].s).toFixed(2)}$</b>\n` +
      `⏳ طلبات معلقة: <b>${pending.rows[0].c}</b>`
    );
  } catch (err) {
    console.error('❌ خطأ في الإحصائيات:', err);
    await ctx.reply('حدث خطأ في جلب الإحصائيات.');
  }
});

// ➕ إضافة رصيد
bot.hears('➕ إضافة رصيد', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'add_balance';
  ctx.session.targetUser = null;
  await ctx.reply('🆔 أرسل ID المستخدم لإضافة رصيد:');
});

// ➖ خصم رصيد
bot.hears('➖ خصم رصيد', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'deduct_balance';
  ctx.session.targetUser = null;
  await ctx.reply('🆔 أرسل ID المستخدم لخصم رصيد:');
});

// 🔐 لوحة الأدمن - خروج
bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session = {};
  await ctx.reply('✅ خرجت من لوحة الأدمن.', Markup.keyboard([
      ['💰 رصيدك', '🎁 مصادر الربح'],
      ['📤 طلب سحب']
    ]).resize()
  );
});

// أوامر الدفع/الرفض للأدمن
bot.command('pay', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /pay <ID>');
  try {
    const res = await client.query('UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *', ['paid', id]);
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');
    await ctx.reply(`✅ تم تعليم الطلب #${id} كمدفوع.`);
  } catch (e) {
    console.error('❌ pay:', e);
    await ctx.reply('فشل تحديث الحالة.');
  }
});

bot.command('reject', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /reject <ID>');
  try {
    const res = await client.query('UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *', ['rejected', id]);
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');
    await ctx.reply(`⛔ تم رفض الطلب #${id}.`);
  } catch (e) {
    console.error('❌ reject:', e);
    await ctx.reply('فشل تحديث الحالة.');
  }
});

// ==================== التشغيل النهائي ====================
(async () => {
  try {
    await connectDB();
    await bot.launch();
    console.log('✅ bot.js: البوت شُغّل بنجاح');

    process.once('SIGINT', () => {
      console.log('🛑 SIGINT: stopping bot...');
      bot.stop('SIGINT');
      client.end().then(() => console.log('🗄️ Postgres connection closed.'));
    });
    process.once('SIGTERM', () => {
      console.log('🛑 SIGTERM: stopping bot...');
      bot.stop('SIGTERM');
      client.end().then(() => console.log('🗄️ Postgres connection closed.'));
    });

  } catch (error) {
    console.error('❌ فشل في التشغيل:', error);
  }
})();
