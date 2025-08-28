const { Telegraf, session, Markup } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

// ====== Debug env ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);

// ====== Postgres client ======
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function connectDB() {
  try {
    await client.connect();
    console.log('✅ bot.js: اتصال قاعدة البيانات ناجح');
  } catch (err) {
    console.error('❌ bot.js: فشل الاتصال:', err.message);
    setTimeout(connectDB, 5000);
  }
}

// ====== Initialize Schema ======
async function initSchema() {
  try {
    // جدول المستخدمين
    await client.query(`CREATE TABLE IF NOT EXISTS users (telegram_id BIGINT PRIMARY KEY, balance NUMERIC(12,6) DEFAULT 0)`);

    // جدول الإحالات
    await client.query(`CREATE TABLE IF NOT EXISTS referrals (id SERIAL PRIMARY KEY, referrer_id BIGINT NOT NULL, referee_id BIGINT NOT NULL UNIQUE, created_at TIMESTAMP DEFAULT NOW())`);

    // جدول أرباح الإحالة
    await client.query(`CREATE TABLE IF NOT EXISTS referral_earnings (id SERIAL PRIMARY KEY, referrer_id BIGINT NOT NULL, referee_id BIGINT NOT NULL, amount NUMERIC(12,6) NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);

    // جدول طلبات السحب
    await client.query(`CREATE TABLE IF NOT EXISTS withdrawals (id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, amount NUMERIC(12,6) NOT NULL, payeer_wallet TEXT NOT NULL, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);

    // جدول المهمات
    await client.query(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT, reward NUMERIC(12,6) NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);

    // جدول إثباتات تنفيذ المهام
    await client.query(`CREATE TABLE IF NOT EXISTS task_submissions (id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, proof TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);

    console.log('✅ initSchema: جميع الجداول جاهزة');
  } catch (e) {
    console.error('❌ initSchema:', e);
  }
}

// ====== Bot setup ======
if (!process.env.BOT_TOKEN) { console.error('❌ BOT_TOKEN غير موجود في ملف .env'); process.exit(1); }
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Logger
bot.use((ctx, next) => {
  const from = ctx.from ? `${ctx.from.id} (${ctx.from.username || ctx.from.first_name})` : 'unknown';
  const text = ctx.message?.text || ctx.updateType;
  console.log('📩', from, '→', text);
  return next();
});

// Utility: ensure admin
const isAdmin = (ctx) => String(ctx.from?.id) === String(process.env.ADMIN_ID);

// ====== Referral Bonus 5% ======
async function applyReferralBonus(earnerId, earnedAmount) {
  try {
    const ref = await client.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [earnerId]);
    if (ref.rows.length === 0) return;
    const referrerId = ref.rows[0].referrer_id;
    if (!referrerId || Number(referrerId) === Number(earnerId)) return;
    const bonus = Number(earnedAmount) * 0.05;
    if (bonus <= 0) return;
    const balRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [referrerId]);
    if (balRes.rows.length === 0) await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [referrerId, 0]);
    await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [bonus, referrerId]);
    await client.query('INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)', [referrerId, earnerId, bonus]);
  } catch (e) { console.error('❌ applyReferralBonus:', e); }
}

// ====== Start / Register ======
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name || '';
  try {
    let res = await client.query('SELECT balance FROM users WHERE telegram_id=$1', [userId]);
    let balance = 0;
    if (res.rows.length > 0) balance = parseFloat(res.rows[0].balance) || 0;
    else await client.query('INSERT INTO users (telegram_id,balance) VALUES($1,$2)', [userId,0]);

    // لوحة المستخدم مع زر مهام
    await ctx.replyWithHTML(`👋 أهلاً بك، <b>${firstName}</b>!
💰 رصيدك: <b>${balance.toFixed(4)}$</b>`,
      Markup.keyboard([
        ['💰 رصيدك','🎁 مصادر الربح'],
        ['📤 طلب سحب','👥 ريفيرال'],
        ['📝 مهام']
      ]).resize()
    );
  } catch (err) { console.error('❌ /start:', err); await ctx.reply('حدث خطأ داخلي.'); }
});

// ====== User Tasks ======
bot.hears('📝 مهام', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT * FROM tasks ORDER BY id DESC');
    if (!res.rows.length) return ctx.reply('📋 لا توجد مهام متاحة حالياً.');
    const buttons = res.rows.map(task => [Markup.button.callback(`${task.title} - ${task.reward}$`, `task_${task.id}`)]);
    await ctx.reply('اختر المهمة لعرض التفاصيل:', Markup.inlineKeyboard(buttons));
  } catch (err) { console.error('❌ عرض المهمات:', err); await ctx.reply('حدث خطأ أثناء جلب المهمات.'); }
});

bot.action(/task_(\d+)/, async (ctx) => {
  const taskId = ctx.match[1];
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT * FROM tasks WHERE id=$1', [taskId]);
    if (!res.rows.length) return ctx.answerCbQuery('❌ المهمة غير موجودة.');
    const task = res.rows[0];
    ctx.session.currentTask = taskId;
    await ctx.replyWithHTML(`<b>${task.title}</b>\n\n${task.description}\n\n📝 اكتب إثباتك هنا:`);
  } catch (err) { console.error('❌ task details:', err); await ctx.reply('حدث خطأ أثناء عرض المهمة.'); }
});

bot.on('text', async (ctx, next) => {
  if (ctx.session.currentTask) {
    const userId = ctx.from.id;
    const taskId = ctx.session.currentTask;
    const proof = ctx.message.text;
    try {
      await client.query('INSERT INTO task_submissions (user_id, task_id, proof) VALUES ($1,$2,$3)', [userId, taskId, proof]);
      ctx.session.currentTask = null;
      return ctx.reply('✅ تم إرسال إثبات المهمة للأدمن. شكراً لك!');
    } catch (err) { console.error('❌ إرسال إثبات:', err); return ctx.reply('حدث خطأ أثناء إرسال الإثبات.'); }
  } else return next();
});

// ====== Admin: Add Task ======
bot.hears('➕ إضافة مهمة جديدة', async (ctx) => {
  if (!isAdmin(ctx)) return;
  ctx.session.awaitingTask = true;
  ctx.session.taskStep = 'title';
  ctx.session.taskData = {};
  await ctx.reply('📝 اكتب اسم المهمة الجديدة:');
});

bot.on('text', async (ctx, next) => {
  if (!ctx.session.awaitingTask) return next();
  const step = ctx.session.taskStep;
  const text = ctx.message.text;
  if (step === 'title') { ctx.session.taskData.title = text; ctx.session.taskStep='description'; return ctx.reply('📄 اكتب وصف المهمة:'); }
  if (step === 'description') { ctx.session.taskData.description=text; ctx.session.taskStep='reward'; return ctx.reply('💰 اكتب سعر المهمة بالدولار:'); }
  if (step === 'reward') {
    const reward=parseFloat(text); if(isNaN(reward)) return ctx.reply('❌ السعر غير صالح. حاول مرة أخرى.');
    ctx.session.taskData.reward=reward;
    try {
      await client.query('INSERT INTO tasks (title,description,reward) VALUES($1,$2,$3)', [ctx.session.taskData.title,ctx.session.taskData.description,ctx.session.taskData.reward]);
      await ctx.reply('✅ تم إضافة المهمة بنجاح.');
    } catch(err){console.error('❌ إضافة مهمة:',err); await ctx.reply('حدث خطأ أثناء إضافة المهمة.');}
    ctx.session.awaitingTask=false; ctx.session.taskStep=null; ctx.session.taskData=null;
  }
});

// ====== Admin: Review Task Submissions ======
bot.hears('📝 إثباتات مهمات المستخدمين', async (ctx)=>{
  if(!isAdmin(ctx)) return;
  try{
    const res=await client.query(`SELECT ts.id,ts.user_id,ts.proof,ts.status,t.title,t.reward FROM task_submissions ts JOIN tasks t ON ts.task_id=t.id WHERE ts.status='pending' ORDER BY ts.created_at DESC`);
    if(!res.rows.length) return ctx.reply('📋 لا توجد إثباتات جديدة.');
    for(const row of res.rows){
      await ctx.reply(`👤 المستخدم: ${row.user_id}\n🏷 المهمة: ${row.title}\n💰 السعر: ${row.reward}$\n📝 الإثبات: ${row.proof}\n\n✅ قبول: /accept_task ${row.id}\n⛔ رفض: /reject_task ${row.id}`);
    }
  }catch(err){console.error('❌ جلب إثباتات المهمات:',err); await ctx.reply('حدث خطأ أثناء جلب الإثباتات.');}
});

bot.command('accept_task', async (ctx)=>{
  if(!isAdmin(ctx)) return;
  const id=parseInt(ctx.message.text.split(' ')[1]);
  try{
    const res=await client.query('SELECT * FROM task_submissions WHERE id=$1',[id]);
    if(!res.rows.length) return ctx.reply('❌ الإثبات غير موجود.');
    const submission=res.rows[0];
    const taskRes=await client.query('SELECT reward FROM tasks WHERE id=$1',[submission.task_id]);
    const reward=parseFloat(taskRes.rows[0].reward);
    await client.query('UPDATE users SET balance=COALESCE(balance,0)+$1 WHERE telegram_id=$2',[reward,submission.user_id]);
    await applyReferralBonus(submission.user_id,reward);
    await client.query('UPDATE task_submissions SET status=$1 WHERE id=$2',['accepted',id]);
    await ctx.reply(`✅ تم قبول المهمة وإضافة ${reward}$ للمستخدم ${submission.user_id}`);
  }catch(err){console.error('❌ قبول إثبات المهمة:',err); await ctx.reply('حدث خطأ أثناء قبول المهمة.');}
});

bot.command('reject_task', async (ctx)=>{
  if(!isAdmin(ctx)) return;
  const id=parseInt(ctx.message.text.split(' ')[1]);
  try{
    await client.query('UPDATE task_submissions SET status=$1 WHERE id=$2',['rejected',id]);
    await ctx.reply(`⛔ تم رفض المهمة #${id}`);
  }catch(err){console.error('❌ رفض المهمة:',err); await ctx.reply('حدث خطأ أثناء رفض المهمة.');}
});

// ==================== تشغيل البوت ====================
(async()=>{
  try{
    await connectDB();
    await initSchema();
    await bot.launch();
    console.log('✅ bot.js: البوت شُغّل بنجاح');
    process.once('SIGINT',()=>{ bot.stop('SIGINT'); client.end().then(()=>console.log('🗄️ Postgres connection closed.')); });
    process.once('SIGTERM',()=>{ bot.stop('SIGTERM'); client.end().then(()=>console.log('🗄️ Postgres connection closed.')); });
  }catch(error){console.error('❌ فشل في التشغيل:',error);}
})();
