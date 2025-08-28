const { Telegraf, session, Markup } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function connectDB() { try { await client.connect(); console.log('✅ اتصال قاعدة البيانات ناجح'); } catch (err) { console.error('❌ فشل الاتصال:', err.message); setTimeout(connectDB, 5000); } }

// ====== تهيئة الجداول ======
async function initSchema() {
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      balance NUMERIC(12,6) DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id BIGINT NOT NULL,
      referee_id BIGINT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS referral_earnings (
      id SERIAL PRIMARY KEY,
      referrer_id BIGINT,
      referee_id BIGINT,
      amount NUMERIC(12,6),
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT,
      description TEXT,
      reward NUMERIC(12,6)
    );
    CREATE TABLE IF NOT EXISTS task_submissions (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      task_id INT,
      proof TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      amount NUMERIC(12,6),
      payeer_wallet TEXT,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ جميع الجداول جاهزة');
}

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());
const isAdmin = (ctx) => String(ctx.from?.id) === String(process.env.ADMIN_ID);

// ====== مكافأة إحالة 5% ======
async function applyReferralBonus(earnerId, earnedAmount) {
  const ref = await client.query('SELECT referrer_id FROM referrals WHERE referee_id=$1', [earnerId]);
  if (ref.rows.length === 0) return;
  const referrerId = ref.rows[0].referrer_id;
  if (!referrerId || Number(referrerId) === Number(earnerId)) return;
  const bonus = Number(earnedAmount) * 0.05;
  if (bonus <= 0) return;
  await client.query('UPDATE users SET balance=COALESCE(balance,0)+$1 WHERE telegram_id=$2', [bonus, referrerId]);
}

// ====== أوامر المستخدم ======
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  await client.query('INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
  await ctx.reply('✅ مرحباً بك! اختر العملية:', Markup.keyboard([
    ['💰 رصيدك','🎁 مصادر الربح'],
    ['📤 طلب سحب','👥 ريفيرال'],
    ['📝 مهام']
  ]).resize());
});

bot.hears('💰 رصيدك', async (ctx) => {
  const res = await client.query('SELECT balance FROM users WHERE telegram_id=$1', [ctx.from.id]);
  const balance = parseFloat(res.rows[0]?.balance || 0);
  await ctx.reply(`💰 رصيدك: ${balance.toFixed(4)}$`);
});

bot.hears('👥 ريفيرال', async (ctx) => {
  const userId = ctx.from.id;
  const refLink = `https://t.me/TasksRewardBot?start=ref_${userId}`;
  await ctx.reply(`رابط الإحالة الخاص بك: ${refLink}`);
});

bot.hears('🎁 مصادر الربح', async (ctx) => {
  await ctx.reply('اختر مصدر الربح:', Markup.inlineKeyboard([
    [Markup.button.url('🕒 TimeWall', `https://timewall.io/users/login?uid=${ctx.from.id}`)],
    [Markup.button.url('📊 TasksRewardBot', 'https://tasksrewardbot.neocities.org')]
  ]));
});

bot.hears('📤 طلب سحب', async (ctx) => {
  ctx.session.awaiting_withdraw = true;
  await ctx.reply('🟢 أرسل رقم محفظة Payeer (مثل: P12345678):');
});

// ====== قائمة المهام ======
bot.hears('📝 مهام', async (ctx) => {
  const tasks = await client.query('SELECT * FROM tasks');
  if (tasks.rows.length === 0) return ctx.reply('لا توجد مهام حالياً.');
  const buttons = tasks.rows.map(t => [Markup.button.callback(t.title, `task_${t.id}`)]);
  await ctx.reply('اختر مهمة:', Markup.inlineKeyboard(buttons));
});

bot.action(/task_(\d+)/, async (ctx) => {
  const taskId = ctx.match[1];
  const task = await client.query('SELECT * FROM tasks WHERE id=$1', [taskId]);
  if (task.rows.length === 0) return ctx.reply('المهمة غير موجودة.');
  const t = task.rows[0];
  ctx.session.currentTask = t.id;
  await ctx.reply(`📌 ${t.title}\n${t.description}\n\nأرسل إثبات التنفيذ:`);
});

bot.on('text', async (ctx, next) => {
  if (ctx.session?.currentTask) {
    const taskId = ctx.session.currentTask;
    const proof = ctx.message.text;
    await client.query('INSERT INTO task_submissions (user_id, task_id, proof) VALUES ($1,$2,$3)', [ctx.from.id, taskId, proof]);
    ctx.session.currentTask = null;
    return ctx.reply('✅ تم إرسال إثبات المهمة للأدمن.');
  }
  if (ctx.session?.awaiting_withdraw) {
    if (!/^P\d{8,}$/i.test(ctx.message.text)) return ctx.reply('رقم محفظة غير صالح.');
    const res = await client.query('SELECT balance FROM users WHERE telegram_id=$1', [ctx.from.id]);
    const balance = parseFloat(res.rows[0]?.balance || 0);
    if (balance < 1) return ctx.reply('رصيدك أقل من الحد الأدنى 1$.');
    await client.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1,$2,$3)', [ctx.from.id, balance, ctx.message.text.toUpperCase()]);
    await client.query('UPDATE users SET balance=0 WHERE telegram_id=$1', [ctx.from.id]);
    ctx.session.awaiting_withdraw = false;
    return ctx.reply(`✅ تم تقديم طلب السحب ${balance.toFixed(2)}$`);
  }
  return next();
});

// ====== أوامر الأدمن ======
bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => { ctx.session = {}; await ctx.reply('✅ خرجت من لوحة الأدمن'); });

// تشغيل البوت
(async () => { try { await connectDB(); await initSchema(); await bot.launch(); console.log('✅ البوت شُغّل بنجاح'); } catch (e) { console.error(e); } })();
