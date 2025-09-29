require('dotenv').config();
const { Client } = require('pg');
const express = require('express');
const crypto = require('crypto'); // لحساب والتحقق من HMAC

// === إعداد قاعدة البيانات (Postgres Client)
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// التقاط أخطاء غير متوقعة على مستوى العميل
client.on('error', (err) => {
  console.error('PG client error:', err);
});

// دالة لإنشاء/التأكد من الجداول والأعمدة (تنفيذ متسلسل لتجنب مشكلات multi-statement)
async function ensureTables() {
  // أنشئ جدول users
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      balance NUMERIC(12,6) DEFAULT 0,
      payeer_wallet VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // أنشئ جدول user_videos مع عمود keywords (نخزن JSON string)
  await client.query(`
    CREATE TABLE IF NOT EXISTS user_videos (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      title VARCHAR(255) NOT NULL,
      video_url TEXT NOT NULL,
      duration_seconds INT NOT NULL CHECK (duration_seconds >= 50),
      views_count INT DEFAULT 0,
      keywords TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // أنشئ جدول earnings (مهيأ ليشمل watched_seconds, video_id, created_at)
  await client.query(`
    CREATE TABLE IF NOT EXISTS earnings (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      source VARCHAR(50),
      amount NUMERIC(12,6),
      description TEXT,
      watched_seconds INTEGER,
      video_id VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // أنشئ جدول withdrawals
  await client.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      amount NUMERIC(12,6),
      payeer_wallet VARCHAR,
      status VARCHAR(20) DEFAULT 'pending',
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ,
      admin_note TEXT
    );
  `);

  // أنشئ جدول referrals
  await client.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id BIGINT,
      referee_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// دالة لربط DB مع محاولة إعادة للاتصال عند الخطأ
async function connectDB() {
  try {
    await client.connect();
    console.log('✅ اتصال قاعدة البيانات ناجح');

    // تأكد من الجداول
    await ensureTables();
    console.log('✅ الجداول والأعمدة أنشئت أو موجودة مسبقًا');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message || err);
    // إعادة المحاولة بعد 5 ثوانٍ
    setTimeout(connectDB, 5000);
  }
}

// === السيرفر (Express)
const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! Postback جاهز.');
});

/* ============================================================
   API: my-videos / add-video / delete-video / public-videos
   ============================================================ */

/**
 * GET /api/my-videos?user_id=...
 * يرجع قائمة فيديوهات المستخدم (id, title, video_url, duration_seconds, views_count, keywords[])
 */
app.get('/api/my-videos', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

  try {
    const videos = await client.query(
      'SELECT id, title, video_url, duration_seconds, views_count, keywords FROM user_videos WHERE user_id = $1 ORDER BY created_at DESC',
      [user_id]
    );

    // نحول الكلمات المفتاحية من نص JSON → Array (أو [] إن كانت null/فارغة)
    const mapped = videos.rows.map(v => ({
      id: v.id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count,
      keywords: v.keywords ? JSON.parse(v.keywords) : []
    }));

    return res.json(mapped);
  } catch (err) {
    console.error('Error in /api/my-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/add-video
 * body: { user_id, title, video_url, duration_seconds, keywords }
 * يتحقق من الرصيد ويخصم التكلفة داخل معاملة (transaction)
 * يفرض حد أقصى 4 فيديوهات لكل مستخدم على مستوى السيرفر
 */
app.post('/api/add-video', async (req, res) => {
  const { user_id, title, video_url, duration_seconds, keywords } = req.body;
  if (!user_id || !title || !video_url || !duration_seconds) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }

  const duration = parseInt(duration_seconds, 10);
  if (isNaN(duration) || duration < 50) {
    return res.status(400).json({ error: 'المدة يجب أن تكون 50 ثانية على الأقل' });
  }

  // تكلفة نشر الفيديو
  const cost = duration * 0.00002;

  try {
    // تحقق عدد فيديوهات المستخدم (حد أقصى 4)
    const countRes = await client.query('SELECT COUNT(*) AS cnt FROM user_videos WHERE user_id = $1', [user_id]);
    const existingCount = parseInt(countRes.rows[0].cnt, 10);
    if (existingCount >= 4) {
      return res.status(400).json({ error: 'وصلت للحد الأقصى (4) من الفيديوهات. احذف فيديوًا قبل إضافة آخر.' });
    }

    // جلب رصيد المستخدم
    const user = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0) {
      return res.status(400).json({ error: 'المستخدم غير موجود' });
    }

    if (parseFloat(user.rows[0].balance) < cost) {
      return res.status(400).json({ error: 'رصيدك غير كافٍ' });
    }

    // نحول keywords إلى JSON string للتخزين (نتأكد أنها مصفوفة أو نستخدم [])
    const keywordsArray = Array.isArray(keywords) ? keywords : [];
    const keywordsJson = JSON.stringify(keywordsArray);

    await client.query('BEGIN');
    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [cost, user_id]);
    await client.query(
      'INSERT INTO user_videos (user_id, title, video_url, duration_seconds, keywords) VALUES ($1, $2, $3, $4, $5)',
      [user_id, title, video_url, duration, keywordsJson]
    );
    await client.query('COMMIT');

    return res.json({ success: true, cost });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error in /api/add-video:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * POST /api/delete-video
 * body: { user_id, video_id }
 * يحذف الفيديو فقط إن كان المالك هو user_id
 */
app.post('/api/delete-video', async (req, res) => {
  const { user_id, video_id } = req.body;
  if (!user_id || !video_id) return res.status(400).json({ error: 'user_id و video_id مطلوبان' });

  try {
    const result = await client.query(
      'DELETE FROM user_videos WHERE id = $1 AND user_id = $2',
      [video_id, user_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'الفيديو غير موجود أو لا تملك صلاحية الحذف' });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error('Error in /api/delete-video:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/public-videos
 * يرجع قائمة فيديوهات متاحة للمشاهدة (التي لدى أصحابها رصيد كافٍ)
 * الترتيب: الأقل مشاهدة أولاً ثم الأحدث
 * يُرجع keywords كمصفوفة
 */
app.get('/api/public-videos', async (req, res) => {
  try {
    const videos = await client.query(`
      SELECT uv.id, uv.title, uv.video_url, uv.duration_seconds, uv.user_id, uv.keywords,
             u.balance >= (uv.duration_seconds * 0.00002) AS has_enough_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 50
    `);

    // نعيد فقط الصفوف التي فعلاً لديها رصيد كافٍ
    const available = videos.rows.filter(v => v.has_enough_balance);

    // نُعيد الحقول الأساسية للعميل مع تحويل keywords إلى مصفوفة
    const mapped = available.map(v => ({
      id: v.id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      user_id: v.user_id,
      keywords: v.keywords ? JSON.parse(v.keywords) : []
    }));

    return res.json(mapped);
  } catch (err) {
    console.error('Error in /api/public-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


/* ============================================================
   Existing callbacks and other endpoints (kept & slightly improved)
   ============================================================ */

app.get('/callback', async (req, res) => {
  const { user_id, amount, transaction_id, secret, network } = req.query;

  // التحقق من السر
  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden: Invalid Secret');
  }

  if (!transaction_id) {
    return res.status(400).send('Missing transaction_id');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).send('Invalid amount');
  }

  const percentage = 0.60;
  const finalAmount = parsedAmount * percentage;
  const source = network === 'bitcotasks' ? 'bitcotasks' : 'offer';

  try {
    // تحقق من تكرار المعاملة
    const existing = await client.query(
      'SELECT 1 FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );

    if (existing.rows.length > 0) {
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return res.status(200).send('Duplicate transaction ignored');
    }

    // ابدأ معاملة
    await client.query('BEGIN');

    // تحديث رصيد المستخدم (إذا لم يكن موجوداً، لا نحاول الإنشاء هنا لأن المنطق قد يكون مختلف)
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [finalAmount, user_id]);

    // سجل في earnings
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1, $2, $3, $4, NOW())',
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );

    // منحه مكافأة للمحيل إن وُجد
    const ref = await client.query('SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1', [user_id]);

    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03;
      await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [bonus, referrerId]);
      await client.query(
        'INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1,$2,$3,$4,NOW())',
        [referrerId, 'referral', bonus, `Referral bonus from ${user_id} (Transaction: ${transaction_id})`]
      );
      console.log(`👥 تم إضافة ${bonus}$ (3%) للمحيل ${referrerId} من ربح المستخدم ${user_id}`);
    }

    await client.query('COMMIT');
    console.log(`🟢 [${source}] أضيف ${finalAmount}$ للمستخدم ${user_id} (Transaction: ${transaction_id})`);
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});

// === Unity Ads S2S Callback (كما كان، مع بعض الحماية البسيطة)
app.get('/unity-callback', async (req, res) => {
  try {
    const params = { ...req.query };
    const hmac = params.hmac;
    if (!hmac) return res.status(400).send('Missing hmac');

    const secret = process.env.UNITYADS_SECRET || '';
    if (!secret) {
      console.error('UNITYADS_SECRET not set');
      return res.status(500).send('Server not configured');
    }

    const paramsToSign = { ...params };
    delete paramsToSign.hmac;
    const keys = Object.keys(paramsToSign).sort();
    const paramString = keys.map(k => `${k}=${paramsToSign[k] === null ? '' : paramsToSign[k]}`).join(',');

    const computed = crypto.createHmac('md5', secret).update(paramString).digest('hex');

    if (computed !== hmac) {
      console.warn('Unity callback signature mismatch', { paramString, computed, hmac });
      return res.sendStatus(403);
    }

    const sid = params.sid;
    const oid = params.oid;
    const productid = params.productid || params.product || params.placement || null;

    if (!sid || !oid) {
      return res.status(400).send('Missing sid or oid');
    }

    const reward = 0.0005;

    const dup = await client.query('SELECT 1 FROM earnings WHERE source=$1 AND description=$2 LIMIT 1', ['unity', `oid:${oid}`]);
    if (dup.rows.length > 0) {
      console.log('🔁 Unity callback duplicate oid ignored', oid);
      return res.status(200).send('Duplicate order ignored');
    }

    await client.query('BEGIN');

    const uRes = await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [sid]);
    if (uRes.rowCount === 0) {
      await client.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [sid, 0]);
    }

    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [reward, sid]);
    await client.query('INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1,$2,$3,$4,NOW())',
                      [sid, 'unity', reward, `oid:${oid}`]);

    await client.query('COMMIT');

    console.log(`🎬 Unity S2S: credited ${reward}$ to ${sid} (oid=${oid})`);
    res.status(200).send('1');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error on /unity-callback', err);
    res.status(500).send('Server Error');
  }
});

// === Video callback (مُحسَّن) ===
app.get('/video-callback', async (req, res) => {
  let { user_id, video_id, watched_seconds, source, signature } = req.query;

  if (!user_id || !video_id) {
    return res.status(400).send('Missing user_id or video_id');
  }

  try {
    const secret = process.env.CALLBACK_SECRET;
    if (secret) {
      if (!watched_seconds || !source || !signature) {
        return res.status(400).send('Missing required parameters (watched_seconds, source or signature) with CALLBACK_SECRET set');
      }
      const payload = `${user_id}:${video_id}:${watched_seconds}:${source}`;
      const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      if (signature !== expectedSignature) {
        console.warn('video-callback: invalid signature', { user_id, video_id, payload, signature, expectedSignature: expectedSignature.slice(0,8) + '...' });
        return res.status(403).send('Invalid signature');
      }
    } else {
      watched_seconds = watched_seconds || null;
      source = source || 'YouTube';
    }

    // جلب بيانات الفيديو
    const videoRes = await client.query(
      'SELECT user_id AS owner_id, duration_seconds FROM user_videos WHERE id = $1',
      [video_id]
    );
    if (videoRes.rows.length === 0) {
      return res.status(400).send('الفيديو غير موجود');
    }

    const { owner_id, duration_seconds } = videoRes.rows[0];
    const reward = duration_seconds * 0.00001;
    const cost = duration_seconds * 0.00002;

    await client.query('BEGIN');

    const ownerBalanceRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [owner_id]);
    if (ownerBalanceRes.rows.length === 0 || parseFloat(ownerBalanceRes.rows[0].balance) < cost) {
      await client.query('ROLLBACK');
      return res.status(400).send('رصيد صاحب الفيديو غير كافٍ');
    }

    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [cost, owner_id]);

    const viewerExists = await client.query('SELECT 1 FROM users WHERE telegram_id = $1', [user_id]);
    if (viewerExists.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [user_id, 0]);
    }

    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [reward, user_id]);

    await client.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        user_id,
        source || 'user_video',
        reward,
        `user_video:${video_id}`,
        (watched_seconds ? parseInt(watched_seconds) : null),
        video_id
      ]
    );

    await client.query('UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1', [video_id]);

    await client.query('COMMIT');

    console.log(`✅ فيديو ${video_id}: ${reward}$ للمشاهد ${user_id} — source=${source} watched_seconds=${watched_seconds}`);
    return res.status(200).send('Success');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error in /video-callback:', err);
    return res.status(500).send('Server Error');
  }
});

// === بدء التشغيل ===
(async () => {
  await connectDB();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Postback Server يعمل على المنفذ ${PORT}`);
  });
})();
