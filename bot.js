// bot.js بعد دمج جميع تعديلات المهمات TasksRewardBot بالكامل

const { Telegraf, session, Markup } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();

console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
console.log('🎯 ADMIN_ID المحدد:', process.env.ADMIN_ID);

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

async function initSchema() {
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                telegram_id BIGINT PRIMARY KEY,
                balance NUMERIC(12,6) DEFAULT 0
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                referrer_id BIGINT NOT NULL,
                referee_id BIGINT NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS referral_earnings (
                id SERIAL PRIMARY KEY,
                referrer_id BIGINT NOT NULL,
                referee_id BIGINT NOT NULL,
                amount NUMERIC(12,6) NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        await client.query(`
            CREATE TABLE IF NOT EXISTS withdrawals (
                id SERIAL PRIMARY KEY,
                user_id BIGINT NOT NULL,
                amount NUMERIC(12,6) NOT NULL,
                payeer_wallet TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        // جدول المهام
        await client.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                reward NUMERIC(12,6) NOT NULL
            );
        `);
        // جدول إثباتات المهمات
        await client.query(`
            CREATE TABLE IF NOT EXISTS task_proofs (
                id SERIAL PRIMARY KEY,
                task_id INT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                user_id BIGINT NOT NULL,
                proof TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ initSchema: تم تجهيز جميع الجداول');
    } catch (e) {
        console.error('❌ initSchema:', e);
    }
}

if (!process.env.BOT_TOKEN) {
    console.error('❌ BOT_TOKEN غير موجود في ملف .env');
    process.exit(1);
}

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

bot.use((ctx, next) => {
    const from = ctx.from ? `${ctx.from.id} (${ctx.from.username || ctx.from.first_name})` : 'unknown';
    const text = ctx.message?.text || ctx.updateType;
    console.log('📩', from, '→', text);
    return next();
});

const isAdmin = (ctx) => String(ctx.from?.id) === String(process.env.ADMIN_ID);

async function applyReferralBonus(earnerId, earnedAmount) {
    try {
        const ref = await client.query('SELECT referrer_id FROM referrals WHERE referee_id = $1', [earnerId]);
        if (ref.rows.length === 0) return;
        const referrerId = ref.rows[0].referrer_id;
        if (!referrerId || Number(referrerId) === Number(earnerId)) return;
        const bonus = Number(earnedAmount) * 0.05;
        if (bonus <= 0) return;
        await client.query('UPDATE users SET balance = COALESCE(balance,0) + $1 WHERE telegram_id = $2', [bonus, referrerId]);
        await client.query('INSERT INTO referral_earnings (referrer_id, referee_id, amount) VALUES ($1,$2,$3)', [referrerId, earnerId, bonus]);
        console.log(`🎉 إحالة: أضيفت مكافأة ${bonus.toFixed(4)}$ للمحيل ${referrerId}`);
    } catch (e) {
        console.error('❌ applyReferralBonus:', e);
    }
}

// ----------------------- START / START PAYLOAD -----------------------
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name || '';
    try {
        let payload = null;
        if (ctx.startPayload) payload = ctx.startPayload;
        else if (ctx.message?.text?.includes('/start')) payload = ctx.message.text.split(' ')[1] || null;

        let res = await client.query('SELECT balance FROM users WHERE telegram_id=$1', [userId]);
        let balance = 0;
        if (res.rows.length > 0) balance = parseFloat(res.rows[0].balance) || 0;
        else await client.query('INSERT INTO users (telegram_id,balance) VALUES ($1,$2)', [userId,0]);

        if (payload && /^ref_\d+$/i.test(payload)) {
            const referrerId = Number(payload.replace(/ref_/i,''));
            if (referrerId && referrerId !== userId) {
                const exists = await client.query('SELECT 1 FROM referrals WHERE referee_id=$1', [userId]);
                if (exists.rows.length===0) {
                    await client.query('INSERT INTO referrals (referrer_id, referee_id) VALUES ($1,$2)', [referrerId, userId]);
                }
            }
        }

        await ctx.replyWithHTML(`👋 أهلاً بك، <b>${firstName}</b>!\n💰 رصيدك: ${balance.toFixed(4)}$`,
            Markup.keyboard([
                ['💰 رصيدك','🎁 مصادر الربح'],
                ['📤 طلب سحب','👥 ريفيرال'],
                ['📝 مهمات TasksRewardBot']
            ]).resize()
        );
    } catch (err) {
        console.error('❌ /start:', err);
        await ctx.reply('حدث خطأ داخلي.');
    }
});

// ----------------------- مهمات TasksRewardBot -----------------------
bot.hears('📝 مهمات TasksRewardBot', async (ctx) => {
    const tasks = await client.query('SELECT * FROM tasks');
    if (tasks.rows.length===0) return ctx.reply('🚫 لا توجد مهمات حالياً.');
    const buttons = tasks.rows.map(t => [Markup.button.callback(`${t.title} - $${t.reward}`, `task_${t.id}`)]);
    await ctx.reply('📋 اختر المهمة لتنفيذها:', Markup.inlineKeyboard(buttons));
});

bot.action(/task_(\d+)/, async (ctx) => {
    const taskId = ctx.match[1];
    const taskRes = await client.query('SELECT * FROM tasks WHERE id=$1',[taskId]);
    if (!taskRes.rows[0]) return ctx.reply('🚫 المهمة غير موجودة.');
    const task = taskRes.rows[0];
    ctx.session.currentTask = task.id;
    await ctx.replyWithHTML(`<b>${task.title}</b>\n\n${task.description}\n\n💡 الرجاء إرسال إثبات تنفيذ المهمة:`);
});

bot.on('text', async (ctx, next) => {
    if (ctx.session.currentTask) {
        const taskId = ctx.session.currentTask;
        const userId = ctx.from.id;
        const proofText = ctx.message.text;
        await client.query('INSERT INTO task_proofs (task_id,user_id,proof) VALUES ($1,$2,$3)',[taskId,userId,proofText]);
        await ctx.reply('✅ تم إرسال إثبات المهمة، بانتظار مراجعة الأدمن.');
        delete ctx.session.currentTask;
    } else next();
});

// ----------------------- لوحة الأدمن: إضافة مهمة -----------------------
bot.hears('➕ إضافة مهمة جديدة', async (ctx) => {
    if (!isAdmin(ctx)) return;
    ctx.session.awaitingNewTask = true;
    ctx.session.newTaskStep = 0;
    await ctx.reply('📝 ارسل اسم المهمة الجديد:');
});

bot.on('text', async (ctx, next) => {
    if (!ctx.session.awaitingNewTask) return next();
    if (ctx.session.newTaskStep===0) { ctx.session.newTaskTitle = ctx.message.text; ctx.session.newTaskStep=1; return ctx.reply('✏️ ارسل وصف المهمة:'); }
    if (ctx.session.newTaskStep===1) { ctx.session.newTaskDescription = ctx.message.text; ctx.session.newTaskStep=2; return ctx.reply('💰 ارسل سعر المهمة بالدولار:'); }
    if (ctx.session.newTaskStep===2) {
        const reward = parseFloat(ctx.message.text);
        if (isNaN(reward)) return ctx.reply('❌ المبلغ غير صالح. ارسل رقم صحيح.');
        await client.query('INSERT INTO tasks (title,description,reward) VALUES ($1,$2,$3)',[ctx.session.newTaskTitle,ctx.session.newTaskDescription,reward]);
        await ctx.reply(`✅ تم إنشاء المهمة: ${ctx.session.newTaskTitle}`);
        ctx.session.awaitingNewTask=false; ctx.session.newTaskStep=null;
    }
});

// ----------------------- لوحة الأدمن: إثباتات المستخدمين -----------------------
bot.hears('📝 إثباتات مهمات المستخدمين', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const proofs = await client.query('SELECT tp.*, t.title, u.telegram_id FROM task_proofs tp JOIN tasks t ON t.id=tp.task_id JOIN users u ON u.telegram_id=tp.user_id WHERE tp.status=$1',['pending']);
    if (proofs.rows.length===0) return ctx.reply('🚫 لا توجد إثباتات معلقة.');
    for (const p of proofs.rows) {
        await ctx.replyWithHTML(`<b>مهمة:</b> ${p.title}\n<b>المستخدم:</b> ${p.telegram_id}\n<b>الإثبات:</b>\n${p.proof}\n\nللقبول: /accept_task ${p.id}\nللرفض: /reject_task ${p.id}`);
    }
});

bot.command('accept_task', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const id = Number(ctx.message.text.split(' ')[1]);
    const proof = await client.query('SELECT * FROM task_proofs WHERE id=$1',[id]);
    if (!proof.rows[0]) return ctx.reply('❌ الإثبات غير موجود.');
    const taskId = proof.rows[0].task_id;
    const userId = proof.rows[0].user_id;
    const taskRes = await client.query('SELECT reward FROM tasks WHERE id=$1',[taskId]);
    const reward = parseFloat(taskRes.rows[0].reward);
    await client.query('UPDATE users SET balance=COALESCE(balance,0)+$1 WHERE telegram_id=$2',[reward,userId]);
    await applyReferralBonus(userId,reward);
    await client.query('UPDATE task_proofs SET status=$1 WHERE id=$2',['accepted',id]);
    await ctx.reply(`✅ تم قبول إثبات المهمة وإضافة $${reward} للمستخدم ${userId}`);
});

bot.command('reject_task', async (ctx) => {
    if (!isAdmin(ctx)) return;
    const id = Number(ctx.message.text.split(' ')[1]);
    await client.query('UPDATE task_proofs SET status=$1 WHERE id=$2',['rejected',id]);
    await ctx.reply(`⛔ تم رفض إثبات المهمة #${id}`);
});

// ----------------------- تشغيل البوت -----------------------
(async () => {
    try {
        await connectDB();
        await initSchema();
        await bot.launch();
        console.log('✅ bot.js: البوت شُغّل بنجاح');
        process.once('SIGINT', () => { bot.stop('SIGINT'); client.end(); });
        process.once('SIGTERM', () => { bot.stop('SIGTERM'); client.end(); });
    } catch (error) {
        console.error('❌ فشل في التشغيل:', error);
    }
})();
