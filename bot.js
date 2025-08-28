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

// 🔵 إنشاء/تحديث الجداول عند الإقلاع
async function initSchema() {
  try {
    // جدول المستخدمين
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        telegram_id BIGINT PRIMARY KEY,
        balance NUMERIC(12,6) DEFAULT 0
      );
    `);

    // جدول الإحالات
    await client.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id  BIGINT NOT NULL UNIQUE,
        created_at  TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول أرباح الإحالة
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_earnings (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id  BIGINT NOT NULL,
        amount NUMERIC(12,6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول السحوبات
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        amount NUMERIC(12,2) NOT NULL,
        payeer_wallet VARCHAR,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول المهمات
    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title VARCHAR NOT NULL,
        description TEXT,
        reward DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // جدول إثباتات المهام
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_submissions (
        id SERIAL PRIMARY KEY,
        task_id INT NOT NULL,
        user_id BIGINT NOT NULL,
        proof TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        submitted_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        admin_note TEXT
      );
    `);

    console.log('✅ initSchema: تم تجهيز جميع الجداول');
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

// 🔵 تطبيق مكافأة الإحالة (3% الآن)
async function applyReferralBonus(earnerId, earnedAmount) {
  try {
    const ref = await client.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [earnerId]);
    if (ref.rows.length === 0) return;

    const referrerId = ref.rows[0].referrer_id;
    if (!referrerId || Number(referrerId) === Number(earnerId)) return;

    const bonus = Number(earnedAmount) * 0.03; // 3%
    if (bonus <= 0) return;

    await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [bonus, referrerId]);

    await client.query(
      'INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)',
      [referrerId, earnerId, bonus]
    );

    console.log(`🎉 إحالة: أضيفت مكافأة ${bonus.toFixed(4)}$ للمحيل ${referrerId} بسبب ربح ${earnerId}`);
  } catch (e) {
    console.error('❌ applyReferralBonus:', e);
  }
}

// 🔵 أمر /credit للأدمن
bot.command('credit', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const parts = (ctx.message.text || '').trim().split(/\s+/);
  const targetId = parts[1];
  const amount = Number(parts[2]);
  if (!targetId || isNaN(amount)) return ctx.reply('استخدم: /credit <userId> <amount>');

  try {
    await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [amount, targetId]);
    await applyReferralBonus(targetId, amount);
    return ctx.reply(`✅ تم إضافة ${amount.toFixed(4)}$ للمستخدم ${targetId} وتطبيق مكافأة الإحالة (إن وجدت).`);
  } catch (e) {
    console.error('❌ /credit:', e);
    return ctx.reply('فشل في إضافة الرصيد.');
  }
});

// 🏠 /start
bot.start(async (ctx) => {
  if (!ctx.session) ctx.session = {};
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || '';
  let balance = 0;

  let res = await client.query('SELECT balance FROM users WHERE telegram_id=$1', [userId]);
  if (res.rows.length > 0) balance = parseFloat(res.rows[0].balance) || 0;
  else await client.query('INSERT INTO users (telegram_id,balance) VALUES ($1,$2)', [userId,0]);

  await ctx.replyWithHTML(
    `👋 أهلاً بك، <b>${firstName}</b>!\n\n💰 <b>رصيدك:</b> ${balance.toFixed(4)}$`,
    Markup.keyboard([
      ['💰 رصيدك', '🎁 مصادر الربح'],
      ['📤 طلب سحب', '👥 ريفيرال']
    ]).resize()
  );
});

// 💰 رصيدك
bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id=$1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    await ctx.replyWithHTML(`💰 رصيدك: <b>${balance.toFixed(4)}$</b>`);
  } catch (err) { console.error(err); await ctx.reply('حدث خطأ.'); }
});

// 👥 ريفيرال
bot.hears('👥 ريفيرال', async (ctx) => {
  const userId = ctx.from.id;
  const botUsername = 'TasksRewardBot';
  const refLink = `https://t.me/${botUsername}?start=ref_${userId}`;
  try {
    const countRes = await client.query('SELECT COUNT(*) AS c FROM referrals WHERE referrer_id=$1', [userId]);
    const refsCount = Number(countRes.rows[0]?.c || 0);
    await ctx.replyWithHTML(
      `👥 <b>برنامج الإحالة</b>\n🔗 <code>${refLink}</code>\n📊 <b>إحصاءاتك</b>\n- عدد الإحالات: <b>${refsCount}</b>`
    );
  } catch (e) { console.error('❌ ريفيرال:', e); await ctx.reply('تعذر جلب بيانات الإحالة حالياً.'); }
});

// 🎁 مصادر الربح
bot.hears('🎁 مصادر الربح', async (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.io/users/login?oid=b328534e6b994827&uid=${userId}`;
  await ctx.reply(
    'اختر مصدر ربح:',
    Markup.inlineKeyboard([
      [Markup.button.url('🕒 TimeWall', timewallUrl)],
      [Markup.button.callback('📋 مهمات TasksRewardBot', 'show_tasks')]
    ])
  );
});

// عرض قائمة المهمات
bot.action('show_tasks', async (ctx) => {
  try {
    const res = await client.query('SELECT * FROM tasks ORDER BY id DESC');
    if (!res.rows.length) return ctx.reply('❌ لا توجد مهمات حالياً.');

    const buttons = res.rows.map(t => [Markup.button.callback(`${t.title} — ${t.reward}$`, `task_${t.id}`)]);
    await ctx.reply('📋 اختر المهمة:', Markup.inlineKeyboard(buttons));
  } catch (e) { console.error(e); ctx.reply('حدث خطأ في جلب المهمات.'); }
});

// عرض مهمة محددة وطلب إثبات
bot.action(/task_(\d+)/, async (ctx) => {
  const taskId = ctx.match[1];
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT * FROM tasks WHERE id=$1', [taskId]);
    if (!res.rows.length) return ctx.reply('❌ المهمة غير موجودة.');
    const task = res.rows[0];
    ctx.session.currentTask = taskId;
    await ctx.replyWithHTML(`<b>${task.title}</b>\n\n${task.description}\n💰 المكافأة: ${task.reward}$\n📤 أرسل إثبات المهمة.`);
  } catch (e) { console.error(e); ctx.reply('حدث خطأ في المهمة.'); }
});

// معالجة إرسال إثبات المهمة
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  if (ctx.session.currentTask) {
    const proofText = ctx.message.text;
    const taskId = ctx.session.currentTask;
    const userId = ctx.from.id;
    try {
      await client.query('INSERT INTO task_submissions (task_id,user_id,proof) VALUES ($1,$2,$3)', [taskId,userId,proofText]);
      ctx.reply('✅ تم إرسال إثبات المهمة.');
      ctx.session.currentTask = null;
    } catch (e) { console.error(e); ctx.reply('حدث خطأ أثناء إرسال الإثبات.'); }
    return;
  }
  return next();
});

// 🔐 لوحة الأدمن: إضافة مهمة جديدة
bot.hears('➕ إضافة مهمة جديدة', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingNewTask = true;
  await ctx.reply('📝 ارسل اسم المهمة:');
});
bot.on('text', async (ctx, next) => {
  if (!ctx.session) ctx.session = {};
  if (ctx.session.awaitingNewTask) {
    if (!ctx.session.newTask) { ctx.session.newTask = { title: ctx.message.text }; return ctx.reply('✏️ ارسل وصف المهمة:'); }
    else if (!ctx.session.newTask.description) { ctx.session.newTask.description = ctx.message.text; return ctx.reply('💰 ارسل سعر المكافأة بالدولار:'); }
    else {
      const reward = parseFloat(ctx.message.text);
      if (isNaN(reward)||reward<=0) return ctx.reply('❌ المبلغ غير صالح.');
      await client.query('INSERT INTO tasks (title,description,reward) VALUES ($1,$2,$3)', [ctx.session.newTask.title,ctx.session.newTask.description,reward]);
      ctx.reply(`✅ تم إضافة المهمة: ${ctx.session.newTask.title} — ${reward}$`);
      ctx.session.awaitingNewTask=false; ctx.session.newTask=null;
    }
    return;
  }
  return next();
});

// 💼 إثباتات مهمات المستخدمين
bot.hears('💼 إثباتات مهمات المستخدمين', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const res = await client.query(`
    SELECT ts.id, ts.user_id, t.title, t.reward, ts.proof
    FROM task_submissions ts
    JOIN tasks t ON t.id=ts.task_id
    WHERE ts.status=$1
    ORDER BY ts.id DESC`, ['pending']
  );
  if (!res.rows.length) return ctx.reply('✅ لا توجد إثباتات معلقة.');
  for (const sub of res.rows) {
    await ctx.reply(`📌 المهمة: ${sub.title}\n👤 المستخدم: ${sub.user_id}\n💰 المكافأة: ${sub.reward}$\n📄 الإثبات: ${sub.proof}\n\nللقبول: /approve ${sub.id}\nللرفض: /reject_task ${sub.id}`);
  }
});

// قبول المهمة
bot.command('approve', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number(ctx.message.text.split(' ')[1]); if (!id) return ctx.reply('استخدم: /approve <ID>');
  try {
    const subRes = await client.query('SELECT * FROM task_submissions WHERE id=$1', [id]);
    if (!subRes.rows.length) return ctx.reply('❌ الإرسال غير موجود.');
    const submission = subRes.rows[0];
    const taskRes = await client.query('SELECT reward FROM tasks WHERE id=$1',[submission.task_id]);
    const reward = parseFloat(taskRes.rows[0]?.reward||0);
    await client.query('UPDATE task_submissions SET status=$1,processed_at=NOW() WHERE id=$2',['approved',id]);
    await client.query('UPDATE users SET balance=COALESCE(balance,0)+$1 WHERE telegram_id=$2',[reward,submission.user_id]);
    await applyReferralBonus(submission.user_id,reward);
    ctx.reply(`✅ تم قبول المهمة ${submission.id}، أضيفت المكافأة للمستخدم ${submission.user_id}`);
  } catch(e){console.error(e); ctx.reply('فشل قبول المهمة.');}
});

// رفض المهمة
bot.command('reject_task', async (ctx) => {
  if (!isAdmin(ctx)) return;
  const id = Number(ctx.message.text.split(' ')[1]); if (!id) return ctx.reply('استخدم: /reject_task <ID>');
  try { await client.query('UPDATE task_submissions SET status=$1,processed_at=NOW() WHERE id=$2',['rejected',id]); ctx.reply(`⛔ تم رفض المهمة ${id}.`); } 
  catch(e){console.error(e); ctx.reply('فشل رفض المهمة.');}
});

// ====== تشغيل البوت ======
(async () => { await connectDB(); await initSchema(); bot.launch(); console.log('🤖 البوت يعمل!'); })();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
