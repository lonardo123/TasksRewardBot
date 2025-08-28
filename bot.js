// bot.js (مجمّع كامل مع نظام المهمات + بقاء كل الوظائف القديمة)
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

// ====== init schema (الإحالات + مهمات) ======
async function initSchema() {
  try {
    // referrals
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id  BIGINT NOT NULL UNIQUE,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // referral earnings
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_earnings (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id BIGINT NOT NULL,
        amount NUMERIC(12,6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // tasks (المهمات)
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        price NUMERIC(12,4) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // task submissions (إثباتات المستخدمين)
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_submissions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        proof TEXT NOT NULL,
        status TEXT DEFAULT 'pending', -- pending | approved | rejected
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ initSchema: تم تجهيز الجداول (إحالات + مهمات)');
  } catch (e) {
    console.error('❌ initSchema:', e);
  }
}

// ====== Bot setup ======
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في ملف .env');
  process.exit(1);
}
const bot = new Telegraf(process.env.BOT_TOKEN);
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

// ====== Referral bonus helper (5%) ======
async function applyReferralBonus(earnerId, earnedAmount) {
  try {
    const ref = await client.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [earnerId]);
    if (ref.rows.length === 0) return;
    const referrerId = ref.rows[0].referrer_id;
    if (!referrerId || Number(referrerId) === Number(earnerId)) return;

    const bonus = Number(earnedAmount) * 0.05;
    if (bonus <= 0) return;

    const balRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [referrerId]);
    if (balRes.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [referrerId, 0]);
    }
    await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [bonus, referrerId]);

    await client.query(
      'INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)',
      [referrerId, earnerId, bonus]
    );

    try {
      await client.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [referrerId, bonus, 'referral_bonus']);
    } catch (_) {}

    console.log(`🎉 إحالة: أضيفت مكافأة ${bonus.toFixed(4)}$ للمحيل ${referrerId} بسبب ربح ${earnerId}`);
  } catch (e) {
    console.error('❌ applyReferralBonus:', e);
  }
}

// ====== /credit (admin helper) ======
bot.command('credit', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = (ctx.message.text || '').trim().split(/\s+/);
  const targetId = parts[1];
  const amount = Number(parts[2]);
  if (!targetId || isNaN(amount)) {
    return ctx.reply('استخدم: /credit <userId> <amount>');
  }
  try {
    await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [amount, targetId]);
    try {
      await client.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [targetId, amount, 'manual_credit']);
    } catch (_) {}
    await applyReferralBonus(targetId, amount);
    return ctx.reply(`✅ تم إضافة ${amount.toFixed(4)}$ للمستخدم ${targetId} وتطبيق مكافأة الإحالة (إن وجدت).`);
  } catch (e) {
    console.error('❌ /credit:', e);
    return ctx.reply('فشل في إضافة الرصيد.');
  }
});

// ====== /admin (لوحة الأدمن) ======
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
    ['➕ إضافة مهمة جديدة', '📝 جدول المهمات'],
    ['📂 إثباتات المهمات', '👥 ريفيرال'],
    ['🚪 خروج من لوحة الأدمن']
  ]).resize());
});

// ====== /start ======
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || '';

  try {
    // payload handling for referral
    let payload = null;
    if (ctx.startPayload) {
      payload = ctx.startPayload;
    } else if (ctx.message?.text?.includes('/start')) {
      const parts = ctx.message.text.split(' ');
      payload = parts[1] || null;
    }

    // ensure user row exists
    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = 0;
    if (res.rows.length > 0) {
      balance = parseFloat(res.rows[0].balance) || 0;
    } else {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }

    // referral record
    if (payload && /^ref_\d+$/i.test(payload)) {
      const referrerId = Number(payload.replace(/ref_/i, ''));
      if (referrerId && referrerId !== userId) {
        const exists = await client.query('SELECT 1 FROM referrals WHERE referee_id = $1', [userId]);
        if (exists.rows.length === 0) {
          await client.query('INSERT INTO referrals (referrer_id, referee_id) VALUES ($1,$2)', [referrerId, userId]);
          try {
            await bot.telegram.sendMessage(referrerId, `🎉 مستخدم جديد انضم من رابطك: ${userId}`);
          } catch (_) {}
        }
      }
    }

    // reply with keyboard (includes tasks + rate link)
    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n💰 <b>رصيدك:</b> ${balance.toFixed(4)}$`,
      Markup.keyboard([
        ['💰 رصيدك', '🎁 مصادر الربح'],
        ['📤 طلب سحب', '👥 ريفيرال'],
        ['💼 ربح من المهمات', '🔗 قيم البوت من هنا']
      ]).resize()
    );

    // long help message (kept)
    await ctx.replyWithHTML(
`📌 <b>طريقة العمل:</b>
1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.
2️⃣ اختر 🕒 <b>TimeWall</b>.
3️⃣ اربط حسابك عبر الرابط الظاهر.
4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).

🔑 <b>طريقة سحب المال من TimeWall:</b>
- ادخل صفحة Withdraw
- اضغط على زر "سحب" أعلى الصفحة
- الأرباح تضاف لحسابك مباشرة 💵

💰 <b>السحب من البوت:</b>
- الحد الأدنى: 1$
- اختر 📤 <b>طلب سحب</b>
- أدخل محفظة <b>Payeer</b>
- بعد مراجعة الأدمن يتم الدفع ✅`
    );

  } catch (err) {
    console.error('❌ /start:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
});

// ====== زراير وروتينات المستخدم الأساسية ======

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

// 👥 ريفيرال
bot.hears('👥 ريفيرال', async (ctx) => {
  const userId = ctx.from.id;
  const botUsername = 'TasksRewardBot';
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
  try {
    // حساب عدد الإحالات فقط
    const countRes = await client.query(
      'SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = $1',
      [userId]
    );
    const refsCount = Number(countRes.rows[0]?.c || 0);

    await ctx.replyWithHTML(
`👥 <b>برنامج الإحالة</b>
هذا رابطك الخاص، شاركه مع أصدقائك واربح من نشاطهم:
🔗 <code>${refLink}</code>

💡 <b>كيف تُحتسب أرباح الإحالة؟</b>
تحصل على <b>5%</b> من أرباح كل مستخدم ينضم من طرفك.

📊 <b>إحصاءاتك</b>
- عدد الإحالات: <b>${refsCount}</b>`
    );
  } catch (e) {
    console.error('❌ ريفيرال:', e);
    await ctx.reply('تعذر جلب بيانات الإحالة حالياً.');
  }
});


// 🎁 مصادر الربح (تحوي TimeWall وباقي)
bot.hears('🎁 مصادر الربح', async (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.io/users/login?oid=b328534e6b994827&uid=${userId}`;

  await ctx.reply(
    'اختر مصدر ربح:',
    Markup.inlineKeyboard([
      [Markup.button.url('🕒 TimeWall', timewallUrl)],
    ])
  );

  await ctx.replyWithHTML(
`📌 <b>طريقة العمل:</b>
1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.
2️⃣ اختر 🕒 <b>TimeWall</b>.
3️⃣ اربط حسابك عبر الرابط الظاهر.
4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).

🔑 <b>طريقة سحب المال من TimeWall:</b>
- ادخل صفحة Withdraw
- اضغط على زر "سحب" أعلى الصفحة
- الأرباح تضاف لحسابك مباشرة 💵`
  );
});

// 🔗 قيم البوت من هنا (زر القائمة يفتح رسالة مع الرابط)
bot.hears('🔗 قيم البوت من هنا', (ctx) => {
  ctx.reply(
    `🌟 لو سمحت قيم البوت من هنا:\n👉 https://toptelegrambots.com/list/TasksRewardBot`,
    Markup.inlineKeyboard([
      [Markup.button.url('🔗 افتح صفحة التقييم', 'https://toptelegrambots.com/list/TasksRewardBot')]
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

// ====== المعالجة العامة للـ text (موحّد لكل الحالات التفاعلية) ======
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim();

  // مجموعة النصوص الرئيسية لتجنب التعارض مع الاستجابات التفاعلية
  const menuTexts = new Set([
    '💰 رصيدك','🎁 مصادر الربح','📤 طلب سحب','👥 ريفيرال',
    '📋 عرض الطلبات','📊 الإحصائيات',
    '➕ إضافة רصيد','➖ خصم رصيد',
    '🚪 خروج من لوحة الأدمن',
    '💼 ربح من المهمات','🔗 قيم البوت من هنا',
    '➕ إضافة مهمة جديدة','📂 إثباتات المهمات','📝 جدول المهمات'
  ]);
  if (menuTexts.has(text)) return next();

  // ——— بدء إضافة مهمة جديدة (الأدمن) ———
  if (text === '➕ إضافة مهمة جديدة') {
    if (!isAdmin(ctx)) return ctx.reply('❌ لا تملك صلاحية أداء هذه العملية.');
    ctx.session.newTaskStage = 'title';
    ctx.session.newTask = null;
    return ctx.reply('✏️ أرسل عنوان المهمة:');
  }

  // ——— إدارة إضافة مهمة جديدة (الأدمن) ———
  if (ctx.session.newTaskStage) {
    if (!isAdmin(ctx)) {
      ctx.session.newTaskStage = null;
      ctx.session.newTask = null;
      return ctx.reply('❌ لا تملك صلاحية أداء هذه العملية.');
    }
    if (ctx.session.newTaskStage === 'title') {
      ctx.session.newTask = { title: ctx.message.text };
      ctx.session.newTaskStage = 'desc';
      return ctx.reply('✏️ أرسل وصف المهمة:');
    } else if (ctx.session.newTaskStage === 'desc') {
      ctx.session.newTask.description = ctx.message.text;
      ctx.session.newTaskStage = 'price';
      return ctx.reply('💵 أرسل سعر المهمة (مثال: 0.5):');
    } else if (ctx.session.newTaskStage === 'price') {
      const price = parseFloat(ctx.message.text);
      if (isNaN(price)) return ctx.reply('❌ السعر غير صالح. أرسل رقم صالح.');
      const t = ctx.session.newTask;
      try {
        await client.query('INSERT INTO tasks (title, description, price) VALUES ($1,$2,$3)', [t.title, t.description, price]);
        ctx.session.newTaskStage = null;
        ctx.session.newTask = null;
        return ctx.reply('✅ تم إضافة المهمة بنجاح.');
      } catch (e) {
        console.error('❌ إضافة مهمة:', e);
        ctx.session.newTaskStage = null;
        ctx.session.newTask = null;
        return ctx.reply('❌ فشل إضافة المهمة.');
      }
    }
  }

  // ——— إدارة تعديل مهمة (الأدمن) ———
  if (ctx.session.editTaskStage) {
    if (!isAdmin(ctx)) {
      ctx.session.editTaskStage = null;
      ctx.session.editTaskId = null;
      ctx.session.editTaskData = null;
      return ctx.reply('❌ لا تملك صلاحية أداء هذه العملية.');
    }

    if (ctx.session.editTaskStage === 'title') {
      ctx.session.editTaskData.title = ctx.message.text;
      ctx.session.editTaskStage = 'desc';
      return ctx.reply('✏️ أرسل الوصف الجديد للمهمة:');
    } else if (ctx.session.editTaskStage === 'desc') {
      ctx.session.editTaskData.description = ctx.message.text;
      ctx.session.editTaskStage = 'price';
      return ctx.reply('💵 أرسل السعر الجديد (مثال: 0.5):');
    } else if (ctx.session.editTaskStage === 'price') {
      const price = parseFloat(ctx.message.text);
      if (isNaN(price)) return ctx.reply('❌ السعر غير صالح.');
      const id = ctx.session.editTaskId;
      const d = ctx.session.editTaskData;
      try {
        await client.query('UPDATE tasks SET title=$1, description=$2, price=$3 WHERE id=$4', [d.title, d.description, price, id]);
        ctx.session.editTaskStage = null;
        ctx.session.editTaskId = null;
        ctx.session.editTaskData = null;
        return ctx.reply(`✅ تم تعديل المهمة #${id} بنجاح.`);
      } catch (e) {
        console.error('❌ تعديل مهمة:', e);
        ctx.session.editTaskStage = null;
        ctx.session.editTaskId = null;
        ctx.session.editTaskData = null;
        return ctx.reply('❌ فشل تعديل المهمة.');
      }
    }
  }
});


  // ——— طلب السحب ———
  if (ctx.session.awaiting_withdraw) {
    if (!/^P\d{8,}$/i.test(text)) return ctx.reply('❌ رقم محفظة غير صالح. يجب أن يبدأ بـ P ويحتوي على 8 أرقام على الأقل.');
    const userId = ctx.from.id;
    try {
      const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
      let balance = parseFloat(userRes.rows[0]?.balance) || 0;
      if (balance < 1.0) return ctx.reply(`❌ الحد الأدنى للسحب هو 1$. رصيدك: ${balance.toFixed(4)}$`);
      const withdrawAmount = Math.floor(balance * 100) / 100;
      const remaining = balance - withdrawAmount;
      await client.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)', [userId, withdrawAmount, text.toUpperCase()]);
      await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [remaining, userId]);
      await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${withdrawAmount.toFixed(2)}$. رصيدك المتبقي: ${remaining.toFixed(4)}$`);
      ctx.session.awaiting_withdraw = false;
    } catch (err) {
      console.error('❌ خطأ في معالجة السحب:', err);
      ctx.session.awaiting_withdraw = false;
      await ctx.reply('حدث خطأ داخلي.');
    }
    return;
  }

  // ——— إضافة / خصم رصيد (الأدمن) ———
  if (ctx.session.awaitingAction === 'add_balance' || ctx.session.awaitingAction === 'deduct_balance') {
    if (!ctx.session.targetUser) {
      // expecting target user id
      ctx.session.targetUser = text;
      return ctx.reply('💵 أرسل المبلغ:');
    } else {
      const targetUser = ctx.session.targetUser;
      const amount = parseFloat(text);
      if (isNaN(amount)) {
        ctx.session = {};
        return ctx.reply('❌ المبلغ غير صالح.');
      }
      try {
        const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [targetUser]);
        if (res.rows.length === 0) {
          ctx.session = {};
          return ctx.reply('❌ المستخدم غير موجود.');
        }
        let balance = parseFloat(res.rows[0].balance) || 0;
        let newBalance = ctx.session.awaitingAction === 'add_balance' ? balance + amount : balance - amount;
        if (newBalance < 0) newBalance = 0;
        await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, targetUser]);
        if (ctx.session.awaitingAction === 'add_balance' && amount > 0) {
          await applyReferralBonus(targetUser, amount);
          try {
            await client.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [targetUser, amount, 'admin_adjust']);
          } catch (_) {}
        }
        await ctx.reply(`✅ تم ${ctx.session.awaitingAction === 'add_balance' ? 'إضافة' : 'خصم'} ${amount.toFixed(4)}$ للمستخدم ${targetUser}.\n💰 رصيده الجديد: ${newBalance.toFixed(4)}$`);
      } catch (err) {
        console.error('❌ خطأ تحديث الرصيد:', err);
        await ctx.reply('❌ فشل تحديث الرصيد.');
      }
      ctx.session = {};
      return;
    }
  }

  // ——— إثبات المهمة (عند طلب المستخدم إرسال إثبات) ———
  if (ctx.session.awaitingProof) {
    const taskId = ctx.session.awaitingProof;
    ctx.session.awaitingProof = null;
    const proof = ctx.message.text;
    const userId = ctx.from.id;
    try {
      await client.query('INSERT INTO task_submissions (user_id, task_id, proof) VALUES ($1,$2,$3)', [userId, taskId, proof]);
      await ctx.reply('✅ تم إرسال إثبات المهمة. سيتم المراجعة من الأدمن.');
      try {
        await bot.telegram.sendMessage(process.env.ADMIN_ID,
          `📂 إثبات جديد للمهمة #${taskId}\n👤 المستخدم: ${userId}\n📝 الإثبات: ${proof}\n\nلقبول: /approve_task ${userId} ${taskId}\nلرفض: /reject_task ${userId} ${taskId}`
        );
      } catch (_) {}
    } catch (e) {
      console.error('❌ حفظ إثبات المهمة:', e);
      await ctx.reply('❌ حدث خطأ أثناء إرسال الإثبات.');
    }
    return;
  }

  // ——— إذا لم يقم أي شرط — استمر للمعالجات الأخرى أو تجاهل ——
  return next();
});

// ====== زراير الأدمن المستقلة (التي كانت في ملفك الأصلي) ======

// 📋 عرض طلبات السحب (الأدمن)
bot.hears('📋 عرض الطلبات', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ الوصول مرفوض.');
  try {
    const res = await client.query('SELECT * FROM withdrawals WHERE status = $1 ORDER BY id DESC', ['pending']);
    if (res.rows.length === 0) {
      return ctx.reply('✅ لا توجد طلبات معلقة.');
    }
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
    console.error('❌ خطأ في عرض الطلبات:', err);
    await ctx.reply('حدث خطأ فني.');
  }
});

// 📊 الإحصائيات (الأدمن)
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

// ➕ إضافة رصيد (الأدمن)
bot.hears('➕ إضافة رصيد', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'add_balance';
  ctx.session.targetUser = null;
  await ctx.reply('🆔 أرسل ID المستخدم لإضافة رصيد:');
});

// ➖ خصم رصيد (الأدمن)
bot.hears('➖ خصم رصيد', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'deduct_balance';
  ctx.session.targetUser = null;
  await ctx.reply('🆔 أرسل ID المستخدم لخصم رصيد:');
});

// خروج الأدمن
bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session = {};
  await ctx.reply('✅ خرجت من لوحة الأدمن.', Markup.keyboard([
    ['💰 رصيدك', '🎁 مصادر الربح'],
    ['📤 طلب سحب', '👥 ريفيرال']
  ]).resize());
});

// أوامر الدفع/الرفض للأدمن (withdrawals)
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

// ====== نظام المهمات - بقية أدوات الأدمن ======

// إثباتات المهمات (عرض للأدمن)
bot.hears('📂 إثباتات المهمات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await client.query("SELECT s.id, s.user_id, s.task_id, s.proof, s.status, s.created_at, t.title FROM task_submissions s LEFT JOIN tasks t ON t.id = s.task_id WHERE s.status='pending' ORDER BY s.id DESC");
    if (res.rows.length === 0) return ctx.reply('📭 لا توجد إثباتات معلقة.');
    for (const sub of res.rows) {
      await ctx.reply(
        `📂 إثبات #${sub.id}\n👤 المستخدم: ${sub.user_id}\n📝 المهمة: ${sub.task_id} - ${sub.title}\n📎 الإثبات: ${sub.proof}\n⏱ المرسل: ${sub.created_at}\n\nلقبول: /approve_task ${sub.user_id} ${sub.task_id}\nرفض: /reject_task ${sub.user_id} ${sub.task_id}`
      );
    }
  } catch (e) {
    console.error('❌ جلب إثباتات المهمات:', e);
    await ctx.reply('حدث خطأ أثناء جلب الإثباتات.');
  }
});

// جدول المهمات (عرض للأدمن مع خيارات تعديل/حذف)
bot.hears('📝 جدول المهمات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await client.query('SELECT * FROM tasks ORDER BY id DESC');
    if (res.rows.length === 0) return ctx.reply('📭 لا توجد مهمات.');
    for (const t of res.rows) {
      await ctx.reply(
        `#${t.id} 📝 ${t.title}\n💵 ${t.price}$\n\nلتعديل: /edittask ${t.id}\nلحذف: /deltask ${t.id}`
      );
    }
  } catch (e) {
    console.error('❌ جدول المهمات:', e);
    await ctx.reply('حدث خطأ أثناء جلب المهام.');
  }
});

// حذف مهمة (cmd: /deltask <id>)
bot.command('deltask', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /deltask <ID>');
  try {
    await client.query('DELETE FROM tasks WHERE id=$1', [id]);
    await ctx.reply(`🗑️ تم حذف المهمة #${id}`);
  } catch (e) {
    console.error('❌ deltask:', e);
    await ctx.reply('فشل حذف المهمة.');
  }
});

// بدء تعديل مهمة (cmd: /edittask <id>)
bot.command('edittask', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /edittask <ID>');
  try {
    const res = await client.query('SELECT * FROM tasks WHERE id=$1', [id]);
    if (res.rows.length === 0) return ctx.reply('❌ المهمة غير موجودة.');
    ctx.session.editTaskStage = 'title';
    ctx.session.editTaskId = id;
    ctx.session.editTaskData = { title: res.rows[0].title, description: res.rows[0].description, price: res.rows[0].price };
    return ctx.reply('✏️ أرسل العنوان الجديد للمهمة:');
  } catch (e) {
    console.error('❌ edittask:', e);
    return ctx.reply('حدث خطأ.');
  }
});

// قبول / رفض إثبات (أوامر للأدمن)
bot.command('approve_task', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const userId = parts[0];
  const taskId = parts[1];
  if (!userId || !taskId) return ctx.reply('استخدم: /approve_task <userId> <taskId>');
  try {
    const subRes = await client.query('SELECT * FROM task_submissions WHERE user_id=$1 AND task_id=$2 AND status=$3', [userId, taskId, 'pending']);
    if (subRes.rows.length === 0) return ctx.reply('❌ لا يوجد طلب.');
    const task = await client.query('SELECT * FROM tasks WHERE id=$1', [taskId]);
    const price = parseFloat(task.rows[0].price);
    await client.query('UPDATE users SET balance = COALESCE(balance,0)+$1 WHERE telegram_id=$2', [price, userId]);
    await client.query('UPDATE task_submissions SET status=$1 WHERE user_id=$2 AND task_id=$3', ['approved', userId, taskId]);
    await ctx.reply(`✅ تم قبول المهمة #${taskId} للمستخدم ${userId} وإضافة ${price}$ لرصيده.`);
    try { await bot.telegram.sendMessage(userId, `🎉 تم قبول مهمتك #${taskId} وإضافة ${price}$ لرصيدك.`); } catch(_) {}
  } catch (e) {
    console.error('❌ approve_task:', e);
    await ctx.reply('فشل في قبول المهمة.');
  }
});

bot.command('reject_task', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = ctx.message.text.split(' ').slice(1);
  const userId = parts[0];
  const taskId = parts[1];
  if (!userId || !taskId) return ctx.reply('استخدم: /reject_task <userId> <taskId>');
  try {
    await client.query('UPDATE task_submissions SET status=$1 WHERE user_id=$2 AND task_id=$3', ['rejected', userId, taskId]);
    await ctx.reply(`⛔ تم رفض المهمة #${taskId} للمستخدم ${userId}.`);
    try { await bot.telegram.sendMessage(userId, `⛔ تم رفض مهمتك #${taskId}.`); } catch(_) {}
  } catch (e) {
    console.error('❌ reject_task:', e);
    await ctx.reply('فشل في رفض المهمة.');
  }
});

// ====== عرض المهام للمستخدم + إرسال إثباتات (الكائن الأساسي للمطلوب) ======

// عرض قائمة المهمات المتاحة (تخفي المهام التي سبق للمستخدم إرسال إثبات لها)
bot.hears('💼 ربح من المهمات', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query(`
      SELECT * FROM tasks t
      WHERE NOT EXISTS (
        SELECT 1 FROM task_submissions s WHERE s.task_id = t.id AND s.user_id = $1
      )
      ORDER BY t.id DESC
    `, [userId]);

    if (res.rows.length === 0) {
      return ctx.reply('📭 لا توجد مهمات متاحة حالياً.');
    }

    const buttons = res.rows.map(t => [Markup.button.callback(`${t.title} - ${t.price}$`, `task_${t.id}`)]);
    await ctx.reply('📋 قائمة المهمات:', Markup.inlineKeyboard(buttons));
  } catch (e) {
    console.error('❌ عرض مهمات:', e);
    await ctx.reply('حدث خطأ أثناء جلب المهمات.');
  }
});

// عند الضغط على عنوان المهمة (callback)
bot.action(/task_(\d+)/, async (ctx) => {
  const taskId = ctx.match[1];
  try {
    const res = await client.query('SELECT * FROM tasks WHERE id=$1', [taskId]);
    if (res.rows.length === 0) return ctx.answerCbQuery('❌ المهمة غير موجودة');
    const task = res.rows[0];
    await ctx.replyWithHTML(
      `📝 <b>${task.title}</b>\n\n${task.description}\n\n💵 السعر: ${task.price}$\n\n✍️ لإرسال إثبات: اضغط زر "إرسال الإثبات" ثم أرسل نص الإثبات.`,
      Markup.inlineKeyboard([[ Markup.button.callback('📤 إرسال الإثبات', `sendproof_${taskId}`) ]])
    );
  } catch (e) {
    console.error('❌ task action:', e);
    return ctx.answerCbQuery('حدث خطأ.');
  }
});

// عند ضغط زر إرسال الإثبات نضع الحالة لانتظار نص الإثبات
bot.action(/sendproof_(\d+)/, async (ctx) => {
  const taskId = ctx.match[1];
  ctx.session.awaitingProof = taskId;
  await ctx.reply('✍️ أرسل نص الإثبات (رابط/لقطة/وصف):');
});

// ====== التشغيل النهائي ======
(async () => {
  try {
    await connectDB();
    await initSchema();
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
