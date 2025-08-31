const { Telegraf, session, Markup } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

// ====== Debug env ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);
const userSessions = {};

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

// 🔵 إنشاء/تحديث جميع الجداول عند الإقلاع
async function initSchema() {
  try {
    // جدول المستخدمين
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        balance NUMERIC(12,6) DEFAULT 0,
        payeer_wallet VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول الأرباح
    await client.query(`
      CREATE TABLE IF NOT EXISTS earnings (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        source VARCHAR(100),
        amount NUMERIC(12,6) NOT NULL,
        description TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول الإحالات
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id BIGINT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول أرباح الإحالة
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_earnings (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id BIGINT NOT NULL,
        amount NUMERIC(12,6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول المهمات
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        price NUMERIC(12,6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول إثباتات المهمات
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_proofs (
        id SERIAL PRIMARY KEY,
        task_id INT NOT NULL,
        user_id BIGINT NOT NULL,
        proof TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // جدول تتبع حالة المهمة لكل مستخدم
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        task_id INT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending', -- pending | approved | rejected
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, task_id)
      );
    `);

    // جدول إرسال المهمات (فيه proof + status زي اللي قلت)
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_submissions (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        task_id INT NOT NULL,
        proof TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول السحوبات
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount NUMERIC(12,6) NOT NULL,
        payeer_wallet VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ initSchema: تم تجهيز كل الجداول بنجاح');
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

// 🔵 أداة مساعدة: تطبيق مكافأة الإحالة (5%) عند إضافة أرباح للمستخدم
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
      await client.query(
        'INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)',
        [referrerId, bonus, 'referral_bonus']
      );
    } catch (_) {}

    console.log(`🎉 إحالة: أضيفت مكافأة ${bonus.toFixed(4)}$ للمحيل ${referrerId} بسبب ربح ${earnerId}`);
  } catch (e) {
    console.error('❌ applyReferralBonus:', e);
  }
}

// 🔵 أمر أدمن اختياري لاختبار إضافة أرباح + تطبيق مكافأة الإحالة
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
    ['➕ إضافة مهمة جديدة', '📝 المهمات', '📝 اثباتات مهمات المستخدمين'],
    ['👥 ريفيرال', '🚪 خروج من لوحة الأدمن']
  ]).resize()
  );
});

// 🏠 /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || '';

  try {
    let payload = null;
    if (ctx.startPayload) {
      payload = ctx.startPayload;
    } else if (ctx.message?.text?.includes('/start')) {
      const parts = ctx.message.text.split(' ');
      payload = parts[1] || null;
    }

    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = 0;

    if (res.rows.length > 0) {
      balance = parseFloat(res.rows[0].balance) || 0;
    } else {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }

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

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n💰 <b>رصيدك:</b> ${balance.toFixed(4)}$`,
      Markup.keyboard([
        ['💰 رصيدك', '🎁 مصادر الربح'],
        ['📤 طلب سحب', '👥 ريفيرال'],
        ['📝 مهمات TasksRewardBot', '🔗 قيم البوت من هنا']
      ]).resize()
    );

    await ctx.replyWithHTML(
      `📌 <b>طريقة العمل:</b>\n\n1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.\n\n2️⃣ اختر 🕒 <b>TimeWall</b>.\n\n3️⃣ اربط حسابك عبر الرابط الظاهر.\n\n4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).\n\n\n🔑 <b>طريقة سحب المال من TimeWall:</b>\n- ادخل صفحة Withdraw\n- اضغط على زر "سحب" أعلى الصفحة\n- الأرباح تضاف لحسابك مباشرة 💵\n\n\n💰 <b>السحب من البوت:</b>\n- الحد الأدنى: 1$\n- اختر 📤 <b>طلب سحب</b>\n- أدخل محفظة <b>Payeer</b>\n- بعد مراجعة الأدمن يتم الدفع ✅`
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

// 🔵 👥 ريفيرال — عرض رابط الإحالة + شرح
bot.hears('👥 ريفيرال', async (ctx) => {
  const userId = ctx.from.id;
  const botUsername = 'TasksRewardBot';
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

  try {
    const countRes = await client.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = $1', [userId]);
    const refsCount = Number(countRes.rows[0]?.c || 0);

    const earnRes = await client.query('SELECT COALESCE(SUM(amount),0) AS s FROM referral_earnings WHERE referrer_id = $1', [userId]);
    const refEarnings = Number(earnRes.rows[0]?.s || 0);

    await ctx.replyWithHTML(
`👥 <b>برنامج الإحالة</b>\nهذا رابطك الخاص، شاركه مع أصدقائك واربح من نشاطهم:\n🔗 <code>${refLink}</code>\n\n💡 <b>كيف تُحتسب أرباح الإحالة؟</b>\nتحصل على <b>5%</b> من أرباح كل مستخدم ينضم من طرفك .\n\n📊 <b>إحصاءاتك</b>\n- عدد الإحالات: <b>${refsCount}</b>`
    );
  } catch (e) {
    console.error('❌ ريفيرال:', e);
    await ctx.reply('تعذر جلب بيانات الإحالة حالياً.');
  }
});

// 🎁 مصادر الربح
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
`📌 <b>طريقة العمل:</b>\n1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.\n2️⃣ اختر 🕒 <b>TimeWall</b>.\n3️⃣ اربط حسابك عبر الرابط الظاهر.\n4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهام بسيطة).\n\n🔑 <b>طريقة سحب المال من TimeWall:</b>\n- ادخل صفحة Withdraw\n- اضغط على زر "سحب" أعلى الصفحة\n✅ الأرباح تضاف لحسابك مباشرة 💵`
  );
});

// ✅ عرض المهمات (للمستخدمين)
bot.hears('📝 مهمات TasksRewardBot', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const res = await client.query(
      `SELECT t.id, t.title, t.description, t.price
       FROM tasks t
       WHERE NOT EXISTS (
         SELECT 1 FROM user_tasks ut
         WHERE ut.task_id = t.id
           AND ut.user_id = $1
           AND ut.status IN ('pending','approved')
       )
       ORDER BY t.id DESC
       LIMIT 20`,
      [userId]
    );

    if (res.rows.length === 0) {
      return ctx.reply('❌ لا توجد مهمات متاحة حالياً.');
    }

    for (const t of res.rows) {
      const price = parseFloat(t.price) || 0;
      const msg =
        `📋 المهمة #${t.id}\n\n` +
        `🏷️ العنوان: ${t.title}\n` +
        `📖 الوصف: ${t.description}\n` +
        `💰 السعر: ${price.toFixed(6)}$\n\n` +
        `▶️ لإرسال إثبات المهمة: اضغط زر "📝 إرسال إثبات" أو اكتب /submit ${t.id}`;

      await ctx.reply(msg, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📝 إرسال إثبات", callback_data: `submit_${t.id}` }]
          ]
        }
      });
    }
  } catch (err) {
    console.error('❌ عرض المهمات:', err);
    ctx.reply('حدث خطأ أثناء عرض المهمات.');
  }
});

// ✅ عند الضغط على زر "إرسال إثبات"
bot.action(/^submit_(\d+)$/, async (ctx) => {
  try {
    const taskId = ctx.match[1];
    const userId = ctx.from.id;

    if (!userSessions[userId]) userSessions[userId] = {};
    userSessions[userId].awaiting_task_submission = taskId;

    await ctx.reply(`📩 أرسل الآن إثبات إتمام المهمة رقم ${taskId}`);
  } catch (err) {
    console.error("❌ submit action error:", err.message, err.stack);
    await ctx.reply("⚠️ حدث خطأ، حاول مرة أخرى.");
  }
});

// ✅ استقبال الإثبات من المستخدم — لا يمنع بقية الأزرار من العمل (محدّث: يسجل task_proofs + user_tasks)
bot.on("message", async (ctx, next) => {
  const userId = ctx.from.id;
  if (!userSessions[userId]) userSessions[userId] = {};
  const session = userSessions[userId];

  // لو المستخدم في وضع إرسال إثبات
  if (session.awaiting_task_submission) {
    const taskId = Number(session.awaiting_task_submission);
    let proof = ctx.message.text || "";

    if (ctx.message.photo && ctx.message.photo.length) {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      proof = `📷 صورة مرفقة - file_id: ${fileId}`;
    }

    try {
      // نستخدم transaction لحماية الإدخالات
      await client.query('BEGIN');

      // تحقق إذا كانت المهمة قيد الانتظار أو معتمدة بالفعل للمستخدم
      const exists = await client.query(
        'SELECT status FROM user_tasks WHERE user_id = $1 AND task_id = $2',
        [userId, taskId]
      );
      if (exists.rows.length && ['pending','approved'].includes(exists.rows[0].status)) {
        await client.query('ROLLBACK');
        session.awaiting_task_submission = null;
        await ctx.reply('⚠️ لقد سبق وأن أرسلت إثباتاً لهذه المهمة أو تم اعتمادها بالفعل.');
        return;
      }

      // إدخال الإثبات في task_proofs
      await client.query(
        "INSERT INTO task_proofs (task_id, user_id, proof, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())",
        [taskId, userId, proof]
      );

      // إدخال/تحديث سجل user_tasks → يصبح pending (حتى تختفي المهمة من قائمة المستخدم)
      await client.query(
        `INSERT INTO user_tasks (user_id, task_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (user_id, task_id) DO UPDATE
           SET status = 'pending', created_at = NOW()`,
        [userId, taskId]
      );

      await client.query('COMMIT');

      await ctx.reply("✅ تم إرسال الإثبات، وسيتم مراجعته من الإدارة.");
      session.awaiting_task_submission = null;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch(_) {}
      console.error("❌ خطأ أثناء حفظ الإثبات:", err);
      await ctx.reply("⚠️ لم يتم حفظ الإثبات، حاول مرة أخرى.");
    }

    return; // مهم: لا نمرّر الرسالة لباقي الهاندلرز
  }

  // مش في وضع إثبات → مرّر الرسالة لباقي الهاندلرز
  return next();
});

// 🔗 قيم البوت
bot.hears('🔗 قيم البوت من هنا', async (ctx) => {
  try {
    await ctx.reply(
      `🌟 لو سمحت قيّم البوت من هنا:\n👉 https://toptelegrambots.com/list/TasksRewardBot`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔗 افتح صفحة التقييم', url: 'https://toptelegrambots.com/list/TasksRewardBot' }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("❌ خطأ في زر التقييم:", err);
    await ctx.reply("⚠️ حدث خطأ، حاول مرة أخرى.");
  }
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

// معالجة نصوص عامة (سابقاً كان فيها تعارض مع إرسال الإثبات) — لا تزدوج إرسال الإثبات هنا
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim();

  const menuTexts = new Set([
    '💰 رصيدك','🎁 مصادر الربح','📤 طلب سحب','👥 ريفيرال',
    '📋 عرض الطلبات','📊 الإحصائيات',
    '➕ إضافة רصيد','➖ خصم رصيد',
    '🚪 خروج من لوحة الأدمن'
  ]);

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

      await client.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)', [userId, withdrawAmount, text.toUpperCase()]);
      await client.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [remaining, userId]);

      await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${withdrawAmount.toFixed(2)}$. رصيدك المتبقي: ${remaining.toFixed(4)}$`);
      ctx.session.awaiting_withdraw = false;
    } catch (err) {
      console.error('❌ خطأ في معالجة السحب:', err);
      await ctx.reply('حدث خطأ داخلي.');
    }

    return;
  }

  // —— إضافة / خصم رصيد ——
  if (ctx.session.awaitingAction === 'add_balance' || ctx.session.awaitingAction === 'deduct_balance') {
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

        if (ctx.session.awaitingAction === 'add_balance' && amount > 0) {
          await applyReferralBonus(userId, amount);
          try { await client.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [userId, amount, 'admin_adjust']); } catch(_){}
        }

        ctx.reply(`✅ تم ${ctx.session.awaitingAction === 'add_balance' ? 'إضافة' : 'خصم'} ${amount.toFixed(4)}$ للمستخدم ${userId}.\n💰 رصيده الجديد: ${newBalance.toFixed(4)}$`);
      } catch (err) {
        console.error('❌ خطأ تحديث الرصيد:', err);
        ctx.reply('❌ فشل تحديث الرصيد.');
      }

      ctx.session = {};
      return;
    }
  }

  if (menuTexts.has(text)) return next();
  return next();
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

bot.hears('➕ إضافة مهمة جديدة', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'add_task';
  ctx.reply('📌 أرسل المهمة الجديدة بصيغة: العنوان | الوصف | السعر');
});

// إضافة مهمة - أدمن
bot.on('text', async (ctx, next) => {
  if (ctx.session && ctx.session.awaitingAction === 'add_task') {
    if (!isAdmin(ctx)) {
      delete ctx.session.awaitingAction;
      return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
    }

    const raw = ctx.message.text || '';
    const parts = raw.split('|').map(p => p.trim());

    if (parts.length < 3) {
      return ctx.reply('❌ صيغة خاطئة. استخدم: العنوان | الوصف | السعر\nمثال: coinpayu | اجمع رصيد وارفق رابط الموقع https://... | 0.0500');
    }

    const title = parts[0];
    const description = parts.slice(1, -1).join(' | ');
    const rewardStr = parts[parts.length - 1];

    const numMatch = rewardStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
    }

    let cleanReward = numMatch[0].replace(',', '.');
    const price = parseFloat(cleanReward);

    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010');
    }

    try {
      const res = await client.query(
        'INSERT INTO tasks (title, description, price) VALUES ($1,$2,$3) RETURNING id, title, price',
        [title, description, price]
      );

      const formattedDescription = description.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');

      await ctx.replyWithHTML(
        `✅ تم إضافة المهمة بنجاح.\n\n📌 <b>العنوان:</b> ${res.rows[0].title}\n📝 <b>الوصف:</b> ${formattedDescription}\n💰 <b>السعر:</b> ${parseFloat(res.rows[0].price).toFixed(4)}`,
        { disable_web_page_preview: true }
      );

      delete ctx.session.awaitingAction;
    } catch (err) {
      console.error('❌ إضافة مهمة: ', err.message);
      console.error(err.stack);
      ctx.reply('حدث خطأ أثناء إضافة المهمة. راجع سجلات السيرفر (console) لمعرفة التفاصيل.');
    }

    return;
  }

  return next();
});

// 📝 عرض كل المهمات (للأدمن)
bot.hears('📝 المهمات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await client.query('SELECT id, title, description, price FROM tasks ORDER BY id DESC');
    if (res.rows.length === 0) return ctx.reply('⚠️ لا توجد مهام حالياً.');

    for (const t of res.rows) {
      const price = parseFloat(t.price) || 0;
      const text = `📋 المهمة #${t.id}\n\n` +
                   `🏷️ العنوان: ${t.title}\n` +
                   `📖 الوصف: ${t.description}\n` +
                   `💰 السعر: ${price.toFixed(4)}$`;

      await ctx.reply(text, Markup.inlineKeyboard([
        [ Markup.button.callback(`✏️ تعديل ${t.id}`, `edit_${t.id}`) ],
        [ Markup.button.callback(`🗑️ حذف ${t.id}`, `delete_${t.id}`) ]
      ]));
    }
  } catch (err) {
    console.error('❌ المهمات:', err);
    await ctx.reply('خطأ أثناء جلب المهمات.');
  }
});

// ✏️ زر تعديل المهمة (يعين حالة انتظار التعديل)
bot.action(/^edit_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ غير مسموح');
    return;
  }
  const taskId = ctx.match[1];
  ctx.session.awaitingEdit = taskId;
  await ctx.answerCbQuery();
  await ctx.reply(`✏️ أرسل المهمة الجديدة لـ #${taskId} بصيغة:\n\nالعنوان | الوصف | السعر\n\nمثال:\ncoinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500`);
});

// 🗑️ زر حذف المهمة
bot.action(/^delete_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ غير مسموح');
    return;
  }
  const taskId = ctx.match[1];
  try {
    await client.query('DELETE FROM tasks WHERE id = $1', [taskId]);
    try {
      await ctx.editMessageText(`🗑️ تم حذف المهمة #${taskId}`);
    } catch (_) {
      await ctx.reply(`🗑️ تم حذف المهمة #${taskId}`);
    }
    await ctx.answerCbQuery();
  } catch (err) {
    console.error('❌ حذف المهمة:', err);
    await ctx.answerCbQuery('حدث خطأ أثناء الحذف.');
    await ctx.reply('حدث خطأ أثناء حذف المهمة.');
  }
});

// 📌 استلام بيانات التعديل (عند إرسال الأدمن للنص الجديد)
bot.on('text', async (ctx, next) => {
  if (!ctx.session || !ctx.session.awaitingEdit) return next();
  if (!isAdmin(ctx)) {
    ctx.session.awaitingEdit = null;
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }

  const taskId = ctx.session.awaitingEdit;
  const raw = ctx.message.text || '';
  const parts = raw.split('|').map(p => p.trim());

  if (parts.length < 3) {
    return ctx.reply('⚠️ الصيغة غير صحيحة. مثال:\ncoinpayu | سجل عبر الرابط https://... | 0.0500');
  }

  const title = parts[0];
  const description = parts.slice(1, -1).join(' | ');
  const priceStr = parts[parts.length - 1];

  const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
  if (!numMatch) {
    return ctx.reply('❌ السعر غير صالح. استخدم مثلاً: 0.0500');
  }
  const price = parseFloat(numMatch[0].replace(',', '.'));
  if (isNaN(price) || price <= 0) {
    return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
  }

  try {
    await client.query('UPDATE tasks SET title=$1, description=$2, price=$3 WHERE id=$4', [title, description, price, taskId]);
    ctx.session.awaitingEdit = null;
    await ctx.reply(`✅ تم تعديل المهمة #${taskId} بنجاح.\n📌 العنوان: ${title}\n💰 السعر: ${price.toFixed(4)}$`, { disable_web_page_preview: true });
  } catch (err) {
    console.error('❌ تعديل المهمة:', err);
    await ctx.reply('حدث خطأ أثناء تعديل المهمة.');
  }
});

// =================== إثباتات مهمات المستخدمين (للأدمن) ===================
bot.hears('📝 اثباتات مهمات المستخدمين', async (ctx) => {
  if (!isAdmin(ctx)) return;

  try {
    const res = await client.query(
      `SELECT tp.id, tp.task_id, tp.user_id, tp.proof, tp.status, tp.created_at, t.title, t.price
       FROM task_proofs tp
       JOIN tasks t ON t.id = tp.task_id
       WHERE tp.status = $1
       ORDER BY tp.id DESC
       LIMIT 10`,
      ['pending']
    );

    if (res.rows.length === 0) return ctx.reply('✅ لا توجد إثباتات معلقة.');

    for (const sub of res.rows) {
      const price = parseFloat(sub.price) || 0;
      const text =
        `📌 إثبات #${sub.id}\n` +
        `👤 المستخدم: <code>${sub.user_id}</code>\n` +
        `📋 المهمة: ${sub.title} (ID: ${sub.task_id})\n` +
        `💰 المكافأة: ${price.toFixed(4)}$\n` +
        `📝 الإثبات:\n${sub.proof}`;

      await ctx.replyWithHTML(text, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ موافقة", callback_data: `approve_${sub.id}` },
              { text: "❌ رفض", callback_data: `deny_${sub.id}` }
            ]
          ]
        }
      });
    }
  } catch (err) {
    console.error('❌ اثباتات:', err);
    ctx.reply('خطأ أثناء جلب الإثباتات.');
  }
});

// ✅ موافقة الأدمن (محدّث: يحدث user_tasks إلى 'approved' داخل المعاملة)
bot.action(/^approve_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مسموح');
  const subId = Number(ctx.match[1]);

  try {
    await client.query('BEGIN');

    // جلب الإثبات والتأكد من أنه pending
    const subRes = await client.query('SELECT * FROM task_proofs WHERE id=$1 AND status=$2', [subId, 'pending']);
    if (!subRes.rows.length) {
      await client.query('ROLLBACK');
      await ctx.answerCbQuery();
      return ctx.reply('⚠️ هذا الإثبات غير موجود أو تم معالجته مسبقاً.');
    }
    const sub = subRes.rows[0];

    // جلب سعر المهمة
    const taskRes = await client.query('SELECT price FROM tasks WHERE id=$1', [sub.task_id]);
    const price = parseFloat(taskRes.rows[0]?.price) || 0;

    // إضافة الرصيد للمستخدم (أو إنشاء صف جديد إن لم يكن موجوداً)
    const upd = await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [price, sub.user_id]);
    if (upd.rowCount === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [sub.user_id, price]);
    }

    // تسجيل الربح في earnings
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description, timestamp) VALUES ($1, $2, $3, $4, NOW())',
      [sub.user_id, 'task', price, `ربح من تنفيذ مهمة ID ${sub.task_id}`]
    );

    // تحديث حالة الإثبات إلى approved
    await client.query('UPDATE task_proofs SET status=$1 WHERE id=$2', ['approved', subId]);

    // تحديث/إدخال سجل user_tasks → approved (يضمن بقاء المهمة مخفية من القائمة لاحقاً)
    await client.query(
      `INSERT INTO user_tasks (user_id, task_id, status)
       VALUES ($1, $2, 'approved')
       ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'approved'`,
      [sub.user_id, sub.task_id]
    );

    await client.query('COMMIT');

    // تحديث رسالة الأدمن (محاولة) وإعلام المستخدم
    try { await ctx.editMessageText(`✅ تمت الموافقة على الإثبات #${subId}\n👤 المستخدم: ${sub.user_id}\n💰 ${price.toFixed(4)}$`); } catch (_) {}
    try { await bot.telegram.sendMessage(sub.user_id, `✅ تمت الموافقة على إثبات المهمة (ID: ${sub.task_id}). المبلغ ${price.toFixed(4)}$ أُضيف إلى رصيدك.`); } catch (_) {}

    // تطبيق مكافأة الإحالة (وظيفة موجودة مسبقاً)
    try {
      await applyReferralBonus(sub.user_id, price);
    } catch (e) {
      console.error('❌ خطأ أثناء تطبيق مكافأة الإحالة بعد الموافقة:', e);
    }

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch(_) {}
    console.error('❌ approve error:', err);
    await ctx.reply('حدث خطأ أثناء الموافقة على الإثبات.');
  }
});

// ✅ رفض الأدمن (محدّث: يجعل user_tasks = 'rejected' حتى تظهر المهمة للمستخدم مرة أخرى)
bot.action(/^deny_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مسموح');
  const subId = Number(ctx.match[1]);

  try {
    // نغيّر حالة الإثبات إذا كانت pending
    const res = await client.query(
      'UPDATE task_proofs SET status=$1 WHERE id=$2 AND status=$3 RETURNING *',
      ['rejected', subId, 'pending']
    );

    if (!res.rowCount) return ctx.reply('⚠️ هذا الإثبات غير موجود أو تم معالجته سابقًا.');

    const row = res.rows[0];

    // تحديث/إدخال سجل user_tasks إلى 'rejected' → المهمة ستظهر مجدداً لأننا نستبعد فقط pending/approved عند العرض
    await client.query(
      `INSERT INTO user_tasks (user_id, task_id, status)
       VALUES ($1, $2, 'rejected')
       ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'rejected'`,
      [row.user_id, row.task_id]
    );

    try { await ctx.editMessageText(`❌ تم رفض الإثبات #${subId}`); } catch (_) {}
    try { await bot.telegram.sendMessage(row.user_id, `❌ تم رفض إثبات المهمة (ID: ${row.task_id}). يمكنك إعادة المحاولة وإرسال إثبات جديد.`); } catch (_) {}

  } catch (err) {
    console.error('❌ deny error:', err);
    ctx.reply('حدث خطأ أثناء رفض الإثبات.');
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

  const userId = ctx.from.id;
  const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
  const balance = parseFloat(res.rows[0]?.balance) || 0;

  await ctx.reply(`✅ خرجت من لوحة الأدمن.\n💰 رصيدك: ${balance.toFixed(4)}$`,
    Markup.keyboard([
      ['💰 رصيدك', '🎁 مصادر الربح'],
      ['📤 طلب سحب', '👥 ريفيرال'],
      ['📝 مهمات TasksRewardBot', '🔗 قيم البوت من هنا']
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
