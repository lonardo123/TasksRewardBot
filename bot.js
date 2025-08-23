const { Telegraf } = require('telegraf');
const { Client } = require('pg');
require('dotenv').config();
const express = require('express');
console.log('🔐 السر المستخدم:', process.env.CALLBACK_SECRET ? 'تم تعيينه' : 'مفقود!');
console.log('🤖 BOT_TOKEN:', process.env.BOT_TOKEN ? 'موجود' : 'مفقود!');
console.log('🆔 ADMIN_ID:', process.env.ADMIN_ID || 'مفقود!');
console.log('🗄 DATABASE_URL:', process.env.DATABASE_URL ? 'موجود' : 'مفقود!');
// === 1. قاعدة البيانات ===
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:fdpGAaEUuSWDZXNJLLlqncuImnPLaviu@switchback.proxy.rlwy.net:49337/railway';

console.log('🔧 محاولة الاتصال بقاعدة البيانات...');

const client = new Client({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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
  }
}

// === 2. تشغيل البوت ===
const bot = new Telegraf(process.env.BOT_TOKEN || '8488029999:AAHvdbfzkB945mbr3_SvTSunGjlhMQvraMs');

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
      `💰 <b>رصيدك:</b> ${balance.toFixed(2)}$\n\n` +
      `اختر خيارًا:`,
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
    await ctx.replyWithHTML(`💰 رصيدك: <b>${balance.toFixed(2)}$</b>`);
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
});

// 🎁 مصادر الربح
bot.hears('🎁 مصادر الربح', (ctx) => {
  const userId = ctx.from.id;
  const timewallUrl = `https://timewall.example.com/?user_id=${userId}`;
  const cpaleadUrl = `https://cpalead.com/myoffers.php?user_id=${userId}`;
  ctx.reply('اختر مصدر ربح:', {
    inline_keyboard: [
      [{ text: '🕒 TimeWall', url: timewallUrl }],
      [{ text: '📊 cpalead', url: cpaleadUrl }]
    ]
  });
});

// 📤 طلب سحب
bot.hears('📤 طلب سحب', async (ctx) => {
  const userId = ctx.from.id;
  try {
    const res = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const balance = parseFloat(res.rows[0]?.balance) || 0;
    if (balance < 1.0) return ctx.reply(`❌ الحد الأدنى للسحب هو 1$. رصيدك: ${balance.toFixed(2)}$`);

    await ctx.reply(`أرسل رقم محفظة Payeer (P12345678):`);
    ctx.session = { awaiting_withdraw: true };
  } catch (err) {
    console.error(err);
    await ctx.reply('حدث خطأ.');
  }
});

// معالجة Payeer
bot.on('text', async (ctx) => {
  if (ctx.session?.awaiting_withdraw) {
    const wallet = ctx.message.text.trim();
    if (!/^P\d{8,}$/.test(wallet)) {
      return ctx.reply('❌ رقم غير صالح. يجب أن يبدأ بـ P ويحتوي على 8 أرقام على الأقل.');
    }

    const userId = ctx.from.id;
    const userRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [userId]);
    const amount = parseFloat(userRes.rows[0]?.balance) || 0;

    await client.query('INSERT INTO withdrawals (user_id, amount, payeer_wallet) VALUES ($1, $2, $3)', [userId, amount, wallet]);
    await client.query('UPDATE users SET balance = 0 WHERE telegram_id = $1', [userId]);

    await ctx.reply(`✅ تم تقديم طلب سحب بقيمة ${amount.toFixed(2)}$.`);
    ctx.session.awaiting_withdraw = false;
  }
});

// 🔐 لوحة الأدمن
bot.command('admin', async (ctx) => {
  const userId = ctx.from.id;

  if (userId.toString() !== process.env.ADMIN_ID) {
    return ctx.reply('❌ ليس لديك صلاحيات الأدمن.');
  }

  ctx.session.isAdmin = true;
  await ctx.reply('🔐 أهلاً بك في لوحة الأدمن', {
    reply_markup: {
      keyboard: [
        ['📋 عرض الطلبات'],
        ['📊 الإحصائيات'],
        ['🚪 خروج من لوحة الأدمن']
      ],
      resize_keyboard: true
    }
  });
});

// عرض الطلبات
bot.hears('📋 عرض الطلبات', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const res = await client.query('SELECT * FROM withdrawals WHERE status = $1', ['pending']);
  if (res.rows.length === 0) {
    await ctx.reply('✅ لا توجد طلبات معلقة.');
  } else {
    for (let req of res.rows) {
      await ctx.reply(`طلب #${req.id}\nالمستخدم: ${req.user_id}\nالمبلغ: ${req.amount}$\nPayeer: ${req.payeer_wallet}`);
    }
  }
});

// الإحصائيات
bot.hears('📊 الإحصائيات', async (ctx) => {
  if (ctx.from.id.toString() !== process.env.ADMIN_ID) return;

  const [users, earnings] = await Promise.all([
    client.query('SELECT COUNT(*) FROM users'),
    client.query('SELECT COALESCE(SUM(amount), 0) FROM earnings')
  ]);

  await ctx.reply(
    `📈 الإحصائيات:\n` +
    `👥 المستخدمين: ${users.rows[0].count}\n` +
    `💰 الأرباح: ${earnings.rows[0].sum.toFixed(2)}$`
  );
});

// خروج
bot.hears('🚪 خروج من لوحة الأدمن', async (ctx) => {
  ctx.session = {};
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

// === 3. Postback ===
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! البوت قد يعمل أو لا.');
});

app.get('/callback', async (req, res) => {
  const { user_id, amount, secret } = req.query;
console.log('🔐 السر المستلم:', secret);
  console.log('🔐 السر المخزن:', process.env.CALLBACK_SECRET);

  if (secret !== process.env.CALLBACK_SECRET) {
    console.log('🚫 سر خاطئ');
    return res.status(403).send('Forbidden: Invalid Secret');
  }
  // ✅ التحقق من السر
  if (secret !== process.env.CALLBACK_SECRET) {
    console.log(`🚫 سر خاطئ: ${secret}`);
    return res.status(403).send('Forbidden: Invalid Secret');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).send('Invalid amount');

  try {
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [parsedAmount, user_id]);
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'offer', parsedAmount, 'Offer Completed']
    );

    console.log(`🟢 أضيف ${parsedAmount}$ للمستخدم ${user_id}`);
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});

// === 4. التشغيل النهائي ===
(async () => {
  try {
    await connectDB();
  } catch (err) {
    console.error('❌ خطأ في قاعدة البيانات:', err);
  }

  // 🚫 لا تُوقف السيرفر إذا فشل البوت
  bot.launch().catch(err => {
    console.error('⚠️ [Telegraf] فشل في التشغيل (409)، لكن السيرفر مستمر:', err.message);
    // ❌ لا تُوقف العملية هنا
  });

  // ✅ السيرفر يعمل بغض النظر عن حالة البوت
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
  });

  // ❌ تجنب SIGTERM من Telegraf
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
  });

})();
