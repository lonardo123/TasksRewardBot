import express from "express";
import bodyParser from "body-parser";
import { Telegraf } from "telegraf";
import { Pool } from "pg";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(process.env.BOT_TOKEN);
const ADMIN_ID = process.env.ADMIN_CHAT_ID;

const isAdmin = (id) => String(id) === String(ADMIN_ID);

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  await pool.query(`INSERT INTO users (telegram_id) VALUES ($1) ON CONFLICT (telegram_id) DO NOTHING`, [telegramId]);
  ctx.reply("👋 أهلاً بك! اختر ما تريد:", { reply_markup: { inline_keyboard: [
      [{ text: "💰 TimeWall", url: `https://timewall.io/?subId=${telegramId}` }],
      [{ text: "🎯 CPAlead", url: `https://www.cpalead.com/offerwall?key=${process.env.CPALEAD_KEY}&subid=${telegramId}` }],
      [{ text: "🔻 طلب سحب", callback_data: "withdraw_start" }]
    ]}});
});

bot.action('withdraw_start', async (ctx) => {
  const res = await pool.query(`SELECT balance FROM users WHERE telegram_id=$1`, [ctx.from.id]);
  if (!res.rows.length) return ctx.answerCbQuery("خطأ: لم يتم العثور على حساب");
  const balance = parseFloat(res.rows[0].balance);
  if (balance < 1) return ctx.answerCbQuery("❌ الحد الأدنى للسحب $1");
  ctx.reply("📤 اكتب رقم حساب Payeer الخاص بك:");
});

bot.on('text', async (ctx) => {
  const userRes = await pool.query(`SELECT id, balance FROM users WHERE telegram_id=$1`, [ctx.from.id]);
  if (!userRes.rows.length) return;
  const user = userRes.rows[0];
  const text = ctx.message.text.trim();
  if (text.startsWith('P') || text.includes('@')) {
    await pool.query(`INSERT INTO withdrawals (user_id, amount) VALUES ($1,$2)`, [user.id, user.balance]);
    await ctx.reply("✅ تم إرسال طلب السحب للأدمن");
    await bot.telegram.sendMessage(ADMIN_ID,
      `📥 طلب سحب جديد\nUser: ${ctx.from.id}\nAmount: $${user.balance}\nPayeer: ${text}`,
      { reply_markup: { inline_keyboard: [
        [{ text: '✅ قبول', callback_data: `approve_${ctx.from.id}` }, { text: '❌ رفض', callback_data: `reject_${ctx.from.id}` }]
      ]}}
    );
  }
});

bot.action(/approve_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('ليست صلاحية لديك');
  const telegramId = ctx.match[1];
  const userRes = await pool.query(`SELECT id, balance FROM users WHERE telegram_id=$1`, [telegramId]);
  if (!userRes.rows.length) return ctx.answerCbQuery("خطأ: مستخدم غير موجود");
  const user = userRes.rows[0];
  await pool.query(`UPDATE users SET balance=0 WHERE id=$1`, [user.id]);
  await pool.query(`UPDATE withdrawals SET status='approved', handled_at=NOW(), admin_id=$1 WHERE user_id=$2 AND status='pending'`, [ctx.from.id, user.id]);
  await bot.telegram.sendMessage(telegramId, `✅ تمت الموافقة على طلب السحب بقيمة $${user.balance}`);
  ctx.answerCbQuery("تمت الموافقة");
});

bot.action(/reject_(.+)/, async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('ليست صلاحية لديك');
  const telegramId = ctx.match[1];
  const userRes = await pool.query(`SELECT id FROM users WHERE telegram_id=$1`, [telegramId]);
  if (!userRes.rows.length) return ctx.answerCbQuery("خطأ: مستخدم غير موجود");
  const user = userRes.rows[0];
  await pool.query(`UPDATE withdrawals SET status='rejected', handled_at=NOW(), admin_id=$1 WHERE user_id=$2 AND status='pending'`, [ctx.from.id, user.id]);
  await bot.telegram.sendMessage(telegramId, `❌ تم رفض طلب السحب الخاص بك`);
  ctx.answerCbQuery("تم الرفض");
});

app.get("/postback/timewall", async (req, res) => {
  try {
    const { userID, transactionID, revenue, currencyAmount, type, hash } = req.query;
    if (process.env.TIMEWALL_SECRET) {
      const checkHash = crypto.createHash("sha256").update(userID + revenue + process.env.TIMEWALL_SECRET).digest("hex");
      if (checkHash !== hash) return res.status(403).send("Invalid hash");
    }
    const userRes = await pool.query(`SELECT id FROM users WHERE telegram_id=$1`, [userID]);
    if (!userRes.rows.length) return res.status(400).send("User not found");
    const userId = userRes.rows[0].id;
    const txCheck = await pool.query(`SELECT id FROM transactions WHERE transaction_id=$1`, [transactionID]);
    if (txCheck.rows.length) return res.status(200).send("Already credited");
    await pool.query(`INSERT INTO transactions (user_id, transaction_id, revenue, currency_amount, type, provider) VALUES ($1,$2,$3,$4,$5,'TimeWall')`, [userId, transactionID, revenue, currencyAmount, type]);
    await pool.query(`UPDATE users SET balance = balance + $1 WHERE id=$2`, [currencyAmount, userId]);
    await bot.telegram.sendMessage(userID, `🎉 تم إضافة رصيد $${currencyAmount} من TimeWall!`);
    res.status(200).send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  if (process.env.WEBHOOK_URL) bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/telegram-webhook`);
});
bot.launch();
