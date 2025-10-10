require('dotenv').config();
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

// Import shared DB client
const { client } = require('./db');

// ====== BOT SECTION (from bot.js) ======
require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const { client } = require('./db'); // استخدام العميل المشترك

// ====== Debug متغيرات البيئة ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);

// ====== إعداد البوت ======
if (!process.env.BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في ملف .env');
  process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// تسجيل الرسائل الواردة
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
  ['📝 مهمات TasksRewardBot', '🎬 فيديوهاتي'],
  ['🔗 قيم البوت من هنا'],
  ['📩 تواصل معنا على فيسبوك']
]).resize()
    );

    await ctx.replyWithHTML(
      `📌 <b>طريقة العمل:</b>\n\n1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.\n\n2️⃣ اختر 🕒 <b>TimeWall</b>.\n\n3️⃣ اربط حسابك عبر الرابط الظاهر.\n\n4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).\n\n\n🔑 <b>طريقة سحب المال من TimeWall:</b>\n- ادخل صفحة Withdraw\n- اضغط على زر "سحب" أعلى الصفحة\n- الأرباح تضاف لحسابك مباشرة 💵\n\n\n💰 <b>السحب من البوت:</b>\n- الحد الأدنى: 0.03$\n- اختر 📤 <b>طلب سحب</b>\n- أدخل محفظة <b>Payeer</b>\n- بعد مراجعة الأدمن يتم الدفع ✅`
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
  const botUsername = 'TasksRewardBot'; // اسم البوت

  try {
    // إنشاء رابط الإحالة الخاص بالمستخدم
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;

    // إجمالي عدد الإحالات
    const countRes = await client.query(
      'SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = $1',
      [userId]
    );
    const refsCount = Number(countRes.rows[0]?.c || 0);

    // إجمالي أرباح الإحالات
    const earnRes = await client.query(
      'SELECT COALESCE(SUM(amount),0) AS s FROM referral_earnings WHERE referrer_id = $1',
      [userId]
    );
    const refEarnings = Number(earnRes.rows[0]?.s || 0);

    // الرد على المستخدم
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

// 🎁 مصادر الربح
bot.hears('🎁 مصادر الربح', async (ctx) => {
  const userId = ctx.from.id;

  // رابط TimeWall (يدخل مباشرة)
  const timewallUrl = `https://timewall.io/users/login?oid=b328534e6b994827&uid=${userId}`;

  // رابط صفحة شرح الإضافة (ملف extension.html في مجلد public)
  const extensionUrl = `https://perceptive-victory-production.up.railway.app/extension.html?user_id=${userId}`;

  await ctx.reply(
    '🎁 اختر مصدر الربح الذي تفضّله:',
    Markup.inlineKeyboard([
      [Markup.button.url('🕒 TimeWall', timewallUrl)],
      [Markup.button.webApp('🎬 الربح من مشاهدات يوتيوب', extensionUrl)]
    ])
  );

  await ctx.replyWithHTML(
`📌 <b>طريقة العمل:</b>\n1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.\n2️⃣ اختر 🕒 <b>TimeWall</b>.\n3️⃣ اربط حسابك عبر الرابط الظاهر.\n4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهام بسيطة).\n\n🔑 <b>طريقة سحب المال من TimeWall:</b>\n- ادخل صفحة Withdraw\n- اضغط على زر "سحب" أعلى الصفحة\n✅ الأرباح تضاف لحسابك مباشرة 💵`
  );
});

// ✅ عرض المهمات (للمستخدمين) — محدث: يعرض المدة، حالة التقديم، ويظهر "إرسال إثبات" بعد انتهاء المدة
bot.hears('📝 مهمات TasksRewardBot', async (ctx) => {
  try {
    const userId = ctx.from.id;
    const res = await client.query(
      `SELECT t.id, t.title, t.description, t.price, COALESCE(t.duration_seconds, 2592000) AS duration_seconds,
              ut.status, ut.created_at AS applied_at
       FROM tasks t
       LEFT JOIN user_tasks ut
         ON ut.task_id = t.id AND ut.user_id = $1
       WHERE NOT EXISTS (
         SELECT 1 FROM user_tasks ut2
         WHERE ut2.task_id = t.id
           AND ut2.user_id = $1
           AND ut2.status IN ('pending','approved')
       )
       ORDER BY t.id DESC
       LIMIT 20`,
      [userId]
    );

    if (res.rows.length === 0) {
      return ctx.reply('❌ لا توجد مهمات متاحة حالياً.');
    }

    // دالة لتحويل المدة لعرض ودقائق/ساعات/أيام
    const formatDuration = (secs) => {
      if (!secs) return 'غير محددة';
      if (secs < 60) return `${secs} ثانية`;
      if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
      if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
      return `${Math.floor(secs / 86400)} يوم`;
    };

    // دالة لعرض الوقت المتبقي بصيغة مناسبة
    const formatRemaining = (ms) => {
      if (ms <= 0) return 'انتهت';
      const secs = Math.ceil(ms / 1000);
      if (secs < 60) return `${secs} ثانية`;
      if (secs < 3600) return `${Math.ceil(secs / 60)} دقيقة`;
      if (secs < 86400) return `${Math.ceil(secs / 3600)} ساعة`;
      return `${Math.ceil(secs / 86400)} يوم`;
    };

    for (const t of res.rows) {
      const price = parseFloat(t.price) || 0;
      const duration = Number(t.duration_seconds) || 2592000; // افتراضى 30 يوم
      let msg =
        `📋 المهمة #${t.id}\n\n` +
        `🏷️ العنوان: ${t.title}\n` +
        `📖 الوصف: ${t.description}\n` +
        `💰 السعر: ${price.toFixed(6)}$\n` +
        `⏱️ مدة المهمة: ${formatDuration(duration)}\n\n`;

      const buttons = [];

      // حالة المستخدم بالنسبة للمهمة
      const status = t.status; // قد تكون undefined, 'applied', 'rejected', ...
      if (!status || status === 'rejected') {
        // لم يقدّم بعد / رفض سابقاً → يمكنه التقديم الآن
        msg += `▶️ اضغط "📌 قدّم الآن" لبدء العد.\n`;
        buttons.push([{ text: "📌 قدّم الآن", callback_data: `apply_${t.id}` }]);
      } else if (status === 'applied') {
        // المستخدم قدّم → نحسب الوقت المتبقي منذ applied_at + duration
        if (t.applied_at) {
          const appliedAt = new Date(t.applied_at);
          const deadline = new Date(appliedAt.getTime() + duration * 1000);
          const now = new Date();

          if (now >= deadline) {
            // انتهت المدة → نعرض زر إرسال إثبات
            msg += `⏳ انتهت المدة المحددة (${formatDuration(duration)}). الآن يمكنك إرسال الإثبات.`;
            buttons.push([{ text: "📝 إرسال إثبات", callback_data: `submit_${t.id}` }]);
          } else {
            // لسه فى المدة → نظهر الوقت المتبقى
            const remaining = deadline - now;
            msg += `بعد انقضاء المدة المحددة، سيتم تفعيل زر "إرسال الإثبات
نرجو منك مراجعة متطلبات المهمة والتأكد من تنفيذها بالكامل وفق الوصف قبل إرسال الإثبات، حيث أن أي نقص قد يؤدي إلى رفض المهمة.⏳ الوقت المتبقي لإرسال الإثبات: ${formatRemaining(remaining)}.`;
            // (لا نعرض زر إرسال إثبات حتى تنتهي المدة)
          }
        } else {
          // للحماية: لو ما فيه applied_at، نطلب منه التقديم مجدداً
          msg += `▶️ اضغط "📌 قدّم الآن" لبدء العد.`;
          buttons.push([{ text: "📌 قدّم الآن", callback_data: `apply_${t.id}` }]);
        }
      } else {
        // حالات أخرى (مثلاً 'submitted' — لكن عادةُ يتم تحويلها إلى 'pending' عند الإرسال)
        msg += `⏳ حالة التقديم: ${status}.`;
      }

      if (buttons.length > 0) {
        await ctx.reply(msg, { reply_markup: { inline_keyboard: buttons } });
      } else {
        await ctx.reply(msg);
      }
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

// ✅ عند الضغط على زر "قدّم الآن" — يسجل applied ويعرض المدة الفعلية للمهمة
bot.action(/^apply_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery(); // يغلق الـ spinner على الزر
    const taskId = Number(ctx.match[1]);
    const userId = ctx.from.id;

    // احصل مدة المهمة من جدول tasks
    let durationSeconds = 30 * 24 * 60 * 60; // افتراض 30 يوم
    try {
      const tRes = await client.query('SELECT duration_seconds FROM tasks WHERE id = $1', [taskId]);
      if (tRes.rows.length && tRes.rows[0].duration_seconds) {
        durationSeconds = Number(tRes.rows[0].duration_seconds);
      }
    } catch (e) {
      console.error('❌ خطأ جلب duration_seconds:', e);
    }

    // سجّل أن المستخدم قدّم (أو حدّث وقت التقديم إذا كان موجود)
    await client.query(
      `INSERT INTO user_tasks (user_id, task_id, status, created_at)
       VALUES ($1, $2, 'applied', NOW())
       ON CONFLICT (user_id, task_id) DO UPDATE
         SET status = 'applied', created_at = NOW()`,
      [userId, taskId]
    );

    // دالة لعرض المدة بصيغة صديقة للإنسان
    const formatDuration = (secs) => {
      if (!secs) return 'غير محددة';
      if (secs < 60) return `${secs} ثانية`;
      if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
      if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
      return `${Math.floor(secs / 86400)} يوم`;
    };

    await ctx.reply(
      `📌 تم تسجيل تقديمك على المهمة رقم ${taskId}.\n` +
      `⏱️ مدة المهمة: ${formatDuration(durationSeconds)}.\n` +
      `⏳ بعد انتهاء هذه المدة سيظهر لك زر "📝 إرسال إثبات" لإرسال الإثبات.`
    );
  } catch (err) {
    console.error('❌ apply error:', err);
    try { await ctx.answerCbQuery(); } catch(_) {}
    await ctx.reply('⚠️ حدث خطأ أثناء التقديم.');
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

// 📩 تواصل معنا على فيسبوك
bot.hears('📩 تواصل معنا على فيسبوك', async (ctx) => {
  try {
    await ctx.reply(
      `📩 للتواصل معنا زور صفحتنا على فيسبوك:\n👉 https://www.facebook.com/profile.php?id=61581071731231`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📩 افتح صفحتنا على فيسبوك', url: 'https://www.facebook.com/profile.php?id=61581071731231' }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("❌ خطأ في زر فيسبوك:", err);
    await ctx.reply("⚠️ حدث خطأ، حاول مرة أخرى.");
  }
});

const MIN_WITHDRAW = 0.03; // غيّرها إلى القيمة التي تريدها
// 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;

    if (balance < MIN_WITHDRAW) {
  return ctx.reply(`❌ الحد الأدنى للسحب هو ${MIN_WITHDRAW}$. رصيدك: ${balance.toFixed(4)}$`);
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

      if (balance < MIN_WITHDRAW) {
  return ctx.reply(`❌ الحد الأدنى للسحب هو ${MIN_WITHDRAW}$. رصيدك: ${balance.toFixed(4)}$`);
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

// ➕ إضافة مهمة جديدة (محدّث: يدعم مدة خاصة لكل مهمة)
bot.hears('➕ إضافة مهمة جديدة', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'add_task';
  // نطلب الآن مدة اختياريّة كحقل رابع
  ctx.reply('📌 أرسل المهمة الجديدة بصيغة: العنوان | الوصف | السعر | المدة (اختياري)\n' +
            'مثال مدة: 3600s أو 60m أو 1h أو 5d\n' +
            'مثال كامل: coinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 30d');
});

// إضافة مهمة - أدمن (مع دعم المدة الخاصة)
bot.on('text', async (ctx, next) => {
  if (ctx.session && ctx.session.awaitingAction === 'add_task') {
    if (!isAdmin(ctx)) {
      delete ctx.session.awaitingAction;
      return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
    }

    const raw = ctx.message.text || '';
    const parts = raw.split('|').map(p => p.trim());

    // نسمح بصيغة 3 أجزاء (بدون مدة) أو 4 أجزاء (بمدة)
    if (parts.length < 3) {
      return ctx.reply('❌ صيغة خاطئة. استخدم: العنوان | الوصف | السعر | المدة (اختياري)\n' +
                       'مثال: coinpayu | اجمع رصيد وارفق رابط الموقع https://... | 0.0500 | 30d');
    }

    // تحديد الحقول بناءً على طول الـ parts
    const title = parts[0];
    let description = '';
    let priceStr = '';
    let durationStr = null;

    if (parts.length === 3) {
      // الصيغة القديمة بدون مدة
      description = parts[1];
      priceStr = parts[2];
    } else {
      // parts.length >= 4 -> آخر عنصر هو المدة، والقبل الأخيرة هي السعر، والباقي وصف
      durationStr = parts[parts.length - 1];
      priceStr = parts[parts.length - 2];
      description = parts.slice(1, parts.length - 2).join(' | ');
    }

    // ======= تحليل السعر كما في الكود الأصلي =======
    const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
    }
    let cleanReward = numMatch[0].replace(',', '.');
    const price = parseFloat(cleanReward);
    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010');
    }

    // ======= دالة مساعدة لتحويل نص المدة إلى ثوانى =======
    const parseDurationToSeconds = (s) => {
      if (!s) return null;
      s = ('' + s).trim().toLowerCase();

      // نمط بسيط: رقم + وحدة اختيارية (s,m,h,d) أو فقط رقم (يُعتبر ثواني)
      const m = s.match(/^(\d+(?:[.,]\d+)?)(s|sec|secs|m|min|h|d)?$/);
      if (!m) return null;
      let num = m[1].replace(',', '.');
      let val = parseFloat(num);
      if (isNaN(val) || val < 0) return null;
      const unit = m[2] || '';

      switch (unit) {
        case 's': case 'sec': case 'secs': return Math.round(val);
        case 'm': case 'min': return Math.round(val * 60);
        case 'h': return Math.round(val * 3600);
        case 'd': return Math.round(val * 86400);
        default: return Math.round(val); // بدون وحدة → ثواني
      }
    };

    // ======= تحويل المدة أو وضع الافتراضى (30 يوم) =======
    const DEFAULT_DURATION_SECONDS = 30 * 24 * 60 * 60; // 2592000
    let durationSeconds = DEFAULT_DURATION_SECONDS;
    if (durationStr) {
      const parsed = parseDurationToSeconds(durationStr);
      if (parsed === null || parsed <= 0) {
        return ctx.reply('❌ صيغة المدة غير مفهومة. استخدم أمثلة: 3600s أو 60m أو 1h أو 5d');
      }
      durationSeconds = parsed;
    }

    // ======= إدخال المهمة في قاعدة البيانات مع duration_seconds =======
    try {
      const res = await client.query(
        'INSERT INTO tasks (title, description, price, duration_seconds) VALUES ($1,$2,$3,$4) RETURNING id, title, price, duration_seconds',
        [title, description, price, durationSeconds]
      );

      // دالة لعرض المدة بصيغة صديقة للإنسان
      const formatDuration = (secs) => {
        if (!secs) return 'غير محددة';
        if (secs % 86400 === 0) return `${secs / 86400} يوم`;
        if (secs % 3600 === 0) return `${secs / 3600} ساعة`;
        if (secs % 60 === 0) return `${secs / 60} دقيقة`;
        return `${secs} ثانية`;
      };

      const formattedDescription = description.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');

      await ctx.replyWithHTML(
        `✅ تم إضافة المهمة بنجاح.\n\n📌 <b>العنوان:</b> ${res.rows[0].title}\n` +
        `📝 <b>الوصف:</b> ${formattedDescription}\n` +
        `💰 <b>السعر:</b> ${parseFloat(res.rows[0].price).toFixed(4)}\n` +
        `⏱️ <b>مدة المهمة:</b> ${formatDuration(res.rows[0].duration_seconds)}`,
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

// 📝 عرض كل المهمات (للأدمن) — محدث: يعرض المدة لكل مهمة
bot.hears('📝 المهمات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await client.query('SELECT id, title, description, price, duration_seconds FROM tasks ORDER BY id DESC');
    if (res.rows.length === 0) return ctx.reply('⚠️ لا توجد مهام حالياً.');

    const formatDuration = (secs) => {
      if (!secs) return 'غير محددة';
      if (secs < 60) return `${secs} ثانية`;
      if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
      if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
      return `${Math.floor(secs / 86400)} يوم`;
    };

    for (const t of res.rows) {
      const price = parseFloat(t.price) || 0;
      const text = `📋 المهمة #${t.id}\n\n` +
                   `🏷️ العنوان: ${t.title}\n` +
                   `📖 الوصف: ${t.description}\n` +
                   `💰 السعر: ${price.toFixed(4)}$\n` +
                   `⏱️ المدة: ${formatDuration(t.duration_seconds)}`;

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

// 📌 استلام بيانات التعديل (عند إرسال الأدمن للنص الجديد) — محدث لدعم المدة
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
    return ctx.reply('⚠️ الصيغة غير صحيحة. استخدم: العنوان | الوصف | السعر | المدة (اختياري)\nمثال:\ncoinpayu | سجل عبر الرابط https://... | 0.0500 | 10d');
  }

  const title = parts[0];
  let description = '';
  let priceStr = '';
  let durationStr = null;

  if (parts.length === 3) {
    // الصيغة بدون مدة
    description = parts[1];
    priceStr = parts[2];
  } else {
    // آخر عنصر قد يكون المدة، والقبل أخيره السعر، والباقي وصف
    durationStr = parts[parts.length - 1];
    priceStr = parts[parts.length - 2];
    description = parts.slice(1, parts.length - 2).join(' | ');
  }

  // ====== تحليل السعر (كما في الكود الأصلي) ======
  const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
  if (!numMatch) {
    return ctx.reply('❌ السعر غير صالح. استخدم مثلاً: 0.0500');
  }
  const price = parseFloat(numMatch[0].replace(',', '.'));
  if (isNaN(price) || price <= 0) {
    return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
  }

  // ====== دالة مساعدة لتحويل نص المدة إلى ثواني ======
  const parseDurationToSeconds = (s) => {
    if (!s) return null;
    s = ('' + s).trim().toLowerCase();
    const m = s.match(/^(\d+(?:[.,]\d+)?)(s|sec|secs|m|min|h|d)?$/);
    if (!m) return null;
    let num = m[1].replace(',', '.');
    let val = parseFloat(num);
    if (isNaN(val) || val < 0) return null;
    const unit = m[2] || '';
    switch (unit) {
      case 's': case 'sec': case 'secs': return Math.round(val);
      case 'm': case 'min': return Math.round(val * 60);
      case 'h': return Math.round(val * 3600);
      case 'd': return Math.round(val * 86400);
      default: return Math.round(val); // بدون وحدة → نعتبرها ثواني
    }
  };

  // ====== الحصول على قيمة المدة المراد حفظها ======
  const DEFAULT_DURATION_SECONDS = 30 * 24 * 60 * 60; // 30 يوم افتراضي
  let durationSeconds = null;

  if (durationStr) {
    const parsed = parseDurationToSeconds(durationStr);
    if (parsed === null || parsed <= 0) {
      return ctx.reply('❌ صيغة المدة غير مفهومة. أمثلة: 3600s أو 60m أو 1h أو 5d');
    }
    durationSeconds = parsed;
  } else {
    // لو الأدمن لم يحدد مدة: نحافظ على القيمة الحالية في DB
    try {
      const cur = await client.query('SELECT duration_seconds FROM tasks WHERE id=$1', [taskId]);
      durationSeconds = (cur.rows[0] && cur.rows[0].duration_seconds) ? cur.rows[0].duration_seconds : DEFAULT_DURATION_SECONDS;
    } catch (e) {
      durationSeconds = DEFAULT_DURATION_SECONDS;
    }
  }

  // ====== دالة لتنسيق المدة للعرض ======
  const formatDuration = (secs) => {
    if (!secs) return 'غير محددة';
    if (secs < 60) return `${secs} ثانية`;
    if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
    return `${Math.floor(secs / 86400)} يوم`;
  };

  // ====== تنفيذ التحديث في DB ======
  try {
    await client.query(
      'UPDATE tasks SET title=$1, description=$2, price=$3, duration_seconds=$4 WHERE id=$5',
      [title, description, price, durationSeconds, taskId]
    );

    ctx.session.awaitingEdit = null;
    await ctx.reply(`✅ تم تعديل المهمة #${taskId} بنجاح.\n📌 العنوان: ${title}\n💰 السعر: ${price.toFixed(4)}$\n⏱️ المدة: ${formatDuration(durationSeconds)}`, { disable_web_page_preview: true });
  } catch (err) {
    console.error('❌ تعديل المهمة:', err);
    await ctx.reply('حدث خطأ أثناء تعديل المهمة.');
  }

  return; // لا نمرّر للـ next() لأننا عالجنا الرسالة
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
  await ctx.reply(
    `✏️ أرسل المهمة الجديدة لـ #${taskId} بصيغة:\n\n` +
    `العنوان | الوصف | السعر | المدة\n\n` +
    `👉 المدة اكتبها بالدقائق أو الساعات أو الأيام.\n` +
    `مثال:\ncoinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 3 أيام`
  );
});

// 📌 استقبال التعديلات من الأدمن
bot.on('text', async (ctx, next) => {
  if (ctx.session && ctx.session.awaitingEdit) {
    if (!isAdmin(ctx)) {
      delete ctx.session.awaitingEdit;
      return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
    }

    const raw = ctx.message.text || '';
    const parts = raw.split('|').map(p => p.trim());

    if (parts.length < 4) {
      return ctx.reply(
        '❌ صيغة خاطئة.\n' +
        'استخدم: العنوان | الوصف | السعر | المدة\n' +
        'مثال: coinpayu | اجمع رصيد | 0.0500 | 2 ساعات'
      );
    }

    const title = parts[0];
    const description = parts[1];
    const rewardStr = parts[2];
    const durationStr = parts[3]; // 🕒 المدة (نص)

    // ✅ تحويل السعر
    const numMatch = rewardStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
    }
    let cleanReward = numMatch[0].replace(',', '.');
    const price = parseFloat(cleanReward);
    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010');
    }

    // ✅ تحويل المدة إلى ثواني
    let durationSeconds = 0;
    const num = parseInt(durationStr.match(/\d+/)?.[0] || "0");
    if (/يوم/.test(durationStr)) {
      durationSeconds = num * 86400;
    } else if (/ساعة/.test(durationStr)) {
      durationSeconds = num * 3600;
    } else if (/دقيقة/.test(durationStr)) {
      durationSeconds = num * 60;
    } else {
      durationSeconds = num; // fallback لو كتبها مباشرة بالثواني
    }

    if (durationSeconds <= 0) {
      return ctx.reply('❌ المدة غير صالحة. مثال: 3 أيام أو 5 ساعات أو 120 دقيقة.');
    }

    try {
      await client.query(
        'UPDATE tasks SET title=$1, description=$2, price=$3, duration_seconds=$4 WHERE id=$5',
        [title, description, price, durationSeconds, ctx.session.awaitingEdit]
      );

      await ctx.replyWithHTML(
        `✅ تم تعديل المهمة #${ctx.session.awaitingEdit} بنجاح.\n\n` +
        `🏷️ <b>العنوان:</b> ${title}\n` +
        `📖 <b>الوصف:</b> ${description}\n` +
        `💰 <b>السعر:</b> ${price.toFixed(4)}\n` +
        `🕒 <b>المدة:</b> ${durationStr}`
      );

      delete ctx.session.awaitingEdit;
    } catch (err) {
      console.error('❌ تعديل مهمة: ', err.message);
      ctx.reply('حدث خطأ أثناء تعديل المهمة.');
    }

    return;
  }

  return next();
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

// ✅ موافقة الأدمن (محدّث: يحدث user_tasks إلى 'approved' داخل المعاملة + إشعار المحيل)
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

    // تحديث/إدخال سجل user_tasks → approved
    await client.query(
      `INSERT INTO user_tasks (user_id, task_id, status)
       VALUES ($1, $2, 'approved')
       ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'approved'`,
      [sub.user_id, sub.task_id]
    );

    await client.query('COMMIT');

    // تحديث رسالة الأدمن وإبلاغ المستخدم
    try { 
      await ctx.editMessageText(`✅ تمت الموافقة على الإثبات #${subId}\n👤 المستخدم: ${sub.user_id}\n💰 ${price.toFixed(4)}$`); 
    } catch (_) {}
    try { 
      await bot.telegram.sendMessage(sub.user_id, `✅ تمت الموافقة على إثبات المهمة (ID: ${sub.task_id}). المبلغ ${price.toFixed(4)}$ أُضيف إلى رصيدك.`); 
    } catch (_) {}

    // تطبيق مكافأة الإحالة مع إشعار المحيل مباشرة
    try {
      const refRes = await client.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [sub.user_id]);
      if (refRes.rows.length > 0) {
        const referrerId = refRes.rows[0].referrer_id;
        const commission = price * 0.05;

        if (commission > 0) {
          // إضافة الرصيد للمحيل
          const updRef = await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id=$2', [commission, referrerId]);
          if (updRef.rowCount === 0) {
            await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1,$2)', [referrerId, commission]);
          }

          // تسجيل المكافأة في جدول referral_earnings و earnings
          await client.query(
            'INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)',
            [referrerId, sub.user_id, commission]
          );
          await client.query(
            'INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)',
            [referrerId, commission, 'referral_bonus']
          );

          // إرسال إشعار المحيل
          try {
            await bot.telegram.sendMessage(referrerId, `🎉 حصلت على عمولة ${commission.toFixed(4)}$ من إحالة ${sub.user_id} بعد تنفيذ مهمة.`);
          } catch (_) {}
        }
      }
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
    const [users, earnings, paid, pending, proofs] = await Promise.all([
      client.query('SELECT COUNT(*) AS c FROM users'),
      client.query('SELECT COALESCE(SUM(amount), 0) AS s FROM earnings'),
      client.query('SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE status = $1', ['paid']),
      client.query('SELECT COUNT(*) AS c FROM withdrawals WHERE status = $1', ['pending']),
      client.query("SELECT COUNT(*) AS c FROM user_tasks WHERE status = 'pending'")
    ]);

    await ctx.replyWithHTML(
      `📈 <b>الإحصائيات</b>\n\n` +
      `👥 عدد المستخدمين: <b>${users.rows[0].c}</b>\n` +
      `💰 الأرباح الموزعة: <b>${Number(earnings.rows[0].s).toFixed(2)}$</b>\n` +
      `📤 المدفوعات: <b>${Number(paid.rows[0].s).toFixed(2)}$</b>\n` +
      `⏳ طلبات معلقة: <b>${pending.rows[0].c}</b>\n` +
      `📝 إثباتات مهمات المستخدمين: <b>${proofs.rows[0].c}</b>`
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
  ['📝 مهمات TasksRewardBot', '🎬 فيديوهاتي'],
  ['🔗 قيم البوت من هنا'],
  ['📩 تواصل معنا على فيسبوك']
]).resize()
  );
});

// 🎬 فيديوهاتي
bot.hears('🎬 فيديوهاتي', async (ctx) => {
  const userId = ctx.from.id;
  const url = `https://perceptive-victory-production.up.railway.app/my-videos.html?user_id=${userId}`;
  await ctx.reply('🎬 اضغط على الزر لعرض وإدارة فيديوهاتك:', 
    Markup.inlineKeyboard([
      [Markup.button.webApp('فيديوهاتي', url)]
    ])
  );
});

bot.command('pay', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /pay <ID>');

  try {
    const res = await client.query(
      'UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *',
      ['paid', id]
    );
    
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');

    const withdrawal = res.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;

    // إرسال إشعار للمستخدم
    try {
      await bot.telegram.sendMessage(
        userId,
        `✅ تم الموافقة على طلب السحب الخاص بك.\n💰 المبلغ: ${amount}$\n💳 المحفظة: ${wallet}\n⏳ تم تنفيذ السحب بنجاح.`
      );
    } catch (e) {
      console.error('❌ خطأ عند إرسال رسالة للمستخدم:', e);
    }

    await ctx.reply(`✅ تم تعليم الطلب #${id} كمدفوع وتم إعلام المستخدم.`);

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
    const res = await client.query(
      'UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *',
      ['rejected', id]
    );

    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');

    const withdrawal = res.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;

    // إرسال إشعار للمستخدم
    try {
      await bot.telegram.sendMessage(
        userId,
        `❌ تم رفض طلب السحب الخاص بك.\n💰 المبلغ: ${amount}$\n💳 المحفظة: ${wallet}\n🔹 يمكنك تعديل طلبك أو المحاولة لاحقاً.`
      );
    } catch (e) {
      console.error('❌ خطأ عند إرسال رسالة للمستخدم:', e);
    }

    await ctx.reply(`⛔ تم رفض الطلب #${id} وتم إعلام المستخدم.`);

  } catch (e) {
    console.error('❌ reject:', e);
    await ctx.reply('فشل تحديث الحالة.');
  }
});


// ==================== التشغيل النهائي ====================
(async () => {
  try {
    await bot.launch();
    console.log('✅ bot.js: البوت شُغّل بنجاح');

    // الإيقاف الآمن
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


// ====== SERVER SECTION (from server.js) ======
require('dotenv').config();
const express = require('express');
const crypto = require('crypto'); 
const path = require('path'); 
const fs = require('fs');
const { client } = require('./db'); // استخدام العميل المشترك

// التقاط أي أخطاء لاحقة في العميل
client.on('error', (err) => {
  console.error('⚠️ PG client error:', err);
  // لا نحاول إعادة الاتصال بنفس العميل
});

// === السيرفر (Express)

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


// ✅ هذا هو المسار الصحيح لإضافة كروم
app.get('/worker/start', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/worker/start.html'));
});

// ===========================================
// ✅ مسار التحقق من العامل (Worker Verification)
// ===========================================
app.all("/api/worker/verification/", (req, res) => {
  // دعم GET و POST مع رد ثابت يطمئن الإضافة
  res.status(200).json({
    ok: true,
    status: "verified",
    method: req.method,
    server_time: new Date().toISOString()
  });
});

app.get('/api/user/profile', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({
      status: "error",
      message: "user_id is required"
    });
  }

  try {
    const result = await client.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      return res.json({
        status: "success",
        data: {
          user_id: user.telegram_id.toString(),
          fullname: `User ${user.telegram_id}`,
          balance: parseFloat(user.balance),
          membership: "Free"
        }
      });
    } else {
      // إنشاء مستخدم جديد برصيد 0
      await client.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, 0]
      );

      return res.json({
        status: "success",
        data: {  // ← ✅ تم إضافة "data:" هنا
          user_id: user_id.toString(),
          fullname: `User ${user_id}`,
          balance: 0.0,
          membership: "Free"
        }
      });
    }
  } catch (err) {
    console.error('Error in /api/user/profile:', err);
    return res.status(500).json({
      status: "error",
      message: "Server error"
    });
  }
});

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! Postback جاهز.');
});
app.post('/api/add-video', async (req, res) => {
  const { user_id, title, video_url, duration_seconds, keywords } = req.body;
  if (!user_id || !title || !video_url || !duration_seconds) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  const duration = parseInt(duration_seconds, 10);
  if (isNaN(duration) || duration < 50) {
    return res.status(400).json({ error: 'المدة يجب أن تكون 50 ثانية على الأقل' });
  }

  // تكلفة نشر الفيديو
  const cost = duration * 0.00002;

  try {
    // تحقق عدد فيديوهات المستخدم (حد أقصى 4)
    const countRes = await client.query('SELECT COUNT(*) AS cnt FROM user_videos WHERE user_id = $1', [user_id]);
    const existingCount = parseInt(countRes.rows[0].cnt, 10);
    if (existingCount >= 4) {
      return res.status(400).json({ error: 'وصلت للحد الأقصى (4) من الفيديوهات. احذف فيديوًا قبل إضافة آخر.' });
    }

    // جلب رصيد المستخدم
    const user = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0) {
      return res.status(400).json({ error: 'المستخدم غير موجود' });
    }

    if (parseFloat(user.rows[0].balance) < cost) {
      return res.status(400).json({ error: 'رصيدك غير كافٍ' });
    }

    // نحول keywords إلى JSON string للتخزين (نتأكد أنها مصفوفة أو نستخدم [])
    const keywordsArray = Array.isArray(keywords) ? keywords : [];
    const keywordsJson = JSON.stringify(keywordsArray);

    await client.query('BEGIN');
    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [cost, user_id]);
    await client.query(
      'INSERT INTO user_videos (user_id, title, video_url, duration_seconds, keywords) VALUES ($1, $2, $3, $4, $5)',
      [user_id, title, video_url, duration, keywordsJson]
    );
    await client.query('COMMIT');

    return res.json({ success: true, cost });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error in /api/add-video:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ✅ جلب فيديوهات المستخدم
app.get('/api/my-videos', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id مطلوب' });
  }

  try {
    const result = await client.query(`
      SELECT id, title, video_url, duration_seconds, views_count, created_at,
             COALESCE(keywords, '[]'::jsonb) AS keywords
      FROM user_videos
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [user_id]);

    const videos = result.rows.map(v => ({
      id: v.id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count,
      created_at: v.created_at,
      keywords: Array.isArray(v.keywords) ? v.keywords : []   // نتأكد إنها Array
    }));

    return res.json(videos);
  } catch (err) {
    console.error('Error in /api/my-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/delete-video', async (req, res) => {
  const { user_id, video_id } = req.body;
  if (!user_id || !video_id) return res.status(400).json({ error: 'user_id و video_id مطلوبان' });

  try {
    const result = await client.query(
      'DELETE FROM user_videos WHERE id = $1 AND user_id = $2',
      [video_id, user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود أو لا تملك صلاحية الحذف' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/delete-video:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/public-videos', async (req, res) => {
  try {
    const videos = await client.query(`
      SELECT uv.id, uv.title, uv.video_url, uv.duration_seconds, uv.user_id, uv.keywords,
             u.balance >= (uv.duration_seconds * 0.00002) AS has_enough_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 50
    `);

    const available = videos.rows.filter(v => v.has_enough_balance);

    const mapped = available.map(v => {
  let keywords = [];

  if (v.keywords) {
    try {
      // تأكد أن القيمة نصية قبل التحليل
      if (typeof v.keywords === 'string') {
        keywords = JSON.parse(v.keywords);
      } else if (Array.isArray(v.keywords)) {
        keywords = v.keywords;
      }
    } catch (parseErr) {
      console.warn(`⚠️ keywords غير صالحة للفيديو ID ${v.id}:`, v.keywords);
      keywords = []; // أو استخدم [v.video_url] كخيار احتياطي
    }
  }

  return {
    id: v.id,
    title: v.title,
    video_url: v.video_url,
    duration_seconds: v.duration_seconds,
    user_id: v.user_id,
    keywords: keywords.length > 0 ? keywords : [v.video_url?.split('v=')[1] || '']
  };
});

    return res.json(mapped);
  } catch (err) {
    console.error('Error in /api/public-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


/* ============================================================
   Existing callbacks and other endpoints (kept & slightly improved)
   ============================================================ */

app.get('/callback', async (req, res) => {
  const { user_id, amount, transaction_id, secret, network } = req.query;

  // ✅ التحقق من السر
  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden: Invalid Secret');
  }

  // ✅ التحقق من وجود transaction_id
  if (!transaction_id) {
    return res.status(400).send('Missing transaction_id');
  }

  // ✅ التحقق من المبلغ
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).send('Invalid amount');
  }

  // نسبة العمولة (60%)
  const percentage = 0.60; 
  const finalAmount = parsedAmount * percentage;

  // ✅ تحديد الشبكة (bitcotasks أو offer)
  const source = network === 'bitcotasks' ? 'bitcotasks' : 'offer';

  try {
    await client.query('BEGIN');

    // ✅ التحقق من عدم تكرار العملية
    const existing = await client.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return res.status(200).send('Duplicate transaction ignored');
    }

    // ✅ تأكد أن المستخدم موجود أو أضفه
    const userCheck = await client.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      // لو المستخدم مش موجود → إنشاؤه برصيد أولي
      await client.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, finalAmount]
      );
    } else {
      // لو موجود → تحديث رصيده
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [finalAmount, user_id]
      );
    }

    // ✅ إضافة سجل الأرباح
    await client.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at) 
       VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );

    console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${parsedAmount}$) للمستخدم ${user_id} (Transaction: ${transaction_id})`);

    // ✅ التحقق من وجود محيل
    const ref = await client.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1',
      [user_id]
    );

    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03; // 3% للمحيل

      // تحديث رصيد المحيل
      const refCheck = await client.query(
        'SELECT balance FROM users WHERE telegram_id = $1',
        [referrerId]
      );

      if (refCheck.rows.length === 0) {
        // لو المحيل مش موجود → إنشاؤه برصيد أولي
        await client.query(
          'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
          [referrerId, bonus]
        );
      } else {
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [bonus, referrerId]
        );
      }

      // إضافة سجل أرباح للمحيل
      await client.query(
        `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at) 
         VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
        [referrerId, 'referral', bonus, `Referral bonus from ${user_id} (Transaction: ${transaction_id})`]
      );

      console.log(`👥 تم إضافة ${bonus}$ (3%) للمحيل ${referrerId} من ربح المستخدم ${user_id}`);
    }

    await client.query('COMMIT');
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});


// === Unity Ads S2S Callback (كما كان، مع بعض الحماية البسيطة)
app.get('/unity-callback', async (req, res) => {
  try {
    const params = { ...req.query };
    const hmac = params.hmac;
    if (!hmac) return res.status(400).send('Missing hmac');

    const secret = process.env.UNITYADS_SECRET || '';
    if (!secret) {
      console.error('UNITYADS_SECRET not set');
      return res.status(500).send('Server not configured');
    }

    const paramsToSign = { ...params };
    delete paramsToSign.hmac;
    const keys = Object.keys(paramsToSign).sort();
    const paramString = keys.map(k => `${k}=${paramsToSign[k] === null ? '' : paramsToSign[k]}`).join(',');

    const computed = crypto.createHmac('md5', secret).update(paramString).digest('hex');

    if (computed !== hmac) {
      console.warn('Unity callback signature mismatch', { paramString, computed, hmac });
      return res.sendStatus(403);
    }

    const sid = params.sid;
    const oid = params.oid;
    const productid = params.productid || params.product || params.placement || null;

    if (!sid || !oid) {
      return res.status(400).send('Missing sid or oid');
    }

    const reward = 0.0005;

    const dup = await client.query('SELECT 1 FROM earnings WHERE source=$1 AND description=$2 LIMIT 1', ['unity', `oid:${oid}`]);
    if (dup.rows.length > 0) {
      console.log('🔁 Unity callback duplicate oid ignored', oid);
      return res.status(200).send('Duplicate order ignored');
    }

    await client.query('BEGIN');

    const uRes = await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [sid]);
    if (uRes.rowCount === 0) {
      await client.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [sid, 0]);
    }

    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [reward, sid]);
    await client.query('INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1,$2,$3,$4,NOW())',
                      [sid, 'unity', reward, `oid:${oid}`]);

    await client.query('COMMIT');

    console.log(`🎬 Unity S2S: credited ${reward}$ to ${sid} (oid=${oid})`);
    res.status(200).send('1');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error on /unity-callback', err);
    res.status(500).send('Server Error');
  }
});

app.get('/video-callback', async (req, res) => {
    let { user_id, video_id, watched_seconds, secret } = req.query;

    if (!user_id || !video_id) {
        return res.status(400).send('Missing user_id or video_id');
    }

    try {
        // التحقق من السر
        if (secret !== process.env.CALLBACK_SECRET) {
            return res.status(403).send('Forbidden: Invalid Secret');
        }

        // جلب بيانات الفيديو
        const videoRes = await client.query(
            'SELECT user_id AS owner_id, duration_seconds FROM user_videos WHERE id = $1',
            [video_id]
        );

        if (videoRes.rows.length === 0) {
            return res.status(400).send('الفيديو غير موجود');
        }

        const { owner_id, duration_seconds } = videoRes.rows[0];

        const reward = duration_seconds * 0.00001;
        const cost = duration_seconds * 0.00002;

        await client.query('BEGIN');

        // تحقق من رصيد صاحب الفيديو
        const ownerBalanceRes = await client.query(
            'SELECT balance FROM users WHERE telegram_id = $1',
            [owner_id]
        );

        if (
            ownerBalanceRes.rows.length === 0 ||
            parseFloat(ownerBalanceRes.rows[0].balance) < cost
        ) {
            await client.query('ROLLBACK');
            return res.status(400).send('رصيد صاحب الفيديو غير كافٍ');
        }

        // خصم تكلفة المشاهدة من صاحب الفيديو
        await client.query(
            'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
            [cost, owner_id]
        );

        // تأكد إذا المشاهد موجود أو أضفه
        const viewerExists = await client.query(
            'SELECT 1 FROM users WHERE telegram_id = $1',
            [user_id]
        );

        if (viewerExists.rows.length === 0) {
            await client.query(
                'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
                [user_id, 0]
            );
        }

        // إضافة المكافأة للمشاهد
        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
            [reward, user_id]
        );

        // إضافة سجل للأرباح
        await client.query(
            `INSERT INTO earnings 
            (user_id, source, amount, description, watched_seconds, video_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
                user_id,
                'user_video',
                reward,
                `user_video:${video_id}`,
                watched_seconds ? parseInt(watched_seconds) : null,
                video_id
            ]
        );

        // تحديث عداد المشاهدات للفيديو
        await client.query(
            'UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1',
            [video_id]
        );

        await client.query('COMMIT');

        console.log(
            `✅ فيديو ${video_id}: ${reward}$ للمشاهد ${user_id} — watched_seconds=${watched_seconds}`
        );

        return res.status(200).send('Success');
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (_) {}
        console.error('Error in /video-callback:', err);
        return res.status(500).send('Server Error');
    }
});

// ✅ /api/auth — يتحقق فقط من وجود المستخدم بدون إنشائه
app.get('/api/auth', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id مطلوب' });
    }

    // 🔎 تحقق من وجود المستخدم
    const result = await client.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (result.rows.length === 0) {
      // ❌ المستخدم غير موجود
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const user = result.rows[0];

    // ✅ المستخدم موجود → أعد بياناته للامتداد
    const response = {
      fullname: `User ${user.telegram_id}`,
      uniqueID: user.telegram_id.toString(),
      coins: parseFloat(user.balance),
      balance: parseFloat(user.balance),
      membership: 'Free'
    };

    return res.json(response);
  } catch (err) {
    console.error('Error in /api/auth:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ============================
   🔹 /api/check — فحص حالة المستخدم
============================ */
app.get('/api/check', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    const userRes = await client.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);

    if (userRes.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
      return res.json({ success: true, message: 'تم إنشاء المستخدم الجديد', balance: 0 });
    }

    const user = userRes.rows[0];
    res.json({
      success: true,
      user_id,
      balance: parseFloat(user.balance || 0),
      message: 'المستخدم موجود وجاهز'
    });
  } catch (err) {
    console.error('❌ /api/check:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});


/* ============================
   🔹 /api/worker — جلب فيديوهات للمشاهدة
============================ */
app.post('/api/worker/start', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    // 🧩 تأكد من وجود المستخدم (العامل)
    const userCheck = await client.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }

    // 🎥 جلب الفيديوهات المتاحة من المعلنين فقط (ليست للعامل نفسه)
    const videosRes = await client.query(`
      SELECT 
        uv.id,
        uv.user_id,
        uv.title,
        uv.video_url,
        uv.duration_seconds,
        uv.views_count,
        uv.keywords,
        uv.viewing_method,
        uv.like,
        uv.subscribe,
        uv.comment,
        uv.comment_like,
        uv.filtering,
        uv.daily_budget,
        uv.total_budget,
        u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.user_id != $1
        AND u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 20;
    `, [user_id]);

    // 🧠 تنسيق النتائج المرسلة للعامل
    const videos = videosRes.rows.map(v => ({
      id: v.id,
      user_id: v.user_id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count || 0,
      keywords: (() => {
        try {
          return Array.isArray(v.keywords) ? v.keywords : JSON.parse(v.keywords || '[]');
        } catch {
          return [];
        }
      })(),
      viewing_method: v.viewing_method || 'keyword',
      like: v.like || 'no',
      subscribe: v.subscribe || 'no',
      comment: v.comment || 'no',
      comment_like: v.comment_like || 'no',
      filtering: v.filtering || 'no',
      daily_budget: v.daily_budget || 0,
      total_budget: v.total_budget || 0,

      // 💰 المكافأة للعامل تُحسب بناءً على مدة الفيديو
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),

      // 💸 تكلفة المعلن
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));

    // 🚀 إرسال النتيجة
    return res.json({
      success: true,
      videos,
      count: videos.length
    });

  } catch (err) {
    console.error('❌ خطأ في /api/worker:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

app.post('/api/worker', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    // 🧩 تأكد من وجود المستخدم (العامل)
    const userCheck = await client.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }

    // 🎥 جلب الفيديوهات المتاحة من المعلنين فقط (ليست للعامل نفسه)
    const videosRes = await client.query(`
      SELECT 
        uv.id,
        uv.user_id,
        uv.title,
        uv.video_url,
        uv.duration_seconds,
        uv.views_count,
        uv.keywords,
        uv.viewing_method,
        uv.like,
        uv.subscribe,
        uv.comment,
        uv.comment_like,
        uv.filtering,
        uv.daily_budget,
        uv.total_budget,
        u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.user_id != $1
        AND u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 20;
    `, [user_id]);

    // 🧠 تنسيق النتائج المرسلة للعامل
    const videos = videosRes.rows.map(v => ({
      id: v.id,
      user_id: v.user_id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count || 0,
      keywords: (() => {
        try {
          return Array.isArray(v.keywords) ? v.keywords : JSON.parse(v.keywords || '[]');
        } catch {
          return [];
        }
      })(),
      viewing_method: v.viewing_method || 'keyword',
      like: v.like || 'no',
      subscribe: v.subscribe || 'no',
      comment: v.comment || 'no',
      comment_like: v.comment_like || 'no',
      filtering: v.filtering || 'no',
      daily_budget: v.daily_budget || 0,
      total_budget: v.total_budget || 0,

      // 💰 المكافأة للعامل تُحسب بناءً على مدة الفيديو
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),

      // 💸 تكلفة المعلن
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));

    // 🚀 إرسال النتيجة
    return res.json({
      success: true,
      videos,
      count: videos.length
    });

  } catch (err) {
    console.error('❌ خطأ في /api/worker:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

/* ============================
   🔹 /api/report — تسجيل مشاهدة وتحديث الرصيد
============================ */
app.post('/api/report', async (req, res) => {
  try {
    const { user_id, video_id, watched_seconds } = req.body;
    if (!user_id || !video_id || !watched_seconds)
      return res.status(400).json({ error: 'user_id, video_id, watched_seconds مطلوبة' });

    const videoRes = await client.query(`
      SELECT uv.*, u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.id = $1
    `, [video_id]);

    if (videoRes.rows.length === 0)
      return res.status(404).json({ error: 'الفيديو غير موجود' });

    const video = videoRes.rows[0];
    const owner_id = video.user_id;
    const duration = Math.min(video.duration_seconds, watched_seconds);

    const advertiserCost = duration * 0.00002;
    const workerReward = duration * 0.00001;

    if (parseFloat(video.owner_balance) < advertiserCost)
      return res.status(400).json({ error: 'رصيد المعلن غير كافٍ لدفع تكلفة المشاهدة' });

    await client.query('BEGIN');

    await client.query(`UPDATE users SET balance = balance - $1 WHERE telegram_id = $2`, [advertiserCost, owner_id]);
    await client.query(`UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`, [workerReward, user_id]);
    await client.query(`UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1`, [video_id]);

    await client.query(`
      INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [user_id, 'watch', workerReward, 'Watching video', duration, video_id]);

    await client.query('COMMIT');

    res.json({
      success: true,
      duration,
      advertiserCost,
      workerReward,
      message: 'تم تسجيل المشاهدة وتحديث الأرصدة بنجاح'
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ /api/report:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});


/* ============================
   🔹 /api/lang/full — ترجمة واجهة الإضافة
============================ */
app.get('/api/lang/full', async (req, res) => {
  try {
    const translations = {
      start_button: "ابدأ المشاهدة",
      stop_button: "إيقاف",
      balance_label: "رصيدك",
      coins_label: "العملات",
      membership_label: "العضوية",
      loading_text: "جارٍ تحميل المهام...",
      error_text: "حدث خطأ أثناء الاتصال بالخادم"
    };

    const payload = {
      lang: translations,
      server_time: new Date().toISOString()
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    res.json({ langData: encoded });

  } catch (err) {
    console.error('❌ /api/lang/full:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


/* ============================
   🔹 /api/notify — إشعار بسيط للعميل
============================ */
app.get('/api/notify', (req, res) => {
  res.json({
    success: true,
    message: "📢 لا توجد إشعارات جديدة حاليًا. استمر في المشاهدة لزيادة أرباحك!",
    timestamp: new Date().toISOString()
  });
});

/* ============================================
   🔹 /worker/ — فحص جاهزية العامل (GET)
   يستخدمه المتصفح أو الإضافة للتحقق من أن السيرفر يعمل
   ============================================ */
app.get('/worker/', (req, res) => {
  res.status(200).json({
    ok: true,
    status: 'ready',
    message: 'Worker endpoint is active and ready 🚀',
    server_time: new Date().toISOString()
  });
});


// === بدء التشغيل ===
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});


// ====== Start Both Services ======
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    console.log('🚀 Starting TasksRewardBot combined server...');
    app.listen(PORT, () => console.log(`✅ Express server running on port ${PORT}`));
    if (typeof bot !== 'undefined') {
      await bot.launch();
      console.log('🤖 Telegram bot launched successfully!');
    } else {
      console.warn('⚠️ bot object not found - check Telegraf initialization');
    }
  } catch (err) {
    console.error('❌ Failed to start combined bot/server:', err);
  }
})();
