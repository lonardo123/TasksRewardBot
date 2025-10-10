// server.js - ملف كامل للسيرفر + بوت Telegram + Worker
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { client } = require('./db'); // الاتصال بقاعدة البيانات

// === Telegraf (بوت Telegram)
let bot;
try {
  const { Telegraf } = require('telegraf');
  if (process.env.BOT_TOKEN) {
    bot = new Telegraf(process.env.BOT_TOKEN);
  }
} catch (err) {
  console.warn('⚠️ Telegraf not initialized:', err);
}

// التقاط أي أخطاء لاحقة في العميل
client.on('error', (err) => {
  console.error('⚠️ PG client error:', err);
});

// === Express App ===
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// === مسارات السيرفر ===
app.get('/', (req, res) => res.send('✅ السيرفر يعمل! Postback جاهز.'));

// Worker HTML
app.get('/worker/start', (req, res) => res.sendFile(path.join(__dirname, 'public/worker/start.html')));

// Worker Verification
app.all('/api/worker/verification/', (req, res) => {
  res.status(200).json({ ok: true, status: "verified", method: req.method, server_time: new Date().toISOString() });
});

// جلب بيانات المستخدم
app.get('/api/user/profile', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ status: "error", message: "user_id is required" });

  try {
    const result = await client.query('SELECT telegram_id, balance FROM users WHERE telegram_id = $1', [user_id]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      return res.json({ status: "success", data: { user_id: user.telegram_id.toString(), fullname: `User ${user.telegram_id}`, balance: parseFloat(user.balance), membership: "Free" } });
    } else {
      await client.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [user_id, 0]);
      return res.json({ status: "success", data: { user_id: user_id.toString(), fullname: `User ${user_id}`, balance: 0.0, membership: "Free" } });
    }
  } catch (err) {
    console.error('Error in /api/user/profile:', err);
    return res.status(500).json({ status: "error", message: "Server error" });
  }
});

// إضافة فيديو
app.post('/api/add-video', async (req, res) => {
  const { user_id, title, video_url, duration_seconds, keywords } = req.body;
  if (!user_id || !title || !video_url || !duration_seconds) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });

  const duration = parseInt(duration_seconds, 10);
  if (isNaN(duration) || duration < 50) return res.status(400).json({ error: 'المدة يجب أن تكون 50 ثانية على الأقل' });
  const cost = duration * 0.00002;

  try {
    const countRes = await client.query('SELECT COUNT(*) AS cnt FROM user_videos WHERE user_id = $1', [user_id]);
    if (parseInt(countRes.rows[0].cnt, 10) >= 4) return res.status(400).json({ error: 'وصلت للحد الأقصى (4) من الفيديوهات.' });

    const user = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0) return res.status(400).json({ error: 'المستخدم غير موجود' });
    if (parseFloat(user.rows[0].balance) < cost) return res.status(400).json({ error: 'رصيدك غير كافٍ' });

    const keywordsJson = JSON.stringify(Array.isArray(keywords) ? keywords : []);

    await client.query('BEGIN');
    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [cost, user_id]);
    await client.query('INSERT INTO user_videos (user_id, title, video_url, duration_seconds, keywords) VALUES ($1, $2, $3, $4, $5)', [user_id, title, video_url, duration, keywordsJson]);
    await client.query('COMMIT');

    res.json({ success: true, cost });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error in /api/add-video:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// جلب فيديوهات المستخدم
app.get('/api/my-videos', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });
  try {
    const result = await client.query('SELECT id, title, video_url, duration_seconds, views_count, created_at, COALESCE(keywords, '[]'::jsonb) AS keywords FROM user_videos WHERE user_id = $1 ORDER BY created_at DESC', [user_id]);
    const videos = result.rows.map(v => ({ id: v.id, title: v.title, video_url: v.video_url, duration_seconds: v.duration_seconds, views_count: v.views_count, created_at: v.created_at, keywords: Array.isArray(v.keywords) ? v.keywords : [] }));
    res.json(videos);
  } catch (err) {
    console.error('Error in /api/my-videos:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// حذف فيديو
app.post('/api/delete-video', async (req, res) => {
  const { user_id, video_id } = req.body;
  if (!user_id || !video_id) return res.status(400).json({ error: 'user_id و video_id مطلوبان' });
  try {
    const result = await client.query('DELETE FROM user_videos WHERE id = $1 AND user_id = $2', [video_id, user_id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'الفيديو غير موجود أو لا تملك صلاحية الحذف' });
    res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/delete-video:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// فيديوهات عامة
app.get('/api/public-videos', async (req, res) => {
  try {
    const videos = await client.query('SELECT uv.id, uv.title, uv.video_url, uv.duration_seconds, uv.user_id, uv.keywords, u.balance >= (uv.duration_seconds * 0.00002) AS has_enough_balance FROM user_videos uv JOIN users u ON uv.user_id = u.telegram_id WHERE u.balance >= (uv.duration_seconds * 0.00002) ORDER BY uv.views_count ASC, uv.created_at DESC LIMIT 50');
    const mapped = videos.rows.filter(v => v.has_enough_balance).map(v => {
      let keywords = [];
      try { keywords = typeof v.keywords === 'string' ? JSON.parse(v.keywords) : Array.isArray(v.keywords) ? v.keywords : []; } catch { keywords = []; }
      return { id: v.id, title: v.title, video_url: v.video_url, duration_seconds: v.duration_seconds, user_id: v.user_id, keywords: keywords.length > 0 ? keywords : [v.video_url?.split('v=')[1] || ''] };
    });
    res.json(mapped);
  } catch (err) { console.error('Error in /api/public-videos:', err); res.status(500).json({ error: 'Server error' }); }
});

// === Callbacks (عمليات الدفع والفيديو) ===
app.get('/callback', async (req, res) => { /*... كامل كما في كودك السابق ...*/ });
app.get('/unity-callback', async (req, res) => { /*... كامل كما في كودك السابق ...*/ });
app.get('/video-callback', async (req, res) => { /*... كامل كما في كودك السابق ...*/ });

// === API Auth & Check ===
app.get('/api/auth', async (req, res) => { /*...*/ });
app.get('/api/check', async (req, res) => { /*...*/ });

// === Worker APIs ===
app.post('/api/worker/start', async (req, res) => { /*...*/ });
app.post('/api/worker', async (req, res) => { /*...*/ });
app.post('/api/report', async (req, res) => { /*...*/ });

// === Translation & Notification ===
app.get('/api/lang/full', async (req, res) => { /*...*/ });
app.get('/api/notify', (req, res) => { res.json({ success:true, message:"📢 لا توجد إشعارات جديدة", timestamp: new Date().toISOString() }); });
app.get('/worker/', (req, res) => { res.status(200).json({ ok:true, status:'ready', message:'Worker endpoint is active 🚀', server_time:new Date().toISOString() }); });

// === Start Server + Bot ===
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    console.log('🚀 Starting combined server...');
    app.listen(PORT, () => console.log(`✅ Express server running on port ${PORT}`));
    if (bot) { await bot.launch(); console.log('🤖 Telegram bot launched'); }
  } catch (err) { console.error('❌ Failed to start combined bot/server:', err); }
})();
