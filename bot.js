const { Telegraf, session, Markup } = require('telegraf');
require('dotenv').config();
const { pool } = require('./db');
// ========================
// 📌 نظام اللغات المتعدد (عربي / إنجليزي)
// ========================
const userLang = {};
const LANGS = ["ar", "en"];
function autoDetectLang(ctx) {
  const sys = ctx.from?.language_code?.split("-")[0] || "ar";
  return LANGS.includes(sys) ? sys : "ar";
}
function setLang(ctx, lang) {
  userLang[ctx.from.id] = lang;
}
function getLang(ctx) {
  return userLang[ctx.from.id] || autoDetectLang(ctx);
}
const t = (lang, key, vars = {}) => {
  const messages = {
    ar: {
      welcome: "👋 أهلاً بك، <b>{name}</b>!\n💰 <b>رصيدك:</b> {balance}$",
      choose_lang: "🌐 اختر لغتك:",
      back: "⬅️ رجوع",
      your_balance: "💰 رصيدك",
      earn_sources: "🎁 مصادر الربح",
      withdraw: "📤 طلب سحب",
      referral: "👥 ريفيرال",
      tasks: "📝 مهمات TasksRewardBot",
      rate: "🔗 قيم البوت من هنا",
      facebook: "📩 تواصل معنا على فيسبوك",
      language: "🌐 اللغة",
      videos: "🎬 فيديوهاتي",
      english: "🌐 English",
      arabic: "🌐 العربية",
      lang_changed_ar: "✅ تم تغيير اللغة إلى العربية.",
      lang_changed_en: "✅ Language changed to English.",
      referral_message: `👥 <b>برنامج الإحالة</b>
هذا رابطك الخاص، شاركه مع أصدقائك واربح من نشاطهم:
🔗 <code>{refLink}</code>
💡 <b>كيف تُحتسب أرباح الإحالة؟</b>
تحصل على <b>5%</b> من أرباح كل مستخدم ينضم من طرفك.
📊 <b>إحصاءاتك</b>
- عدد الإحالات: <b>{refsCount}</b>`,
      earn_sources_instructions: `📌 <b>طريقة العمل:</b>
1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.
2️⃣ اختر 🕒 <b>TimeWall</b>.
3️⃣ اربط حسابك عبر الرابط الظاهر.
4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).
🔑 <b>طريقة سحب المال من TimeWall:</b>
- ادخل صفحة Withdraw
- اضغط على زر "سحب" أعلى الصفحة
✅ الأرباح تضاف لحسابك مباشرة 💵
💰 <b>السحب من البوت:</b>
- الحد الأدنى: 1.00$
- اختر 📤 <b>طلب سحب</b>
- أدخل محفظة <b>بعملة Litecoin (LTC)</b>
- بعد مراجعة الأدمن يتم الدفع ✅`,
      no_tasks: "❌ لا توجد مهمات متاحة حالياً.",
      min_withdraw_error: "❌ الحد الأدنى للسحب هو {min}$. رصيدك: {balance}$",
      request_wallet: `⚡ لإستلام أرباحك:
الرجاء إدخال عنوان محفظتك الخاص بعملة Litecoin (LTC)، سواء كنت تستخدم FaucetPay أو Binance.
مثال على العنوان:
1CidQZM4kL1yCcS*****9nYtMtEJ2TDQ
تنبيه مهم:
تأكد من نسخ العنوان بالكامل وصحيح 100%، أي خطأ قد يؤدي إلى فقدان الأموال.`,
      invalid_ltc: "❌ عنوان محفظة Litecoin غير صالح. يجب أن يبدأ بـ L أو M أو ltc1 ويكون بطول صحيح.",
      withdrawal_submitted: "✅ تم تقديم طلب سحب بقيمة {amount}$. رصيدك المتبقي: {remaining}$",
      videos_message: "🎬 اضغط على الزر لعرض وإدارة فيديوهاتك:",
      rate_message: "🌟 لو سمحت قيّم البوت من هنا:\n👉 https://toptelegrambots.com/list/TasksRewardBot",
      facebook_message: "📩 للتواصل معنا زور صفحتنا على فيسبوك:\n👉 https://www.facebook.com/profile.php?id=61581071731231",
      internal_error: "حدث خطأ داخلي."
    },
    en: {
      welcome: "👋 Welcome, <b>{name}</b>!\n💰 <b>Your balance:</b> {balance}$",
      choose_lang: "🌐 Choose your language:",
      back: "⬅️ Back",
      your_balance: "💰 Your Balance",
      earn_sources: "🎁 Earn Sources",
      withdraw: "📤 Withdraw",
      referral: "👥 Referrals",
      tasks: "📝 Tasks",
      rate: "🔗 Rate the Bot",
      facebook: "📩 Contact Us on Facebook",
      language: "🌐 Language",
      videos: "🎬 My Videos",
      english: "🌐 English",
      arabic: "🌐 Arabic",
      lang_changed_ar: "✅ Language changed to Arabic.",
      lang_changed_en: "✅ Language changed to English.",
      referral_message: `👥 <b>Referral Program</b>
Your personal link — share it and earn from your friends' activity:
🔗 <code>{refLink}</code>
💡 <b>How referral earnings work?</b>
You get <b>5%</b> of all earnings from users who join via your link.
📊 <b>Your Stats</b>
- Referrals: <b>{refsCount}</b>`,
      earn_sources_instructions: `📌 <b>How it works:</b>
1️⃣ Tap 🎁 <b>Earn Sources</b> in the menu.
2️⃣ Choose 🕒 <b>TimeWall</b>.
3️⃣ Link your account using the shown link.
4️⃣ Complete tasks (watch ads – do simple tasks).
🔑 <b>How to withdraw from TimeWall:</b>
- Go to Withdraw page
- Click the "Withdraw" button at the top
✅ Earnings are added instantly to your account 💵
💰 <b>Withdraw from bot:</b>
- Minimum: 1.00$
- Choose 📤 <b>Withdraw</b>
- Enter your <b>LTC (Litecoin) wallet</b>
- Admin will review and pay you ✅`,
      no_tasks: "❌ No tasks available right now.",
      min_withdraw_error: "❌ Minimum withdrawal is {min}$. Your balance: {balance}$",
      request_wallet: `⚡ To receive your earnings:
Please enter your Litecoin (LTC) wallet address (FaucetPay or Binance).
Example:
1CidQZM4kL1yCcS*****9nYtMtEJ2TDQ
⚠️ Important:
Make sure the address is 100% correct. Any mistake may result in lost funds.`,
      invalid_ltc: "❌ Invalid Litecoin wallet. Must start with L, M, or ltc1 and have correct length.",
      withdrawal_submitted: "✅ Withdrawal request for {amount}$ submitted. Remaining balance: {remaining}$",
      videos_message: "🎬 Tap the button to view/manage your videos:",
      rate_message: "🌟 Please rate the bot here:\n👉 https://toptelegrambots.com/list/TasksRewardBot",
      facebook_message: "📩 Contact us on our Facebook page:\n👉 https://www.facebook.com/profile.php?id=61581071731231",
      internal_error: "An internal error occurred."
    }
  };
  let text = messages[lang][key] || key;
  for (const k in vars) text = text.replace(`{${k}}`, vars[k]);
  return text;
};
// ========================
const userSessions = {}; // تخزين الجلسات المؤقتة لكل مستخدم
// ====== Debug متغيرات البيئة ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);
// ====== إعداد اتصال قاعدة البيانات ======
// ====== دالة الاتصال بقاعدة البيانات ======
// 🟢 التقاط أي أخطاء لاحقة
pool.on('error', (err) => {
  console.error('⚠️ PG client error:', err);
});
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
    const ref = await pool.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [earnerId]);
    if (ref.rows.length === 0) return;
    const referrerId = ref.rows[0].referrer_id;
    if (!referrerId || Number(referrerId) === Number(earnerId)) return;
    const bonus = Number(earnedAmount) * 0.05;
    if (bonus <= 0) return;
    const balRes = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [referrerId]);
    if (balRes.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [referrerId, 0]);
    }
    await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [bonus, referrerId]);
    await pool.query(
      'INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)',
      [referrerId, earnerId, bonus]
    );
    try {
      await pool.query(
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
    await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [amount, targetId]);
    try {
      await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [targetId, amount, 'manual_credit']);
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
  const lang = getLang(ctx);
  try {
    let payload = null;
    if (ctx.startPayload) {
      payload = ctx.startPayload;
    } else if (ctx.message?.text?.includes('/start')) {
      const parts = ctx.message.text.split(' ');
      payload = parts[1] || null;
    }
    let res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = 0;
    if (res.rows.length > 0) {
      balance = parseFloat(res.rows[0].balance) || 0;
    } else {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }
    if (payload && /^ref_\d+$/i.test(payload)) {
      const referrerId = Number(payload.replace(/ref_/i, ''));
      if (referrerId && referrerId !== userId) {
        const exists = await pool.query('SELECT 1 FROM referrals WHERE referee_id = $1', [userId]);
        if (exists.rows.length === 0) {
          await pool.query('INSERT INTO referrals (referrer_id, referee_id) VALUES ($1,$2)', [referrerId, userId]);
          try {
            await bot.telegram.sendMessage(referrerId, `🎉 مستخدم جديد انضم من رابطك: ${userId}`);
          } catch (_) {}
        }
      }
    }
    await ctx.replyWithHTML(
      t(lang, 'welcome', { name: firstName, balance: balance.toFixed(4) }),
      Markup.keyboard([
        [t(lang, 'your_balance'), t(lang, 'earn_sources')],
        [t(lang, 'withdraw'), t(lang, 'referral')],
        [t(lang, 'tasks')],
        [t(lang, 'videos')],
        [t(lang, 'language')],
        [t(lang, 'rate')],
        [t(lang, 'facebook')]
      ]).resize()
    );
    await ctx.replyWithHTML(t(lang, 'earn_sources_instructions'));
  } catch (err) {
    console.error('❌ /start:', err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});
// 💰 رصيدك
bot.hears((text, ctx) => text === t(getLang(ctx), 'your_balance'), async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    await ctx.replyWithHTML(`💰 ${t(getLang(ctx), 'your_balance')}: <b>${balance.toFixed(4)}$</b>`);
  } catch (err) {
    console.error('❌ رصيدك:', err);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});
// 🔵 👥 ريفيرال — عرض رابط الإحالة + شرح
bot.hears((text, ctx) => text === t(getLang(ctx), 'referral'), async (ctx) => {
  const userId = ctx.from.id;
  const botUsername = 'TasksRewardBot'; // اسم البوت
  const lang = getLang(ctx);
  try {
    const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
    const countRes = await pool.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = $1', [userId]);
    const refsCount = Number(countRes.rows[0]?.c || 0);
    await ctx.replyWithHTML(t(lang, 'referral_message', { refLink, refsCount }));
  } catch (e) {
    console.error('❌ ريفيرال:', e);
    await ctx.reply(t(lang, 'internal_error'));
  }
});
// 🎁 مصادر الربح
bot.hears((text, ctx) => text === t(getLang(ctx), 'earn_sources'), async (ctx) => {
  const userId = ctx.from.id;
  const lang = getLang(ctx);
  const timewallUrl = `https://timewall.io/users/login?oid=b328534e6b994827&uid=${userId}`;
  await ctx.reply(
    t(lang, 'earn_sources'),
    Markup.inlineKeyboard([[Markup.button.url(t(lang, 'earn_sources'), timewallUrl)]])
  );
  await ctx.replyWithHTML(t(lang, 'earn_sources_instructions'));
});
// ✅ عرض المهمات (للمستخدمين)
bot.hears((text, ctx) => text === t(getLang(ctx), 'tasks'), async (ctx) => {
  try {
    const userId = ctx.from.id;
    const lang = getLang(ctx);
    const res = await pool.query(
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
      return ctx.reply(t(lang, 'no_tasks'));
    }
    const formatDuration = (secs) => {
      if (!secs) return 'غير محددة';
      if (secs < 60) return `${secs} ثانية`;
      if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
      if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
      return `${Math.floor(secs / 86400)} يوم`;
    };
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
      const duration = Number(t.duration_seconds) || 2592000;
      let msg =
        `📋 المهمة #${t.id}
` +
        `🏷️ العنوان: ${t.title}
` +
        `📖 الوصف: ${t.description}
` +
        `💰 السعر: ${price.toFixed(6)}$
` +
        `⏱️ مدة المهمة: ${formatDuration(duration)}
`;
      const buttons = [];
      const status = t.status;
      if (!status || status === 'rejected') {
        msg += `▶️ اضغط "📌 قدّم الآن" لبدء العد.
`;
        buttons.push([{ text: t(getLang(ctx), 'apply_now') || "📌 قدّم الآن", callback_data: `apply_${t.id}` }]);
      } else if (status === 'applied') {
        if (t.applied_at) {
          const appliedAt = new Date(t.applied_at);
          const deadline = new Date(appliedAt.getTime() + duration * 1000);
          const now = new Date();
          if (now >= deadline) {
            msg += `⏳ انتهت المدة المحددة (${formatDuration(duration)}). الآن يمكنك إرسال الإثبات.`;
            buttons.push([{ text: t(getLang(ctx), 'submit_proof') || "📝 إرسال إثبات", callback_data: `submit_${t.id}` }]);
          } else {
            const remaining = deadline - now;
            msg += `بعد انقضاء المدة المحددة، سيتم تفعيل زر "إرسال الإثبات
نرجو منك مراجعة متطلبات المهمة والتأكد من تنفيذها بالكامل وفق الوصف قبل إرسال الإثبات، حيث أن أي نقص قد يؤدي إلى رفض المهمة.⏳ الوقت المتبقي لإرسال الإثبات: ${formatRemaining(remaining)}.`;
          }
        } else {
          msg += `▶️ اضغط "📌 قدّم الآن" لبدء العد.`;
          buttons.push([{ text: t(getLang(ctx), 'apply_now') || "📌 قدّم الآن", callback_data: `apply_${t.id}` }]);
        }
      } else {
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
    ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});
// ✅ عند الضغط على زر "إرسال إثبات"
bot.action(/^submit_(\d+)$/, async (ctx) => {
  try {
    const taskId = ctx.match[1];
    const userId = ctx.from.id;
    if (!userSessions[userId]) userSessions[userId] = {};
    userSessions[userId].awaiting_task_submission = taskId;
    const lang = getLang(ctx);
    await ctx.reply(`📩 ${t(lang, 'submit_proof') || 'أرسل الآن إثبات إتمام المهمة'} رقم ${taskId}`);
  } catch (err) {
    console.error("❌ submit action error:", err.message, err.stack);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});
// ✅ عند الضغط على زر "قدّم الآن"
bot.action(/^apply_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const taskId = Number(ctx.match[1]);
    const userId = ctx.from.id;
    let durationSeconds = 30 * 24 * 60 * 60;
    try {
      const tRes = await pool.query('SELECT duration_seconds FROM tasks WHERE id = $1', [taskId]);
      if (tRes.rows.length && tRes.rows[0].duration_seconds) {
        durationSeconds = Number(tRes.rows[0].duration_seconds);
      }
    } catch (e) {
      console.error('❌ خطأ جلب duration_seconds:', e);
    }
    await pool.query(
      `INSERT INTO user_tasks (user_id, task_id, status, created_at)
       VALUES ($1, $2, 'applied', NOW())
       ON CONFLICT (user_id, task_id) DO UPDATE
         SET status = 'applied', created_at = NOW()`,
      [userId, taskId]
    );
    const formatDuration = (secs) => {
      if (!secs) return 'غير محددة';
      if (secs < 60) return `${secs} ثانية`;
      if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
      if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
      return `${Math.floor(secs / 86400)} يوم`;
    };
    const lang = getLang(ctx);
    await ctx.reply(
      `📌 ${t(lang, 'apply_now') || 'تم تسجيل تقديمك على المهمة'} رقم ${taskId}.
` +
      `⏱️ ${t(lang, 'task_duration') || 'مدة المهمة'}: ${formatDuration(durationSeconds)}.
` +
      `⏳ ${t(lang, 'after_duration') || 'بعد انتهاء هذه المدة سيظهر لك زر "إرسال إثبات"'}`
    );
  } catch (err) {
    console.error('❌ apply error:', err);
    try { await ctx.answerCbQuery(); } catch(_) {}
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});
// ✅ استقبال الإثبات من المستخدم
bot.on("message", async (ctx, next) => {
  const userId = ctx.from.id;
  if (!userSessions[userId]) userSessions[userId] = {};
  const session = userSessions[userId];
  if (session.awaiting_task_submission) {
    const taskId = Number(session.awaiting_task_submission);
    let proof = ctx.message.text || "";
    if (ctx.message.photo && ctx.message.photo.length) {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      proof = `📷 صورة مرفقة - file_id: ${fileId}`;
    }
    try {
      await pool.query('BEGIN');
      const exists = await pool.query(
        'SELECT status FROM user_tasks WHERE user_id = $1 AND task_id = $2',
        [userId, taskId]
      );
      if (exists.rows.length && ['pending','approved'].includes(exists.rows[0].status)) {
        await pool.query('ROLLBACK');
        session.awaiting_task_submission = null;
        const lang = getLang(ctx);
        await ctx.reply(t(lang, 'proof_already_submitted') || '⚠️ لقد سبق وأن أرسلت إثباتاً لهذه المهمة أو تم اعتمادها بالفعل.');
        return;
      }
      await pool.query(
        "INSERT INTO task_proofs (task_id, user_id, proof, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())",
        [taskId, userId, proof]
      );
      await pool.query(
        `INSERT INTO user_tasks (user_id, task_id, status)
         VALUES ($1, $2, 'pending')
         ON CONFLICT (user_id, task_id) DO UPDATE
           SET status = 'pending', created_at = NOW()`,
        [userId, taskId]
      );
      await pool.query('COMMIT');
      const lang = getLang(ctx);
      await ctx.reply(t(lang, 'proof_submitted') || "✅ تم إرسال الإثبات، وسيتم مراجعته من الإدارة.");
      session.awaiting_task_submission = null;
    } catch (err) {
      try { await pool.query('ROLLBACK'); } catch(_) {}
      console.error("❌ خطأ أثناء حفظ الإثبات:", err);
      await ctx.reply(t(getLang(ctx), 'internal_error'));
    }
    return;
  }
  return next();
});
// 🔗 قيم البوت
bot.hears((text, ctx) => text === t(getLang(ctx), 'rate'), async (ctx) => {
  const lang = getLang(ctx);
  try {
    await ctx.reply(
      t(lang, 'rate_message'),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: lang === 'ar' ? '🔗 افتح صفحة التقييم' : '🔗 Open Rating Page', url: 'https://toptelegrambots.com/list/TasksRewardBot' }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("❌ خطأ في زر التقييم:", err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});
// 📩 تواصل معنا على فيسبوك
bot.hears((text, ctx) => text === t(getLang(ctx), 'facebook'), async (ctx) => {
  const lang = getLang(ctx);
  try {
    await ctx.reply(
      t(lang, 'facebook_message'),
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: lang === 'ar' ? '📩 افتح صفحتنا على فيسبوك' : '📩 Open Facebook Page', url: 'https://www.facebook.com/profile.php?id=61581071731231' }
            ]
          ]
        }
      }
    );
  } catch (err) {
    console.error("❌ خطأ في زر فيسبوك:", err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});
const MIN_WITHDRAW = 1.00;
// 📤 طلب سحب
bot.hears((text, ctx) => text === t(getLang(ctx), 'withdraw'), async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const userId = ctx.from.id;
  const lang = getLang(ctx);
  try {
    const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    if (balance < MIN_WITHDRAW) {
      return ctx.reply(t(lang, 'min_withdraw_error', { min: MIN_WITHDRAW, balance: balance.toFixed(4) }));
    }
    ctx.session.awaiting_withdraw = true;
    await ctx.reply(t(lang, 'request_wallet'));
  } catch (err) {
    console.error('❌ طلب سحب:', err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});
// معالجة نصوص عامة
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim();
  const lang = getLang(ctx);
  // —— طلب السحب ——
  if (ctx.session.awaiting_withdraw) {
    if (!/^([LM][a-km-zA-HJ-NP-Z1-9]{26,33}|ltc1[a-z0-9]{39,59})$/i.test(text)) {
      return ctx.reply(t(lang, 'invalid_ltc'));
    }
    const userId = ctx.from.id;
    try {
      const userRes = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
      let balance = parseFloat(userRes.rows[0]?.balance) || 0;
      if (balance < MIN_WITHDRAW) {
        return ctx.reply(t(lang, 'min_withdraw_error', { min: MIN_WITHDRAW, balance: balance.toFixed(4) }));
      }
      const withdrawAmount = Math.floor(balance * 100) / 100;
      const remaining = balance - withdrawAmount;
      await pool.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)', [userId, withdrawAmount, text.toUpperCase()]);
      await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [remaining, userId]);
      await ctx.reply(t(lang, 'withdrawal_submitted', { amount: withdrawAmount.toFixed(2), remaining: remaining.toFixed(4) }));
      ctx.session.awaiting_withdraw = false;
    } catch (err) {
      console.error('❌ خطأ في معالجة السحب:', err);
      await ctx.reply(t(lang, 'internal_error'));
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
        const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
        if (res.rows.length === 0) {
          ctx.session = {};
          return ctx.reply('❌ المستخدم غير موجود.');
        }
        let balance = parseFloat(res.rows[0].balance) || 0;
        let newBalance = ctx.session.awaitingAction === 'add_balance' ? balance + amount : balance - amount;
        if (newBalance < 0) newBalance = 0;
        await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, userId]);
        if (ctx.session.awaitingAction === 'add_balance' && amount > 0) {
          await applyReferralBonus(userId, amount);
          try { await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [userId, amount, 'admin_adjust']); } catch(_){}
        }
        ctx.reply(`✅ تم ${ctx.session.awaitingAction === 'add_balance' ? 'إضافة' : 'خصم'} ${amount.toFixed(4)}$ للمستخدم ${userId}.
💰 رصيده الجديد: ${newBalance.toFixed(4)}$`);
      } catch (err) {
        console.error('❌ خطأ تحديث الرصيد:', err);
        ctx.reply('❌ فشل تحديث الرصيد.');
      }
      ctx.session = {};
      return;
    }
  }
  // مقارنة ديناميكية (لدعم اللغتين)
  const currentLang = getLang(ctx);
  const isMenuText = [
    t(currentLang, 'your_balance'),
    t(currentLang, 'earn_sources'),
    t(currentLang, 'withdraw'),
    t(currentLang, 'referral'),
    t(currentLang, 'tasks'),
    t(currentLang, 'videos'),
    t(currentLang, 'language'),
    t(currentLang, 'rate'),
    t(currentLang, 'facebook'),
    '📋 عرض الطلبات',
    '📊 الإحصائيات',
    '➕ إضافة رصيد',
    '➖ خصم رصيد',
    '➕ إضافة مهمة جديدة',
    '📝 المهمات',
    '📝 اثباتات مهمات المستخدمين',
    '👥 ريفيرال',
    '🚪 خروج من لوحة الأدمن',
    '🎬 فيديوهاتي'
  ].includes(text);
  if (isMenuText) return next();
  return next();
});
// 🔐 لوحة الأدمن - عرض الطلبات
bot.hears('📋 عرض الطلبات', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('❌ الوصول مرفوض.');
  try {
    const res = await pool.query('SELECT * FROM withdrawals WHERE status = $1 ORDER BY id DESC', ['pending']);
    if (res.rows.length === 0) {
      await ctx.reply('✅ لا توجد طلبات معلقة.');
    } else {
      for (const req of res.rows) {
        await ctx.reply(
          `طلب سحب #${req.id}
` +
          `👤 المستخدم: ${req.user_id}
` +
          `💵 المبلغ: ${Number(req.amount).toFixed(2)}$
` +
          `💳 محفظة Litecoin: ${req.payeer_wallet}
` +
          `لقبول: /pay ${req.id}
لرفض: /reject ${req.id}`
        );
      }
    }
  } catch (err) {
    console.error('❌ خطأ في عرض الطلبات:', err);
    await ctx.reply('حدث خطأ فني.');
  }
});
// ➕ إضافة مهمة جديدة
bot.hears('➕ إضافة مهمة جديدة', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingAction = 'add_task';
  ctx.reply(`📌 أرسل المهمة الجديدة بصيغة: العنوان | الوصف | السعر | المدة (اختياري)
مثال مدة: 3600s أو 60m أو 1h أو 5d
مثال كامل: coinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 30d`);
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
      return ctx.reply('❌ صيغة خاطئة. استخدم: العنوان | الوصف | السعر | المدة (اختياري)
' +
                       'مثال: coinpayu | اجمع رصيد وارفق رابط الموقع https://... | 0.0500 | 30d');
    }
    const title = parts[0];
    let description = '';
    let priceStr = '';
    let durationStr = null;
    if (parts.length === 3) {
      description = parts[1];
      priceStr = parts[2];
    } else {
      durationStr = parts[parts.length - 1];
      priceStr = parts[parts.length - 2];
      description = parts.slice(1, parts.length - 2).join(' | ');
    }
    const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
    }
    let cleanReward = numMatch[0].replace(',', '.');
    const price = parseFloat(cleanReward);
    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010');
    }
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
        default: return Math.round(val);
      }
    };
    const DEFAULT_DURATION_SECONDS = 30 * 24 * 60 * 60;
    let durationSeconds = DEFAULT_DURATION_SECONDS;
    if (durationStr) {
      const parsed = parseDurationToSeconds(durationStr);
      if (parsed === null || parsed <= 0) {
        return ctx.reply('❌ صيغة المدة غير مفهومة. استخدم أمثلة: 3600s أو 60m أو 1h أو 5d');
      }
      durationSeconds = parsed;
    }
    try {
      const res = await pool.query(
        'INSERT INTO tasks (title, description, price, duration_seconds) VALUES ($1,$2,$3,$4) RETURNING id, title, price, duration_seconds',
        [title, description, price, durationSeconds]
      );
      const formatDuration = (secs) => {
        if (!secs) return 'غير محددة';
        if (secs % 86400 === 0) return `${secs / 86400} يوم`;
        if (secs % 3600 === 0) return `${secs / 3600} ساعة`;
        if (secs % 60 === 0) return `${secs / 60} دقيقة`;
        return `${secs} ثانية`;
      };
      const formattedDescription = description.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1">$1</a>');
      await ctx.replyWithHTML(
        `✅ تم إضافة المهمة بنجاح.
📌 <b>العنوان:</b> ${res.rows[0].title}
` +
        `📝 <b>الوصف:</b> ${formattedDescription}
` +
        `💰 <b>السعر:</b> ${parseFloat(res.rows[0].price).toFixed(4)}
` +
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
// 📝 عرض كل المهمات (للأدمن)
bot.hears('📝 المهمات', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await pool.query('SELECT id, title, description, price, duration_seconds FROM tasks ORDER BY id DESC');
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
      const text = `📋 المهمة #${t.id}
` +
                   `🏷️ العنوان: ${t.title}
` +
                   `📖 الوصف: ${t.description}
` +
                   `💰 السعر: ${price.toFixed(4)}$
` +
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
    return ctx.reply('⚠️ الصيغة غير صحيحة. استخدم: العنوان | الوصف | السعر | المدة (اختياري)
مثال:
coinpayu | سجل عبر الرابط https://... | 0.0500 | 10d');
  }
  const title = parts[0];
  let description = '';
  let priceStr = '';
  let durationStr = null;
  if (parts.length === 3) {
    description = parts[1];
    priceStr = parts[2];
  } else {
    durationStr = parts[parts.length - 1];
    priceStr = parts[parts.length - 2];
    description = parts.slice(1, parts.length - 2).join(' | ');
  }
  const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
  if (!numMatch) {
    return ctx.reply('❌ السعر غير صالح. استخدم مثلاً: 0.0500');
  }
  const price = parseFloat(numMatch[0].replace(',', '.'));
  if (isNaN(price) || price <= 0) {
    return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
  }
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
      default: return Math.round(val);
    }
  };
  const DEFAULT_DURATION_SECONDS = 30 * 24 * 60 * 60;
  let durationSeconds = null;
  if (durationStr) {
    const parsed = parseDurationToSeconds(durationStr);
    if (parsed === null || parsed <= 0) {
      return ctx.reply('❌ صيغة المدة غير مفهومة. أمثلة: 3600s أو 60m أو 1h أو 5d');
    }
    durationSeconds = parsed;
  } else {
    try {
      const cur = await pool.query('SELECT duration_seconds FROM tasks WHERE id=$1', [taskId]);
      durationSeconds = (cur.rows[0] && cur.rows[0].duration_seconds) ? cur.rows[0].duration_seconds : DEFAULT_DURATION_SECONDS;
    } catch (e) {
      durationSeconds = DEFAULT_DURATION_SECONDS;
    }
  }
  const formatDuration = (secs) => {
    if (!secs) return 'غير محددة';
    if (secs < 60) return `${secs} ثانية`;
    if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
    if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
    return `${Math.floor(secs / 86400)} يوم`;
  };
  try {
    await pool.query(
      'UPDATE tasks SET title=$1, description=$2, price=$3, duration_seconds=$4 WHERE id=$5',
      [title, description, price, durationSeconds, taskId]
    );
    ctx.session.awaitingEdit = null;
    await ctx.reply(`✅ تم تعديل المهمة #${taskId} بنجاح.
📌 العنوان: ${title}
💰 السعر: ${price.toFixed(4)}$
⏱️ المدة: ${formatDuration(durationSeconds)}`, { disable_web_page_preview: true });
  } catch (err) {
    console.error('❌ تعديل المهمة:', err);
    await ctx.reply('حدث خطأ أثناء تعديل المهمة.');
  }
  return;
});
// ✏️ زر تعديل المهمة
bot.action(/^edit_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ غير مسموح');
    return;
  }
  const taskId = ctx.match[1];
  ctx.session.awaitingEdit = taskId;
  await ctx.answerCbQuery();
  await ctx.reply(
    `✏️ أرسل المهمة الجديدة لـ #${taskId} بصيغة:
` +
    `العنوان | الوصف | السعر | المدة
` +
    `👉 المدة اكتبها بالدقائق أو الساعات أو الأيام.
` +
    `مثال:
coinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 3 أيام`
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
        '❌ صيغة خاطئة.
' +
        'استخدم: العنوان | الوصف | السعر | المدة
' +
        'مثال: coinpayu | اجمع رصيد | 0.0500 | 2 ساعات'
      );
    }
    const title = parts[0];
    const description = parts[1];
    const rewardStr = parts[2];
    const durationStr = parts[3];
    const numMatch = rewardStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010 أو 0.0500');
    }
    let cleanReward = numMatch[0].replace(',', '.');
    const price = parseFloat(cleanReward);
    if (isNaN(price) || price <= 0) {
      return ctx.reply('❌ السعر غير صالح. مثال صحيح: 0.0010');
    }
    let durationSeconds = 0;
    const num = parseInt(durationStr.match(/\d+/)?.[0] || "0");
    if (/يوم/.test(durationStr)) {
      durationSeconds = num * 86400;
    } else if (/ساعة/.test(durationStr)) {
      durationSeconds = num * 3600;
    } else if (/دقيقة/.test(durationStr)) {
      durationSeconds = num * 60;
    } else {
      durationSeconds = num;
    }
    if (durationSeconds <= 0) {
      return ctx.reply('❌ المدة غير صالحة. مثال: 3 أيام أو 5 ساعات أو 120 دقيقة.');
    }
    try {
      await pool.query(
        'UPDATE tasks SET title=$1, description=$2, price=$3, duration_seconds=$4 WHERE id=$5',
        [title, description, price, durationSeconds, ctx.session.awaitingEdit]
      );
      await ctx.replyWithHTML(
        `✅ تم تعديل المهمة #${ctx.session.awaitingEdit} بنجاح.
` +
        `🏷️ <b>العنوان:</b> ${title}
` +
        `📖 <b>الوصف:</b> ${description}
` +
        `💰 <b>السعر:</b> ${price.toFixed(4)}
` +
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
    await pool.query('DELETE FROM tasks WHERE id = $1', [taskId]);
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
    return ctx.reply('⚠️ الصيغة غير صحيحة. مثال:
coinpayu | سجل عبر الرابط https://... | 0.0500');
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
    await pool.query('UPDATE tasks SET title=$1, description=$2, price=$3 WHERE id=$4', [title, description, price, taskId]);
    ctx.session.awaitingEdit = null;
    await ctx.reply(`✅ تم تعديل المهمة #${taskId} بنجاح.
📌 العنوان: ${title}
💰 السعر: ${price.toFixed(4)}$`, { disable_web_page_preview: true });
  } catch (err) {
    console.error('❌ تعديل المهمة:', err);
    await ctx.reply('حدث خطأ أثناء تعديل المهمة.');
  }
});
// =================== إثباتات مهمات المستخدمين (للأدمن) ===================
bot.hears('📝 اثباتات مهمات المستخدمين', async (ctx) => {
  if (!isAdmin(ctx)) return;
  try {
    const res = await pool.query(
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
        `📌 إثبات #${sub.id}
` +
        `👤 المستخدم: <code>${sub.user_id}</code>
` +
        `📋 المهمة: ${sub.title} (ID: ${sub.task_id})
` +
        `💰 المكافأة: ${price.toFixed(4)}$
` +
        `📝 الإثبات:
${sub.proof}`;
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
// ✅ موافقة الأدمن
bot.action(/^approve_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مسموح');
  const subId = Number(ctx.match[1]);
  try {
    await pool.query('BEGIN');
    const subRes = await pool.query('SELECT * FROM task_proofs WHERE id=$1 AND status=$2', [subId, 'pending']);
    if (!subRes.rows.length) {
      await pool.query('ROLLBACK');
      await ctx.answerCbQuery();
      return ctx.reply('⚠️ هذا الإثبات غير موجود أو تم معالجته مسبقاً.');
    }
    const sub = subRes.rows[0];
    const taskRes = await pool.query('SELECT price FROM tasks WHERE id=$1', [sub.task_id]);
    const price = parseFloat(taskRes.rows[0]?.price) || 0;
    const upd = await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [price, sub.user_id]);
    if (upd.rowCount === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [sub.user_id, price]);
    }
    await pool.query(
      'INSERT INTO earnings (user_id, source, amount, description, timestamp) VALUES ($1, $2, $3, $4, NOW())',
      [sub.user_id, 'task', price, `ربح من تنفيذ مهمة ID ${sub.task_id}`]
    );
    await pool.query('UPDATE task_proofs SET status=$1 WHERE id=$2', ['approved', subId]);
    await pool.query(
      `INSERT INTO user_tasks (user_id, task_id, status)
       VALUES ($1, $2, 'approved')
       ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'approved'`,
      [sub.user_id, sub.task_id]
    );
    await pool.query('COMMIT');
    try { 
      await ctx.editMessageText(`✅ تمت الموافقة على الإثبات #${subId}
👤 المستخدم: ${sub.user_id}
💰 ${price.toFixed(4)}$`); 
    } catch (_) {}
    try { 
      await bot.telegram.sendMessage(sub.user_id, `✅ تمت الموافقة على إثبات المهمة (ID: ${sub.task_id}). المبلغ ${price.toFixed(4)}$ أُضيف إلى رصيدك.`); 
    } catch (_) {}
    try {
      const refRes = await pool.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [sub.user_id]);
      if (refRes.rows.length > 0) {
        const referrerId = refRes.rows[0].referrer_id;
        const commission = price * 0.05;
        if (commission > 0) {
          const updRef = await pool.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id=$2', [commission, referrerId]);
          if (updRef.rowCount === 0) {
            await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1,$2)', [referrerId, commission]);
          }
          await pool.query(
            'INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)',
            [referrerId, sub.user_id, commission]
          );
          await pool.query(
            'INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)',
            [referrerId, commission, 'referral_bonus']
          );
          try {
            await bot.telegram.sendMessage(referrerId, `🎉 حصلت على عمولة ${commission.toFixed(4)}$ من إحالة ${sub.user_id} بعد تنفيذ مهمة.`);
          } catch (_) {}
        }
      }
    } catch (e) {
      console.error('❌ خطأ أثناء تطبيق مكافأة الإحالة بعد الموافقة:', e);
    }
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch(_) {}
    console.error('❌ approve error:', err);
    await ctx.reply('حدث خطأ أثناء الموافقة على الإثبات.');
  }
});
// ✅ رفض الأدمن
bot.action(/^deny_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مسموح');
  const subId = Number(ctx.match[1]);
  try {
    const res = await pool.query(
      'UPDATE task_proofs SET status=$1 WHERE id=$2 AND status=$3 RETURNING *',
      ['rejected', subId, 'pending']
    );
    if (!res.rowCount) return ctx.reply('⚠️ هذا الإثبات غير موجود أو تم معالجته سابقًا.');
    const row = res.rows[0];
    await pool.query(
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
      pool.query('SELECT COUNT(*) AS c FROM users'),
      pool.query('SELECT COALESCE(SUM(amount), 0) AS s FROM earnings'),
      pool.query('SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE status = $1', ['paid']),
      pool.query('SELECT COUNT(*) AS c FROM withdrawals WHERE status = $1', ['pending']),
      pool.query("SELECT COUNT(*) AS c FROM user_tasks WHERE status = 'pending'")
    ]);
    await ctx.replyWithHTML(
      `📈 <b>الإحصائيات</b>
` +
      `👥 عدد المستخدمين: <b>${users.rows[0].c}</b>
` +
      `💰 الأرباح الموزعة: <b>${Number(earnings.rows[0].s).toFixed(2)}$</b>
` +
      `📤 المدفوعات: <b>${Number(paid.rows[0].s).toFixed(2)}$</b>
` +
      `⏳ طلبات معلقة: <b>${pending.rows[0].c}</b>
` +
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
  const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
  const balance = parseFloat(res.rows[0]?.balance) || 0;
  const lang = getLang(ctx);
  await ctx.reply(`✅ خرجت من لوحة الأدمن.
💰 ${t(lang, 'your_balance')}: ${balance.toFixed(4)}$`,
   Markup.keyboard([
    [t(lang, 'your_balance'), t(lang, 'earn_sources')],
    [t(lang, 'withdraw'), t(lang, 'referral')],
    [t(lang, 'tasks'), t(lang, 'videos')],
    [t(lang, 'rate')],
    [t(lang, 'facebook')]
   ]).resize()
  );
});
// 🎬 فيديوهاتي
bot.hears((text, ctx) => text === t(getLang(ctx), 'videos'), async (ctx) => {
  const userId = ctx.from.id;
  const lang = getLang(ctx);
  const url = `https://perceptive-victory-production.up.railway.app/my-videos.html?user_id=${userId}`;
  await ctx.reply(
    t(lang, 'videos_message'),
    Markup.inlineKeyboard([
      [Markup.button.webApp(t(lang, 'videos'), url)]
    ])
  );
});
// 🌐 تغيير اللغة
bot.hears('🌐 اللغة', async (ctx) => {
  const lang = getLang(ctx);
  await ctx.reply(
    t(lang, "choose_lang"),
    Markup.keyboard([
      [t('en', "english"), t('ar', "arabic")],
      [t(lang, "back")]
    ]).resize()
  );
});
// English
bot.hears('🌐 English', async (ctx) => {
  setLang(ctx, "en");
  await ctx.reply(t("en", "lang_changed_en"));
});
// Arabic
bot.hears('🌐 العربية', async (ctx) => {
  setLang(ctx, "ar");
  await ctx.reply(t("ar", "lang_changed_ar"));
});
// ↩️ زر الرجوع
bot.hears((text, ctx) => {
  const lang = getLang(ctx);
  const backLabel = t(lang, 'back');
  return text === backLabel || text === '⬅️ رجوع' || text === '⬅️ Back';
}, async (ctx) => {
  try {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || '';
    let balance = 0;
    try {
      const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
      if (res.rows.length) balance = parseFloat(res.rows[0].balance) || 0;
    } catch (e) {
      console.error('error fetching balance for back button:', e);
    }
    const lang = getLang(ctx);
    await ctx.replyWithHTML(
      t(lang, 'welcome', { name: firstName, balance: balance.toFixed(4) }),
      Markup.keyboard([
        [t(lang, 'your_balance'), t(lang, 'earn_sources')],
        [t(lang, 'withdraw'), t(lang, 'referral')],
        [t(lang, 'tasks')],
        [t(lang, 'videos')],
        [t(lang, 'language')],
        [t(lang, 'rate')],
        [t(lang, 'facebook')]
      ]).resize()
    );
  } catch (err) {
    console.error('Back button handler error:', err);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});
bot.command('pay', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /pay <ID>');
  try {
    const res = await pool.query(
      'UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *',
      ['paid', id]
    );
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');
    const withdrawal = res.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;
    try {
      await bot.telegram.sendMessage(
        userId,
        `✅ تم الموافقة على طلب السحب الخاص بك.
💰 المبلغ: ${amount}$
💳 المحفظة: ${wallet}
⏳ تم تنفيذ السحب بنجاح.`
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
    const res = await pool.query(
      'UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *',
      ['rejected', id]
    );
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');
    const withdrawal = res.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;
    try {
      await bot.telegram.sendMessage(
        userId,
        `❌ تم رفض طلب السحب الخاص بك.
💰 المبلغ: ${amount}$
💳 المحفظة: ${wallet}
🔹 يمكنك تعديل طلبك أو المحاولة لاحقاً.`
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
    if (typeof bot !== 'undefined') {
      await bot.launch();
      console.log('🤖 Telegram bot launched successfully!');
    }
    console.log('✅ Bot is running. Container should stay alive!');
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
  }
})();
