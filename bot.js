
// ====== BOT JS كامل بعد دمج كل التعديلات السابقة + نظام طلب السحب والأدمن ======
const { Telegraf, session, Markup } = require('telegraf'); 
const { Client } = require('pg');
require('dotenv').config();

// ====== Debug env ======
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');

// ====== Postgres client ======
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function connectDB() {
  try {
    await client.connect();
    console.log('✅ اتصال قاعدة البيانات ناجح');
  } catch (err) {
    console.error('❌ فشل الاتصال:', err.message);
    setTimeout(connectDB, 5000);
  }
}

// 🔵 إنشاء/تحديث الجداول
async function initSchema() {
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        balance DECIMAL(12,4) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        amount DECIMAL(12,4),
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id BIGINT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS referral_earnings (
        id SERIAL PRIMARY KEY,
        referrer_id BIGINT NOT NULL,
        referee_id BIGINT NOT NULL,
        amount NUMERIC(12,6) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT,
        description TEXT,
        reward DECIMAL(12,4),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS task_submissions (
        id SERIAL PRIMARY KEY,
        task_id INT,
        user_id BIGINT,
        proof TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ جميع الجداول جاهزة');
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

// Utility: ensure admin
const isAdmin = (ctx) => String(ctx.from?.id) === String(process.env.ADMIN_ID);

// 🔵 تطبيق مكافأة الإحالة
async function applyReferralBonus(earnerId, earnedAmount) {
  try {
    const ref = await client.query('SELECT referrer_id FROM referrals WHERE referee_id=$1', [earnerId]);
    if (ref.rows.length === 0) return;
    const referrerId = ref.rows[0].referrer_id;
    const bonus = earnedAmount * 0.05;
    if (bonus <= 0) return;
    await client.query('UPDATE users SET balance = COALESCE(balance,0)+$1 WHERE telegram_id=$2', [bonus, referrerId]);
    await client.query('INSERT INTO referral_earnings (referrer_id,referee_id,amount) VALUES($1,$2,$3)', [referrerId, earnerId, bonus]);
    console.log(`🎉 إحالة: أضيفت مكافأة ${bonus.toFixed(4)}$ للمحيل ${referrerId}`);
  } catch (e) { console.error('❌ applyReferralBonus:', e); }
}

// ====== /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  if (!ctx.session) ctx.session = {};
  const res = await client.query('SELECT balance FROM users WHERE telegram_id=$1',[userId]);
  if (res.rows.length===0) await client.query('INSERT INTO users (telegram_id,balance) VALUES($1,$2)',[userId,0]);
  const balance = res.rows.length>0 ? parseFloat(res.rows[0].balance||0):0;
  await ctx.replyWithHTML(`👋 أهلاً بك!
💰 رصيدك: <b>${balance.toFixed(4)}$</b>`,
    Markup.keyboard([
      ['💰 رصيدك','🎁 مصادر الربح'],
      ['📤 طلب سحب','👥 ريفيرال']
    ]).resize()
  );
});

// 💰 رصيدك
bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  const res = await client.query('SELECT balance FROM users WHERE telegram_id=$1',[userId]);
  const balance = parseFloat(res.rows[0]?.balance||0);
  await ctx.replyWithHTML(`💰 رصيدك: <b>${balance.toFixed(4)}$</b>`);
});

// 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  if (!ctx.session) ctx.session = {};
  ctx.session.awaitingWithdrawal = true;
  await ctx.reply('💸 ارسل المبلغ الذي تريد سحبه بالدولار:');
});

// 🛠 معالجة النصوص
bot.on('text', async (ctx,next)=>{
  if (!ctx.session) ctx.session={};
  if (ctx.session.awaitingWithdrawal){
    const amount=parseFloat(ctx.message.text);
    if(isNaN(amount)||amount<=0)return ctx.reply('❌ المبلغ غير صالح');
    const userId=ctx.from.id;
    const res=await client.query('SELECT balance FROM users WHERE telegram_id=$1',[userId]);
    const balance=parseFloat(res.rows[0]?.balance||0);
    if(amount>balance)return ctx.reply(`❌ رصيدك غير كافٍ. رصيدك الحالي: ${balance.toFixed(4)}$`);
    await client.query('INSERT INTO withdrawals(user_id,amount,status) VALUES($1,$2,$3)',[userId,amount,'pending']);
    await client.query('UPDATE users SET balance=balance-$1 WHERE telegram_id=$2',[amount,userId]);
    ctx.reply(`📤 تم تقديم طلب السحب بمبلغ ${amount}$، في انتظار موافقة الأدمن.`);
    ctx.session.awaitingWithdrawal=false;
    return;
  }
  return next();
});

// 🔐 لوحة الأدمن
bot.hears('📋 طلبات السحب', async (ctx)=>{
  if(!isAdmin(ctx))return ctx.reply('❌ وصول مرفوض');
  const res=await client.query('SELECT * FROM withdrawals ORDER BY id DESC LIMIT 20');
  if(!res.rows.length)return ctx.reply('✅ لا توجد طلبات حالياً');
  for(const w of res.rows){
    await ctx.reply(`👤 المستخدم: ${w.user_id}
💰 المبلغ: ${w.amount}$
📌 الحالة: ${w.status}
للموافقة: /approve_withdraw ${w.id}
للرفض: /reject_withdraw ${w.id}`);
  }
});
bot.command('approve_withdraw', async (ctx)=>{
  if(!isAdmin(ctx))return;
  const id=Number(ctx.message.text.split(' ')[1]);
  if(!id)return ctx.reply('استخدم: /approve_withdraw <ID>');
  await client.query('UPDATE withdrawals SET status=$1 WHERE id=$2',['approved',id]);
  ctx.reply(`✅ تم الموافقة على طلب السحب #${id}`);
});
bot.command('reject_withdraw', async (ctx)=>{
  if(!isAdmin(ctx))return;
  const id=Number(ctx.message.text.split(' ')[1]);
  if(!id)return ctx.reply('استخدم: /reject_withdraw <ID>');
  const res=await client.query('SELECT user_id,amount FROM withdrawals WHERE id=$1',[id]);
  const w=res.rows[0];
  if(w) await client.query('UPDATE users SET balance=balance+$1 WHERE telegram_id=$2',[w.amount,w.user_id]);
  await client.query('UPDATE withdrawals SET status=$1 WHERE id=$2',['rejected',id]);
  ctx.reply(`⛔ تم رفض طلب السحب #${id} وإعادة الرصيد`);
});

// ==================== التشغيل النهائي ====================
(async ()=>{
  try{
    await connectDB();
    await initSchema();
    await bot.launch();
    console.log('✅ البوت شُغّل بنجاح');
    process.once('SIGINT',()=>{bot.stop('SIGINT'); client.end();});
    process.once('SIGTERM',()=>{bot.stop('SIGTERM'); client.end();});
  }catch(e){console.error('❌ فشل التشغيل:',e);}
})();
