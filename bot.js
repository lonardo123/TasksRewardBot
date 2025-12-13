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
      referral_message: `👥 <b>برنامج الإحالة</b>\nهذا رابطك الخاص، شاركه مع أصدقائك واربح من نشاطهم:\n🔗 <code>{refLink}</code>\n💡 <b>كيف تُحتسب أرباح الإحالة؟</b>\nتحصل على <b>5%</b> من أرباح كل مستخدم ينضم من طرفك.\n📊 <b>إحصاءاتك</b>\n- عدد الإحالات: <b>{refsCount}</b>`,
      earn_sources_instructions: `📌 <b>طريقة العمل:</b>\n1️⃣ اضغط على 🎁 <b>مصادر الربح</b> في القائمة.\n2️⃣ اختر 🕒 <b>TimeWall</b>.\n3️⃣ اربط حسابك عبر الرابط الظاهر.\n4️⃣ نفّذ المهام (مشاهدة إعلانات – تنفيذ مهمات بسيطة).\n🔑 <b>طريقة سحب المال من TimeWall:</b>\n- ادخل صفحة Withdraw\n- اضغط على زر "سحب" أعلى الصفحة\n✅ الأرباح تضاف لحسابك مباشرة 💵\n💰 <b>السحب من البوت:</b>\n- الحد الأدنى: 1.00$\n- اختر 📤 <b>طلب سحب</b>\n- أدخل محفظة <b>بعملة Litecoin (LTC)</b>\n- بعد مراجعة الأدمن يتم الدفع ✅`,
      no_tasks: "❌ لا توجد مهمات متاحة حالياً.",
      min_withdraw_error: "❌ الحد الأدنى للسحب هو {min}$. رصيدك: {balance}$",
      request_wallet: `⚡ لإستلام أرباحك:\nالرجاء إدخال عنوان محفظتك الخاص بعملة Litecoin (LTC)، سواء كنت تستخدم FaucetPay أو Binance.\nمثال على العنوان:\n1CidQZM4kL1yCcS*****9nYtMtEJ2TDQ\nتنبيه مهم:\nتأكد من نسخ العنوان بالكامل وصحيح 100%، أي خطأ قد يؤدي إلى فقدان الأموال.`,
      invalid_ltc: "❌ عنوان محفظة Litecoin غير صالح. يجب أن يبدأ بـ L أو M أو ltc1 ويكون بطول صحيح.",
      withdrawal_submitted: "✅ تم تقديم طلب سحب بقيمة {amount}$. رصيدك المتبقي: {remaining}$",
      videos_message: "🎬 اضغط على الزر لعرض وإدارة فيديوهاتك:",
      rate_message: "🌟 لو سمحت قيّم البوت من هنا:\n👉 https://toptelegrambots.com/list/TasksRewardBot",
      facebook_message: "📩 للتواصل معنا زور صفحتنا على فيسبوك:\n👉 https://www.facebook.com/profile.php?id=61581071731231",
      internal_error: "حدث خطأ داخلي.",
      proof_already_submitted: "⚠️ لقد سبق وأن أرسلت إثباتاً لهذه المهمة.",
      proof_submitted: "✅ تم إرسال الإثبات، وسيتم مراجعته من الإدارة.",
      apply_now: "📌 قدّم الآن",
      submit_proof: "📝 إرسال إثبات",
      task_duration: "مدة المهمة",
      after_duration: "بعد انتهاء هذه المدة سيظهر لك زر \"إرسال إثبات\""
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
      referral_message: `👥 <b>Referral Program</b>\nYour personal link — share it and earn from your friends' activity:\n🔗 <code>{refLink}</code>\n💡 <b>How referral earnings work?</b>\nYou get <b>5%</b> of all earnings from users who join via your link.\n📊 <b>Your Stats</b>\n- Referrals: <b>{refsCount}</b>`,
      earn_sources_instructions: `📌 <b>How it works:</b>\n1️⃣ Tap 🎁 <b>Earn Sources</b> in the menu.\n2️⃣ Choose 🕒 <b>TimeWall</b>.\n3️⃣ Link your account using the shown link.\n4️⃣ Complete tasks (watch ads – do simple tasks).\n🔑 <b>How to withdraw from TimeWall:</b>\n- Go to Withdraw page\n- Click the "Withdraw" button at the top\n✅ Earnings are added instantly to your account 💵\n💰 <b>Withdraw from bot:</b>\n- Minimum: 1.00$\n- Choose 📤 <b>Withdraw</b>\n- Enter your <b>LTC (Litecoin) wallet</b>\n- Admin will review and pay you ✅`,
      no_tasks: "❌ No tasks available right now.",
      min_withdraw_error: "❌ Minimum withdrawal is {min}$. Your balance: {balance}$",
      request_wallet: `⚡ To receive your earnings:\nPlease enter your Litecoin (LTC) wallet address (FaucetPay or Binance).\nExample:\n1CidQZM4kL1yCcS*****9nYtMtEJ2TDQ\n⚠️ Important:\nMake sure the address is 100% correct. Any mistake may result in lost funds.`,
      invalid_ltc: "❌ Invalid Litecoin wallet. Must start with L, M, or ltc1 and have correct length.",
      withdrawal_submitted: "✅ Withdrawal request for {amount}$ submitted. Remaining balance: {remaining}$",
      videos_message: "🎬 Tap the button to view/manage your videos:",
      rate_message: "🌟 Please rate the bot here:\n👉 https://toptelegrambots.com/list/TasksRewardBot",
      facebook_message: "📩 Contact us on our Facebook page:\n👉 https://www.facebook.com/profile.php?id=61581071731231",
      internal_error: "An internal error occurred.",
      proof_already_submitted: "⚠️ You have already submitted proof for this task.",
      proof_submitted: "✅ Proof submitted. Admin will review it.",
      apply_now: "📌 Apply Now",
      submit_proof: "📝 Submit Proof",
      task_duration: "Task Duration",
      after_duration: "After this duration, the 'Submit Proof' button will appear."
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

// ====== إعداد اتصال قاعدة البيانات ======
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

// 🔵 أداة مساعدة: تطبيق مكافأة الإحالة (5%)
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
    await pool.query('INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)', [referrerId, earnerId, bonus]);
    try {
      await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [referrerId, bonus, 'referral_bonus']);
    } catch (_) {}
    console.log(`🎉 إحالة: أضيفت مكافأة ${bonus.toFixed(4)}$ للمحيل ${referrerId} بسبب ربح ${earnerId}`);
  } catch (e) {
    console.error('❌ applyReferralBonus:', e);
  }
}

// 🔵 أمر أدمن اختياري
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
  if (userId !== adminId) {
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }
  ctx.session.isAdmin = true;
  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن. اختر العملية:', Markup.keyboard([
    ['📋 عرض الطلبات', '📊 الإحصائيات'],
    ['➕ إضافة رصيد', '➖ خصم رصيد'],
    ['➕ إضافة مهمة جديدة', '📝 المهمات', '📝 اثباتات مهمات المستخدمين'],
    ['👥 ريفيرال', '🚪 خروج من لوحة الأدمن']
  ]).resize());
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

// ========================
// 🔄 معالج نص مركزي موحد (يغطي كل الحالات بلغتي ar و en)
// ========================
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  const text = ctx.message?.text?.trim();
  if (!text) return next();

  const userId = ctx.from.id;
  const lang = getLang(ctx);

  // 1. إرسال إثبات مهمة
  if (userSessions[userId]?.awaiting_task_submission) {
    const taskId = Number(userSessions[userId].awaiting_task_submission);
    let proof = ctx.message.text || "";
    if (ctx.message.photo && ctx.message.photo.length) {
      const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
      proof = `📷 صورة مرفقة - file_id: ${fileId}`;
    }
    try {
      await pool.query('BEGIN');
      const exists = await pool.query('SELECT status FROM user_tasks WHERE user_id = $1 AND task_id = $2', [userId, taskId]);
      if (exists.rows.length && ['pending','approved'].includes(exists.rows[0].status)) {
        await pool.query('ROLLBACK');
        delete userSessions[userId].awaiting_task_submission;
        return ctx.reply(t(lang, 'proof_already_submitted'));
      }
      await pool.query("INSERT INTO task_proofs (task_id, user_id, proof, status, created_at) VALUES ($1, $2, $3, 'pending', NOW())", [taskId, userId, proof]);
      await pool.query(`INSERT INTO user_tasks (user_id, task_id, status) VALUES ($1, $2, 'pending') ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'pending'`, [userId, taskId]);
      await pool.query('COMMIT');
      delete userSessions[userId].awaiting_task_submission;
      return ctx.reply(t(lang, 'proof_submitted'));
    } catch (err) {
      await pool.query('ROLLBACK').catch(() => {});
      console.error("❌ خطأ أثناء حفظ الإثبات:", err);
      return ctx.reply(t(lang, 'internal_error'));
    }
  }

  // 2. طلب سحب
  if (ctx.session.awaiting_withdraw) {
    if (!/^([LM][a-km-zA-HJ-NP-Z1-9]{26,33}|ltc1[a-z0-9]{39,59})$/i.test(text)) {
      return ctx.reply(t(lang, 'invalid_ltc'));
    }
    const userRes = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = parseFloat(userRes.rows[0]?.balance) || 0;
    if (balance < MIN_WITHDRAW) {
      ctx.session.awaiting_withdraw = false;
      return ctx.reply(t(lang, 'min_withdraw_error', { min: MIN_WITHDRAW, balance: balance.toFixed(4) }));
    }
    const withdrawAmount = Math.floor(balance * 100) / 100;
    const remaining = balance - withdrawAmount;
    await pool.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)', [userId, withdrawAmount, text.toUpperCase()]);
    await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [remaining, userId]);
    ctx.session.awaiting_withdraw = false;
    return ctx.reply(t(lang, 'withdrawal_submitted', { amount: withdrawAmount.toFixed(2), remaining: remaining.toFixed(4) }));
  }

  // 3. إضافة/خصم رصيد (أدمن)
  if (ctx.session.awaitingAction === 'add_balance' || ctx.session.awaitingAction === 'deduct_balance') {
    if (!ctx.session.targetUser) {
      ctx.session.targetUser = text;
      return ctx.reply('💵 أرسل المبلغ:');
    } else {
      const targetId = ctx.session.targetUser;
      const amount = parseFloat(text);
      if (isNaN(amount)) {
        ctx.session = {};
        return ctx.reply('❌ المبلغ غير صالح.');
      }
      const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [targetId]);
      if (res.rows.length === 0) {
        ctx.session = {};
        return ctx.reply('❌ المستخدم غير موجود.');
      }
      let balance = parseFloat(res.rows[0].balance) || 0;
      let newBalance = ctx.session.awaitingAction === 'add_balance' ? balance + amount : balance - amount;
      if (newBalance < 0) newBalance = 0;
      await pool.query('UPDATE users SET balance = $1 WHERE telegram_id = $2', [newBalance, targetId]);
      if (ctx.session.awaitingAction === 'add_balance' && amount > 0) {
        await applyReferralBonus(targetId, amount);
        try { await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [targetId, amount, 'admin_adjust']); } catch(_){}
      }
      ctx.reply(`✅ تم ${ctx.session.awaitingAction === 'add_balance' ? 'إضافة' : 'خصم'} ${amount.toFixed(4)}$ للمستخدم ${targetId}. رصيده: ${newBalance.toFixed(4)}$`);
      ctx.session = {};
      return;
    }
  }

  // 4. إضافة مهمة جديدة (أدمن)
  if (ctx.session.awaitingAction === 'add_task') {
    if (!isAdmin(ctx)) {
      delete ctx.session.awaitingAction;
      return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
    }
    const raw = ctx.message.text || '';
    const parts = raw.split('|').map(p => p.trim());
    if (parts.length < 3) {
      return ctx.reply('❌ صيغة خاطئة. استخدم: العنوان | الوصف | السعر | المدة (اختياري)\nمثال: coinpayu | اجمع رصيد | 0.0500 | 30d');
    }
    const title = parts[0];
    let description, priceStr, durationStr;
    if (parts.length === 3) {
      description = parts[1];
      priceStr = parts[2];
    } else {
      durationStr = parts[parts.length - 1];
      priceStr = parts[parts.length - 2];
      description = parts.slice(1, parts.length - 2).join(' | ');
    }
    const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) return ctx.reply('❌ السعر غير صالح.');
    const price = parseFloat(numMatch[0].replace(',', '.'));
    if (isNaN(price) || price <= 0) return ctx.reply('❌ السعر غير صالح.');

    const parseDuration = (s) => {
      if (!s) return null;
      s = ('' + s).trim().toLowerCase();
      const m = s.match(/^(\d+(?:[.,]\d+)?)(s|sec|m|min|h|d)?$/);
      if (!m) return null;
      let val = parseFloat(m[1].replace(',', '.'));
      if (isNaN(val)) return null;
      switch (m[2] || '') {
        case 's': case 'sec': return Math.round(val);
        case 'm': case 'min': return Math.round(val * 60);
        case 'h': return Math.round(val * 3600);
        case 'd': return Math.round(val * 86400);
        default: return Math.round(val);
      }
    };

    let durationSeconds = 30 * 86400;
    if (durationStr) {
      const parsed = parseDuration(durationStr);
      if (parsed === null || parsed <= 0) return ctx.reply('❌ صيغة المدة غير مفهومة.');
      durationSeconds = parsed;
    }

    try {
      const res = await pool.query('INSERT INTO tasks (title, description, price, duration_seconds) VALUES ($1,$2,$3,$4) RETURNING id', [title, description, price, durationSeconds]);
      const formatDuration = (secs) => {
        if (!secs) return 'غير محددة';
        if (secs % 86400 === 0) return `${secs / 86400} يوم`;
        if (secs % 3600 === 0) return `${secs / 3600} ساعة`;
        if (secs % 60 === 0) return `${secs / 60} دقيقة`;
        return `${secs} ثانية`;
      };
      await ctx.replyWithHTML(
        `✅ تم إضافة المهمة #${res.rows[0].id} بنجاح.\n🏷️ <b>العنوان:</b> ${title}\n📖 <b>الوصف:</b> ${description}\n💰 <b>السعر:</b> ${price.toFixed(4)}\n⏱️ <b>المدة:</b> ${formatDuration(durationSeconds)}`,
        { disable_web_page_preview: true }
      );
      delete ctx.session.awaitingAction;
    } catch (err) {
      console.error('❌ إضافة مهمة:', err);
      ctx.reply('حدث خطأ أثناء إضافة المهمة.');
    }
    return;
  }

  // 5. تعديل مهمة (أدمن)
  if (ctx.session.awaitingEdit) {
    if (!isAdmin(ctx)) {
      delete ctx.session.awaitingEdit;
      return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
    }
    const taskId = ctx.session.awaitingEdit;
    const raw = ctx.message.text || '';
    const parts = raw.split('|').map(p => p.trim());
    if (parts.length < 3) {
      return ctx.reply('⚠️ الصيغة غير صحيحة. مثال:\ncoinpayu | سجل عبر الرابط | 0.0500');
    }
    const title = parts[0];
    let description, priceStr, durationStr;
    if (parts.length === 3) {
      description = parts[1];
      priceStr = parts[2];
    } else {
      durationStr = parts[parts.length - 1];
      priceStr = parts[parts.length - 2];
      description = parts.slice(1, parts.length - 2).join(' | ');
    }
    const numMatch = priceStr.match(/[\d]+(?:[.,]\d+)*/);
    if (!numMatch) return ctx.reply('❌ السعر غير صالح.');
    const price = parseFloat(numMatch[0].replace(',', '.'));
    if (isNaN(price) || price <= 0) return ctx.reply('❌ السعر غير صالح.');

    const parseDuration = (s) => {
      if (!s) return null;
      s = ('' + s).trim().toLowerCase();
      const m = s.match(/^(\d+(?:[.,]\d+)?)(s|sec|m|min|h|d)?$/);
      if (!m) return null;
      let val = parseFloat(m[1].replace(',', '.'));
      if (isNaN(val)) return null;
      switch (m[2] || '') {
        case 's': case 'sec': return Math.round(val);
        case 'm': case 'min': return Math.round(val * 60);
        case 'h': return Math.round(val * 3600);
        case 'd': return Math.round(val * 86400);
        default: return Math.round(val);
      }
    };

    let durationSeconds = 30 * 86400;
    const cur = await pool.query('SELECT duration_seconds FROM tasks WHERE id=$1', [taskId]);
    if (cur.rows[0]) durationSeconds = cur.rows[0].duration_seconds;
    if (durationStr) {
      const parsed = parseDuration(durationStr);
      if (parsed !== null && parsed > 0) durationSeconds = parsed;
    }

    await pool.query('UPDATE tasks SET title=$1, description=$2, price=$3, duration_seconds=$4 WHERE id=$5', [title, description, price, durationSeconds, taskId]);
    delete ctx.session.awaitingEdit;
    return ctx.reply(`✅ تم تعديل المهمة #${taskId} بنجاح.`);
  }

  // 6. معالجة أزرار القائمة (بلغتي ar و en)
  const actionMap = {
    [t('ar', 'your_balance')]: 'balance',
    [t('en', 'your_balance')]: 'balance',
    [t('ar', 'earn_sources')]: 'earn',
    [t('en', 'earn_sources')]: 'earn',
    [t('ar', 'withdraw')]: 'withdraw',
    [t('en', 'withdraw')]: 'withdraw',
    [t('ar', 'referral')]: 'referral',
    [t('en', 'referral')]: 'referral',
    [t('ar', 'tasks')]: 'tasks',
    [t('en', 'tasks')]: 'tasks',
    [t('ar', 'videos')]: 'videos',
    [t('en', 'videos')]: 'videos',
    [t('ar', 'language')]: 'language',
    [t('en', 'language')]: 'language',
    [t('ar', 'rate')]: 'rate',
    [t('en', 'rate')]: 'rate',
    [t('ar', 'facebook')]: 'facebook',
    [t('en', 'facebook')]: 'facebook',
    [t('ar', 'back')]: 'back',
    [t('en', 'back')]: 'back',
    // أزرار الأدمن
    '📋 عرض الطلبات': 'admin_withdrawals',
    '📊 الإحصائيات': 'admin_stats',
    '➕ إضافة رصيد': 'admin_add_balance',
    '➖ خصم رصيد': 'admin_deduct_balance',
    '➕ إضافة مهمة جديدة': 'admin_add_task',
    '📝 المهمات': 'admin_tasks',
    '📝 اثباتات مهمات المستخدمين': 'admin_proofs',
    '👥 ريفيرال': 'admin_referrals',
    '🚪 خروج من لوحة الأدمن': 'admin_exit',
    // دعم تغيير اللغة
    '🌐 English': 'set_en',
    '🌐 العربية': 'set_ar',
  };

  const action = actionMap[text];
  if (!action) return next(); // إذا لم يتطابق، مرر لباقي الأوامر

  try {
    switch (action) {
      case 'balance':
        const res = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
        const balance = parseFloat(res.rows[0]?.balance) || 0;
        await ctx.replyWithHTML(`💰 ${t(lang, 'your_balance')}: <b>${balance.toFixed(4)}$</b>`);
        break;

      case 'referral':
        const botUsername = 'TasksRewardBot';
        const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
        const countRes = await pool.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id = $1', [userId]);
        const refsCount = Number(countRes.rows[0]?.c || 0);
        await ctx.replyWithHTML(t(lang, 'referral_message', { refLink, refsCount }));
        break;

      case 'earn':
        const timewallUrl = `https://timewall.io/users/login?oid=b328534e6b994827&uid=${userId}`;
        await ctx.reply(t(lang, 'earn_sources'), Markup.inlineKeyboard([[Markup.button.url(t(lang, 'earn_sources'), timewallUrl)]]));
        await ctx.replyWithHTML(t(lang, 'earn_sources_instructions'));
        break;

      case 'tasks':
        const tasksRes = await pool.query(
          `SELECT t.id, t.title, t.description, t.price, COALESCE(t.duration_seconds, 2592000) AS duration_seconds,
              ut.status, ut.created_at AS applied_at
           FROM tasks t
           LEFT JOIN user_tasks ut ON ut.task_id = t.id AND ut.user_id = $1
           WHERE NOT EXISTS (
             SELECT 1 FROM user_tasks ut2
             WHERE ut2.task_id = t.id AND ut2.user_id = $1 AND ut2.status IN ('pending','approved')
           )
           ORDER BY t.id DESC LIMIT 20`, [userId]
        );
        if (tasksRes.rows.length === 0) {
          await ctx.reply(t(lang, 'no_tasks'));
        } else {
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
          for (const t of tasksRes.rows) {
            const price = parseFloat(t.price) || 0;
            const duration = Number(t.duration_seconds) || 2592000;
            let msg =
              `📋 المهمة #${t.id}\n` +
              `🏷️ العنوان: ${t.title}\n` +
              `📖 الوصف: ${t.description}\n` +
              `💰 السعر: ${price.toFixed(6)}$\n` +
              `⏱️ مدة المهمة: ${formatDuration(duration)}\n`;
            const buttons = [];
            const status = t.status;
            if (!status || status === 'rejected') {
              msg += `▶️ اضغط "📌 قدّم الآن" لبدء العد.\n`;
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
                  msg += `بعد انقضاء المدة المحددة، سيتم تفعيل زر "إرسال الإثبات"\nنرجو منك مراجعة متطلبات المهمة والتأكد من تنفيذها بالكامل وفق الوصف قبل إرسال الإثبات، حيث أن أي نقص قد يؤدي إلى رفض المهمة.⏳ الوقت المتبقي لإرسال الإثبات: ${formatRemaining(remaining)}.`;
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
        }
        break;

      case 'videos':
        const videoUrl = `https://perceptive-victory-production.up.railway.app/my-videos.html?user_id=${userId}`;
        await ctx.reply(t(lang, 'videos_message'), Markup.inlineKeyboard([[Markup.button.webApp(t(lang, 'videos'), videoUrl)]]));
        break;

      case 'language':
        await ctx.reply(t(lang, "choose_lang"), Markup.keyboard([[t('en', "english"), t('ar', "arabic")], [t(lang, "back")]]).resize());
        break;

      case 'rate':
        await ctx.reply(t(lang, 'rate_message'), {
          reply_markup: {
            inline_keyboard: [[{ text: lang === 'ar' ? '🔗 افتح صفحة التقييم' : '🔗 Open Rating Page', url: 'https://toptelegrambots.com/list/TasksRewardBot' }]]
          }
        });
        break;

      case 'facebook':
        await ctx.reply(t(lang, 'facebook_message'), {
          reply_markup: {
            inline_keyboard: [[{ text: lang === 'ar' ? '📩 افتح صفحتنا على فيسبوك' : '📩 Open Facebook Page', url: 'https://www.facebook.com/profile.php?id=61581071731231' }]]
          }
        });
        break;

      case 'back':
        const resB = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
        const bal = parseFloat(resB.rows[0]?.balance) || 0;
        await ctx.replyWithHTML(t(lang, 'welcome', { name: ctx.from.first_name || '', balance: bal.toFixed(4) }), Markup.keyboard([
          [t(lang, 'your_balance'), t(lang, 'earn_sources')],
          [t(lang, 'withdraw'), t(lang, 'referral')],
          [t(lang, 'tasks')],
          [t(lang, 'videos')],
          [t(lang, 'language')],
          [t(lang, 'rate')],
          [t(lang, 'facebook')]
        ]).resize());
        break;

      // ====== أوامر الأدمن ======
      case 'admin_withdrawals':
        if (!isAdmin(ctx)) break;
        const wRes = await pool.query('SELECT * FROM withdrawals WHERE status = $1 ORDER BY id DESC', ['pending']);
        if (wRes.rows.length === 0) await ctx.reply('✅ لا توجد طلبات معلقة.');
        else for (const req of wRes.rows) {
          await ctx.reply(`طلب سحب #${req.id}\n👤 المستخدم: ${req.user_id}\n💵 المبلغ: ${Number(req.amount).toFixed(2)}$\n💳 المحفظة: ${req.payeer_wallet}\nلقبول: /pay ${req.id}\nلرفض: /reject ${req.id}`);
        }
        break;

      case 'admin_stats':
        if (!isAdmin(ctx)) break;
        const [users, earnings, paid, pending, proofs] = await Promise.all([
          pool.query('SELECT COUNT(*) AS c FROM users'),
          pool.query('SELECT COALESCE(SUM(amount), 0) AS s FROM earnings'),
          pool.query('SELECT COALESCE(SUM(amount), 0) AS s FROM withdrawals WHERE status = $1', ['paid']),
          pool.query('SELECT COUNT(*) AS c FROM withdrawals WHERE status = $1', ['pending']),
          pool.query("SELECT COUNT(*) AS c FROM user_tasks WHERE status = 'pending'")
        ]);
        await ctx.replyWithHTML(
          `📈 <b>الإحصائيات</b>\n` +
          `👥 عدد المستخدمين: <b>${users.rows[0].c}</b>\n` +
          `💰 الأرباح الموزعة: <b>${Number(earnings.rows[0].s).toFixed(2)}$</b>\n` +
          `📤 المدفوعات: <b>${Number(paid.rows[0].s).toFixed(2)}$</b>\n` +
          `⏳ طلبات معلقة: <b>${pending.rows[0].c}</b>\n` +
          `📝 إثباتات مهمات المستخدمين: <b>${proofs.rows[0].c}</b>`
        );
        break;

      case 'admin_add_balance':
        if (!isAdmin(ctx)) break;
        ctx.session.awaitingAction = 'add_balance';
        ctx.session.targetUser = null;
        await ctx.reply('🆔 أرسل ID المستخدم لإضافة رصيد:');
        break;

      case 'admin_deduct_balance':
        if (!isAdmin(ctx)) break;
        ctx.session.awaitingAction = 'deduct_balance';
        ctx.session.targetUser = null;
        await ctx.reply('🆔 أرسل ID المستخدم لخصم رصيد:');
        break;

      case 'admin_add_task':
        if (!isAdmin(ctx)) break;
        ctx.session.awaitingAction = 'add_task';
        await ctx.reply(`📌 أرسل المهمة الجديدة بصيغة: العنوان | الوصف | السعر | المدة (اختياري)\nمثال مدة: 3600s أو 60m أو 1h أو 5d\nمثال كامل: coinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 30d`);
        break;

      case 'admin_tasks':
        if (!isAdmin(ctx)) break;
        const tasks = await pool.query('SELECT id, title, description, price, duration_seconds FROM tasks ORDER BY id DESC');
        if (tasks.rows.length === 0) return ctx.reply('⚠️ لا توجد مهام حالياً.');
        const formatDuration = (secs) => {
          if (!secs) return 'غير محددة';
          if (secs < 60) return `${secs} ثانية`;
          if (secs < 3600) return `${Math.floor(secs / 60)} دقيقة`;
          if (secs < 86400) return `${Math.floor(secs / 3600)} ساعة`;
          return `${Math.floor(secs / 86400)} يوم`;
        };
        for (const t of tasks.rows) {
          const price = parseFloat(t.price) || 0;
          const msg = `📋 المهمة #${t.id}\n🏷️ العنوان: ${t.title}\n📖 الوصف: ${t.description}\n💰 السعر: ${price.toFixed(4)}$\n⏱️ المدة: ${formatDuration(t.duration_seconds)}`;
          await ctx.reply(msg, Markup.inlineKeyboard([
            [ Markup.button.callback(`✏️ تعديل ${t.id}`, `edit_${t.id}`) ],
            [ Markup.button.callback(`🗑️ حذف ${t.id}`, `delete_${t.id}`) ]
          ]));
        }
        break;

      case 'admin_proofs':
        if (!isAdmin(ctx)) break;
        const proofsRes = await pool.query(
          `SELECT tp.id, tp.task_id, tp.user_id, tp.proof, tp.status, tp.created_at, t.title, t.price
           FROM task_proofs tp
           JOIN tasks t ON t.id = tp.task_id
           WHERE tp.status = $1
           ORDER BY tp.id DESC
           LIMIT 10`,
          ['pending']
        );
        if (proofsRes.rows.length === 0) return ctx.reply('✅ لا توجد إثباتات معلقة.');
        for (const sub of proofsRes.rows) {
          const price = parseFloat(sub.price) || 0;
          const msg =
            `📌 إثبات #${sub.id}\n` +
            `👤 المستخدم: <code>${sub.user_id}</code>\n` +
            `📋 المهمة: ${sub.title} (ID: ${sub.task_id})\n` +
            `💰 المكافأة: ${price.toFixed(4)}$\n` +
            `📝 الإثبات:\n${sub.proof}`;
          await ctx.replyWithHTML(msg, {
            reply_markup: {
              inline_keyboard: [
                [{ text: "✅ موافقة", callback_data: `approve_${sub.id}` }, { text: "❌ رفض", callback_data: `deny_${sub.id}` }]
              ]
            }
          });
        }
        break;

      case 'admin_referrals':
        if (!isAdmin(ctx)) break;
        const refs = await pool.query('SELECT COUNT(*) AS total FROM referrals');
        await ctx.reply(`👥 إجمالي الإحالات: ${refs.rows[0].total}`);
        break;

      case 'admin_exit':
        if (!isAdmin(ctx)) break;
        ctx.session = {};
        const resExit = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
        const balanceExit = parseFloat(resExit.rows[0]?.balance) || 0;
        await ctx.reply(`✅ خرجت من لوحة الأدمن.\n💰 ${t(lang, 'your_balance')}: ${balanceExit.toFixed(4)}$`, Markup.keyboard([
          [t(lang, 'your_balance'), t(lang, 'earn_sources')],
          [t(lang, 'withdraw'), t(lang, 'referral')],
          [t(lang, 'tasks'), t(lang, 'videos')],
          [t(lang, 'rate')],
          [t(lang, 'facebook')]
        ]).resize());
        break;

      case 'set_en':
        setLang(ctx, "en");
        await ctx.reply(t("en", "lang_changed_en"));
        break;

      case 'set_ar':
        setLang(ctx, "ar");
        await ctx.reply(t("ar", "lang_changed_ar"));
        break;

      default:
        return next();
    }
  } catch (err) {
    console.error(`❌ خطأ في معالجة "${action}":`, err);
    await ctx.reply(t(lang, 'internal_error'));
  }
});

// ========================
// 🟢 معالجات callback_query (للمهام والإثبات)
// ========================
bot.action(/^submit_(\d+)$/, async (ctx) => {
  try {
    const taskId = ctx.match[1];
    const userId = ctx.from.id;
    if (!userSessions[userId]) userSessions[userId] = {};
    userSessions[userId].awaiting_task_submission = taskId;
    const lang = getLang(ctx);
    await ctx.reply(`📩 ${t(lang, 'submit_proof') || 'أرسل الآن إثبات إتمام المهمة'} رقم ${taskId}`);
  } catch (err) {
    console.error("❌ submit action error:", err);
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

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
      `📌 ${t(lang, 'apply_now') || 'تم تسجيل تقديمك على المهمة'} رقم ${taskId}.\n` +
      `⏱️ ${t(lang, 'task_duration') || 'مدة المهمة'}: ${formatDuration(durationSeconds)}.\n` +
      `⏳ ${t(lang, 'after_duration') || 'بعد انتهاء هذه المدة سيظهر لك زر "إرسال إثبات"'}`
    );
  } catch (err) {
    console.error('❌ apply error:', err);
    try { await ctx.answerCbQuery(); } catch(_) {}
    await ctx.reply(t(getLang(ctx), 'internal_error'));
  }
});

bot.action(/^edit_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) {
    await ctx.answerCbQuery('❌ غير مسموح');
    return;
  }
  const taskId = ctx.match[1];
  ctx.session.awaitingEdit = taskId;
  await ctx.answerCbQuery();
  await ctx.reply(
    `✏️ أرسل المهمة الجديدة لـ #${taskId} بصيغة:\n` +
    `العنوان | الوصف | السعر | المدة\n` +
    `👉 المدة اكتبها بالدقائق أو الساعات أو الأيام.\n` +
    `مثال:\ncoinpayu | اجمع رصيد وارفق رابط التسجيل https://... | 0.0500 | 3 أيام`
  );
});

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
    await pool.query('INSERT INTO earnings (user_id, source, amount, description, timestamp) VALUES ($1, $2, $3, $4, NOW())', [sub.user_id, 'task', price, `ربح من تنفيذ مهمة ID ${sub.task_id}`]);
    await pool.query('UPDATE task_proofs SET status=$1 WHERE id=$2', ['approved', subId]);
    await pool.query(`INSERT INTO user_tasks (user_id, task_id, status) VALUES ($1, $2, 'approved') ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'approved'`, [sub.user_id, sub.task_id]);
    await pool.query('COMMIT');
    try { await ctx.editMessageText(`✅ تمت الموافقة على الإثبات #${subId}\n👤 المستخدم: ${sub.user_id}\n💰 ${price.toFixed(4)}$`); } catch (_) {}
    try { await bot.telegram.sendMessage(sub.user_id, `✅ تمت الموافقة على إثبات المهمة (ID: ${sub.task_id}). المبلغ ${price.toFixed(4)}$ أُضيف إلى رصيدك.`); } catch (_) {}
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
          await pool.query('INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)', [referrerId, sub.user_id, commission]);
          await pool.query('INSERT INTO earnings (user_id, amount, source) VALUES ($1,$2,$3)', [referrerId, commission, 'referral_bonus']);
          try { await bot.telegram.sendMessage(referrerId, `🎉 حصلت على عمولة ${commission.toFixed(4)}$ من إحالة ${sub.user_id} بعد تنفيذ مهمة.`); } catch (_) {}
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

bot.action(/^deny_(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('❌ غير مسموح');
  const subId = Number(ctx.match[1]);
  try {
    const res = await pool.query('UPDATE task_proofs SET status=$1 WHERE id=$2 AND status=$3 RETURNING *', ['rejected', subId, 'pending']);
    if (!res.rowCount) return ctx.reply('⚠️ هذا الإثبات غير موجود أو تم معالجته سابقًا.');
    const row = res.rows[0];
    await pool.query(`INSERT INTO user_tasks (user_id, task_id, status) VALUES ($1, $2, 'rejected') ON CONFLICT (user_id, task_id) DO UPDATE SET status = 'rejected'`, [row.user_id, row.task_id]);
    try { await ctx.editMessageText(`❌ تم رفض الإثبات #${subId}`); } catch (_) {}
    try { await bot.telegram.sendMessage(row.user_id, `❌ تم رفض إثبات المهمة (ID: ${row.task_id}). يمكنك إعادة المحاولة وإرسال إثبات جديد.`); } catch (_) {}
  } catch (err) {
    console.error('❌ deny error:', err);
    ctx.reply('حدث خطأ أثناء رفض الإثبات.');
  }
});

// ========================
// 📤 أوامر الأدمن: /pay و /reject
// ========================
const MIN_WITHDRAW = 1.00;

bot.command('pay', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number((ctx.message.text.split(' ')[1] || '').trim());
  if (!id) return ctx.reply('استخدم: /pay <ID>');
  try {
    const res = await pool.query('UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *', ['paid', id]);
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');
    const withdrawal = res.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;
    try {
      await bot.telegram.sendMessage(userId, `✅ تم الموافقة على طلب السحب الخاص بك.\n💰 المبلغ: ${amount}$\n💳 المحفظة: ${wallet}\n⏳ تم تنفيذ السحب بنجاح.`);
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
    const res = await pool.query('UPDATE withdrawals SET status = $1 WHERE id = $2 RETURNING *', ['rejected', id]);
    if (res.rowCount === 0) return ctx.reply('لم يتم العثور على الطلب.');
    const withdrawal = res.rows[0];
    const userId = withdrawal.user_id;
    const amount = parseFloat(withdrawal.amount).toFixed(2);
    const wallet = withdrawal.payeer_wallet;
    try {
      await bot.telegram.sendMessage(userId, `❌ تم رفض طلب السحب الخاص بك.\n💰 المبلغ: ${amount}$\n💳 المحفظة: ${wallet}\n🔹 يمكنك تعديل طلبك أو المحاولة لاحقاً.`);
    } catch (e) {
      console.error('❌ خطأ عند إرسال رسالة للمستخدم:', e);
    }
    await ctx.reply(`⛔ تم رفض الطلب #${id} وتم إعلام المستخدم.`);
  } catch (e) {
    console.error('❌ reject:', e);
    await ctx.reply('فشل تحديث الحالة.');
  }
});

// ====================
// 🚀 التشغيل
// ====================
(async () => {
  try {
    await bot.launch();
    console.log('🤖 Telegram bot launched successfully!');
    console.log('✅ Bot is running. Container should stay alive!');
  } catch (err) {
    console.error('❌ Failed to start bot:', err);
  }
})();
