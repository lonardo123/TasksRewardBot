const { Telegraf } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();
const express = require('express');

// === 1. رابط قاعدة البيانات ===
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:fdpGAaEUuSWDZXNJLLlqncuImnPLaviu@switchback.proxy.rlwy.net:49337/railway';

console.log('🔧 محاولة الاتصال بقاعدة البيانات...');

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// === 2. الاتصال وإنشاء الجداول ===
async function connectDB() {
  try {
    await client.connect();
    console.log('✅ اتصال قاعدة البيانات ناجح');

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        balance DECIMAL(10,2) DEFAULT 0,
        payeer_wallet VARCHAR,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS earnings (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        source VARCHAR(50),
        amount DECIMAL(10,2),
        description TEXT,
        timestamp TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT,
        amount DECIMAL(10,2),
        payeer_wallet VARCHAR,
        status VARCHAR(20) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP,
        admin_note TEXT
      );
    `);
    console.log('✅ الجداول أُنشئت أو موجودة مسبقًا');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    setTimeout(connectDB, 5000);
  }
}

// === 3. تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN || '8488029999:AAHvdbfzkB945mbr3_SvTSunGjlhMQvraMs');

// --- أوامر المستخدمين ---

// أمر /start
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const firstName = ctx.from.first_name;

  try {
    let res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    let balance = 0;

    if (res.rows.length > 0) {
      balance = parseFloat(res.rows[0].balance) || 0;
    } else {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, $2)', [userId, 0]);
    }

    await ctx.replyWithHTML(
      `👋 أهلاً بك، <b>${firstName}</b>!\n\n` +
      `💰 <b>رصيدك الحالي:</b> ${balance.toFixed(2)}$\n\n` +
      `اختر خيارًا من القائمة أدناه:`,
      {
        reply_markup: {
          keyboard: [
            ['💰 رصيدك', '🎁 مصادر الربح'],
            ['📤 طلب سحب']
          ],
          resize_keyboard: true
        }
      }
    );
  } catch (err) {
    console.error('❌ خطأ في /start:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
});

// 💰 رصيدك
bot.hears('💰 رصيدك', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    await ctx.replyWithHTML(`💰 <b>رصيدك:</b> ${balance.toFixed(2)}$`);
  } catch (err) {
    console.error('❌ جلب الرصيد:', err);
    await ctx.reply('حدث خطأ.');
  }
});

// 🎁 مصادر الربح
bot.hears('🎁 مصادر الربح', (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.example.com/?user_id=${userId}`;
  const cpaleadUrl = `https://cpalead.com/myoffers.php?user_id=${userId}`;

  ctx.reply(
    'اختر مصدر ربح:',
    {
      inline_keyboard: [
        [{ text: '🕒 TimeWall', url: timewallUrl }],
        [{ text: '📊 cpalead', url: cpaleadUrl }]
      ]
    }
  );
});

// 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    const MIN_WITHDRAW = parseFloat(process.env.MIN_WITHDRAW || 1.0);

    if (balance < MIN_WITHDRAW) {
      return ctx.reply(`❌ الحد الأدنى للسحب هو ${MIN_WITHDRAW}$. رصيدك: ${balance.toFixed(2)}$`);
    }

    await ctx.reply(`🟢 رصيدك مؤهل للسحب.\nأرسل رقم محفظة Payeer (مثل: P12345678):`);
    ctx.session = { awaiting_withdraw: true };
  } catch (err) {
    console.error('❌ طلب سحب:', err);
    await ctx.reply('حدث خطأ داخلي.');
  }
});

// معالجة رقم Payeer
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  // معالجة طلب السحب
  if (ctx.session?.awaiting_withdraw) {
    if (!/^P\d{8,}$/.test(text)) {
      return ctx.reply('❌ رقم محفظة غير صالح. يجب أن يبدأ بـ P ويحتوي على 8 أرقام على الأقل.');
    }

    const userId = ctx.from.id;
    const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const amount = parseFloat(userRes.rows[0]?.balance) || 0;

    await client.query(
      'INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)',
      [userId, amount, text]
    );
    await client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

    await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${amount.toFixed(2)}$.`);
    ctx.session.awaiting_withdraw = false;
    return;
  }

  // لوحة الأدمن: تعديل الحد الأدنى
  if (ctx.session?.awaiting_min_withdraw) {
    const newMin = parseFloat(text);
    if (isNaN(newMin) || newMin < 0.1) {
      return ctx.reply('❌ أدخل قيمة صحيحة (مثلاً: 1.00)');
    }
    process.env.MIN_WITHDRAW = newMin.toFixed(2);
    await ctx.reply(`✅ تم تعديل الحد الأدنى للسحب إلى ${newMin.toFixed(2)}$`);
    ctx.session.awaiting_min_withdraw = false;
    return;
  }
});

// === 🔐 لوحة الأدمن ===

// أمر /admin
bot.command('admin', async (ctx) => {
  const userId = ctx.from.id;

  if (userId.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('❌ ليس لديك صلاحيات الوصول إلى لوحة الأدمن.');
  }

  ctx.session.isAdmin = true;
  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن', {
    reply_markup: {
      keyboard: [
        ['📋 عرض الطلبات'],
        ['📊 الإحصائيات'],
        ['🔧 تعديل الحد الأدنى'],
        ['🚪 خروج من لوحة الأدمن']
      ],
      resize_keyboard: true
    }
  });
});

// معالجة خيارات الأدمن
bot.hears('📋 عرض الطلبات', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID || !ctx.session?.isAdmin) return;

  const res = await client.query(
    'SELECT * FROM withdrawals WHERE status = $1 ORDER BY requested_at DESC',
    ['pending']
  );

  if (res.rows.length === 0) {
    await ctx.reply('✅ لا توجد طلبات معلقة.');
  } else {
    for (const req of res.rows) {
      await ctx.reply(
        `طلب سحب #${req.id}\n` +
        `👤 المستخدم: ${req.user_id}\n` +
        `💵 المبلغ: ${req.amount}$\n` +
        `💳 Payeer: ${req.payeer_wallet}\n` +
        `📅 ${req.requested_at.toISOString().split('T')[0]}\n\n` +
        `لقبول: /pay ${req.id}\nلرفض: /reject ${req.id}`,
        { reply_markup: { remove_keyboard: true } }
      );
    }
  }
});

bot.hears('📊 الإحصائيات', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID || !ctx.session?.isAdmin) return;

  const [users, earnings, paid, pending] = await Promise.all([
    client.query('SELECT COUNT(*) FROM users'),
    client.query('SELECT COALESCE(SUM(amount), 0) FROM earnings'),
    client.query('SELECT COALESCE(SUM(amount), 0) FROM withdrawals WHERE status = $1', ['paid']),
    client.query('SELECT COUNT(*) FROM withdrawals WHERE status = $1', ['pending'])
  ]);

  await ctx.reply(
    `📈 <b>الإحصائيات</b>\n\n` +
    `👥 عدد المستخدمين: <b>${users.rows[0].count}</b>\n` +
    `💰 الأرباح الموزعة: <b>${earnings.rows[0].sum.toFixed(2)}$</b>\n` +
    `📤 المدفوعات: <b>${paid.rows[0].sum.toFixed(2)}$</b>\n` +
    `⏳ طلبات معلقة: <b>${pending.rows[0].count}</b>`,
    { parse_mode: 'HTML' }
  );
});

bot.hears('🔧 تعديل الحد الأدنى', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID || !ctx.session?.isAdmin) return;

  await ctx.reply(`الحد الحالي: ${process.env.MIN_WITHDRAW || 1.00}$. أرسل القيمة الجديدة:`);
  ctx.session.awaiting_min_withdraw = true;
});

bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID || !ctx.session?.isAdmin) return;

  ctx.session.isAdmin = false;
  ctx.session.awaiting_min_withdraw = false;
  await ctx.reply('✅ خرجت من لوحة الأدمن.', {
    reply_markup: {
      keyboard: [
        ['💰 رصيدك', '🎁 مصادر الربح'],
        ['📤 طلب سحب']
      ],
      resize_keyboard: true
    }
  });
});

// أمر: /pay (قبول)
bot.command('pay', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const match = ctx.message.text.match(/\/pay\s+(\d+)/);
  if (!match) return;

  const id = match[1];
  const res = await client.query(
    'SELECT * FROM withdrawals WHERE id = $1 AND status = $2',
    [id, 'pending']
  );

  if (res.rows.length === 0) {
    return ctx.reply('❌ الطلب غير موجود أو تم معالجته.');
  }

  const req = res.rows[0];
  await client.query(
    'UPDATE withdrawals SET status = $1, processed_at = NOW() WHERE id = $2',
    ['paid', id]
  );

  await ctx.reply(`✅ تم قبول طلب السحب #${id}`);
  try {
    await ctx.telegram.sendMessage(req.user_id, `🎉 تم قبول طلب سحبك بقيمة ${req.amount}$.`);
  } catch (e) {}
});

// أمر: /reject (رفض)
bot.command('reject', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const match = ctx.message.text.match(/\/reject\s+(\d+)/);
  if (!match) return;

  const id = match[1];
  const res = await client.query(
    'SELECT * FROM withdrawals WHERE id = $1 AND status = $2',
    [id, 'pending']
  );

  if (res.rows.length === 0) {
    return ctx.reply('❌ الطلب غير موجود أو تم معالجته.');
  }

  const req = res.rows[0];
  await client.query(
    'UPDATE withdrawals SET status = $1, processed_at = NOW(), admin_note = $2 WHERE id = $3',
    ['rejected', 'تم الرفض من قبل الأدمن', id]
  );

  await ctx.reply(`❌ تم رفض طلب السحب #${id}`);
  try {
    await ctx.telegram.sendMessage(req.user_id, `❌ تم رفض طلب سحبك.`);
  } catch (e) {}
});

// === 4. تشغيل السيرفر ===
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! البوت نشط.');
});

app.get('/callback', async (req, res) => {
  const { user_id, amount, offer, secret } = req.query;
  if (secret !== process.env.CALLBACK_SECRET) return res.status(403).send('Forbidden');

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).send('Invalid amount');

  try {
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [parsedAmount, user_id]);
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'offer', parsedAmount, offer || 'Offer Completed']
    );

    try {
      await bot.telegram.sendMessage(user_id, `🎉 حصلت على ${parsedAmount.toFixed(2)}$ من مهمة!`);
    } catch (e) {}

    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Error');
  }
});

// === 5. التشغيل النهائي ===
(async () => {
  try {
    await connectDB();

    // تشغيل البوت مع تجاهل الأخطاء التي توقف السيرفر
    bot.launch().catch(err => {
      console.error('⚠️ [Bot] فشل في التشغيل (قد يكون 409)، لكن السيرفر مستمر:', err.message);
    });

    // تشغيل السيرفر بغض النظر عن حالة البوت
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
    });

  } catch (error) {
    console.error('❌ خطأ عام في التشغيل:', error);

    // حتى لو فشل، نحاول تشغيل السيرفر
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`⚠️ السيرفر يعمل على ${PORT} رغم خطأ في البوت`);
    });
  }
})();
