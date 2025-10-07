require('dotenv').config();
const { Client } = require('pg');
const express = require('express');
const crypto = require('crypto'); 
const path = require('path'); 

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
    video_id INT,
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

app.get('/worker/start', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/worker/start.html'));
});

app.get('/api/user/profile', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({
      status: "error",
      message: "user_id is required"
    });
  }

  try {
    const result = await client.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (result.rows.length > 0) {
      const user = result.rows[0];
      return res.json({
        status: "success",
        data: {
          user_id: user.telegram_id.toString(),
          fullname: `User ${user.telegram_id}`,
          balance: parseFloat(user.balance),
          membership: "Free"
        }
      });
    } else {
      // إنشاء مستخدم جديد برصيد 0
      await client.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, 0]
      );

      return res.json({
        status: "success",
        data: {  // ← ✅ تم إضافة "data:" هنا
          user_id: user_id.toString(),
          fullname: `User ${user_id}`,
          balance: 0.0,
          membership: "Free"
        }
      });
    }
  } catch (err) {
    console.error('Error in /api/user/profile:', err);
    return res.status(500).json({
      status: "error",
      message: "Server error"
    });
  }
});

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! Postback جاهز.');
});

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

// ✅ جلب فيديوهات المستخدم
app.get('/api/my-videos', async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id مطلوب' });
  }

  try {
    const result = await client.query(`
      SELECT id, title, video_url, duration_seconds, views_count, created_at,
             COALESCE(keywords, '[]'::jsonb) AS keywords
      FROM user_videos
      WHERE user_id = $1
      ORDER BY created_at DESC
    `, [user_id]);

    const videos = result.rows.map(v => ({
      id: v.id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count,
      created_at: v.created_at,
      keywords: Array.isArray(v.keywords) ? v.keywords : []   // نتأكد إنها Array
    }));

    return res.json(videos);
  } catch (err) {
    console.error('Error in /api/my-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

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

    const available = videos.rows.filter(v => v.has_enough_balance);

    const mapped = available.map(v => {
  let keywords = [];

  if (v.keywords) {
    try {
      // تأكد أن القيمة نصية قبل التحليل
      if (typeof v.keywords === 'string') {
        keywords = JSON.parse(v.keywords);
      } else if (Array.isArray(v.keywords)) {
        keywords = v.keywords;
      }
    } catch (parseErr) {
      console.warn(`⚠️ keywords غير صالحة للفيديو ID ${v.id}:`, v.keywords);
      keywords = []; // أو استخدم [v.video_url] كخيار احتياطي
    }
  }

  return {
    id: v.id,
    title: v.title,
    video_url: v.video_url,
    duration_seconds: v.duration_seconds,
    user_id: v.user_id,
    keywords: keywords.length > 0 ? keywords : [v.video_url?.split('v=')[1] || '']
  };
});

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

  // ✅ التحقق من السر
  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden: Invalid Secret');
  }

  // ✅ التحقق من وجود transaction_id
  if (!transaction_id) {
    return res.status(400).send('Missing transaction_id');
  }

  // ✅ التحقق من المبلغ
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).send('Invalid amount');
  }

  // نسبة العمولة (60%)
  const percentage = 0.60; 
  const finalAmount = parsedAmount * percentage;

  // ✅ تحديد الشبكة (bitcotasks أو offer)
  const source = network === 'bitcotasks' ? 'bitcotasks' : 'offer';

  try {
    await client.query('BEGIN');

    // ✅ التحقق من عدم تكرار العملية
    const existing = await client.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return res.status(200).send('Duplicate transaction ignored');
    }

    // ✅ تأكد أن المستخدم موجود أو أضفه
    const userCheck = await client.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      // لو المستخدم مش موجود → إنشاؤه برصيد أولي
      await client.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, finalAmount]
      );
    } else {
      // لو موجود → تحديث رصيده
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [finalAmount, user_id]
      );
    }

    // ✅ إضافة سجل الأرباح
    await client.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at) 
       VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );

    console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${parsedAmount}$) للمستخدم ${user_id} (Transaction: ${transaction_id})`);

    // ✅ التحقق من وجود محيل
    const ref = await client.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1',
      [user_id]
    );

    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03; // 3% للمحيل

      // تحديث رصيد المحيل
      const refCheck = await client.query(
        'SELECT balance FROM users WHERE telegram_id = $1',
        [referrerId]
      );

      if (refCheck.rows.length === 0) {
        // لو المحيل مش موجود → إنشاؤه برصيد أولي
        await client.query(
          'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
          [referrerId, bonus]
        );
      } else {
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [bonus, referrerId]
        );
      }

      // إضافة سجل أرباح للمحيل
      await client.query(
        `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at) 
         VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
        [referrerId, 'referral', bonus, `Referral bonus from ${user_id} (Transaction: ${transaction_id})`]
      );

      console.log(`👥 تم إضافة ${bonus}$ (3%) للمحيل ${referrerId} من ربح المستخدم ${user_id}`);
    }

    await client.query('COMMIT');
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    await client.query('ROLLBACK');
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

app.get('/video-callback', async (req, res) => {
    let { user_id, video_id, watched_seconds, secret } = req.query;

    if (!user_id || !video_id) {
        return res.status(400).send('Missing user_id or video_id');
    }

    try {
        // التحقق من السر
        if (secret !== process.env.CALLBACK_SECRET) {
            return res.status(403).send('Forbidden: Invalid Secret');
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

        // تحقق من رصيد صاحب الفيديو
        const ownerBalanceRes = await client.query(
            'SELECT balance FROM users WHERE telegram_id = $1',
            [owner_id]
        );

        if (
            ownerBalanceRes.rows.length === 0 ||
            parseFloat(ownerBalanceRes.rows[0].balance) < cost
        ) {
            await client.query('ROLLBACK');
            return res.status(400).send('رصيد صاحب الفيديو غير كافٍ');
        }

        // خصم تكلفة المشاهدة من صاحب الفيديو
        await client.query(
            'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
            [cost, owner_id]
        );

        // تأكد إذا المشاهد موجود أو أضفه
        const viewerExists = await client.query(
            'SELECT 1 FROM users WHERE telegram_id = $1',
            [user_id]
        );

        if (viewerExists.rows.length === 0) {
            await client.query(
                'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
                [user_id, 0]
            );
        }

        // إضافة المكافأة للمشاهد
        await client.query(
            'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
            [reward, user_id]
        );

        // إضافة سجل للأرباح
        await client.query(
            `INSERT INTO earnings 
            (user_id, source, amount, description, watched_seconds, video_id, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [
                user_id,
                'user_video',
                reward,
                `user_video:${video_id}`,
                watched_seconds ? parseInt(watched_seconds) : null,
                video_id
            ]
        );

        // تحديث عداد المشاهدات للفيديو
        await client.query(
            'UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1',
            [video_id]
        );

        await client.query('COMMIT');

        console.log(
            `✅ فيديو ${video_id}: ${reward}$ للمشاهد ${user_id} — watched_seconds=${watched_seconds}`
        );

        return res.status(200).send('Success');
    } catch (err) {
        try {
            await client.query('ROLLBACK');
        } catch (_) {}
        console.error('Error in /video-callback:', err);
        return res.status(500).send('Server Error');
    }
});

// ✅ /api/auth — يتحقق فقط من وجود المستخدم بدون إنشائه
app.get('/api/auth', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id مطلوب' });
    }

    // 🔎 تحقق من وجود المستخدم
    const result = await client.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (result.rows.length === 0) {
      // ❌ المستخدم غير موجود
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const user = result.rows[0];

    // ✅ المستخدم موجود → أعد بياناته للامتداد
    const response = {
      fullname: `User ${user.telegram_id}`,
      uniqueID: user.telegram_id.toString(),
      coins: parseFloat(user.balance),
      balance: parseFloat(user.balance),
      membership: 'Free'
    };

    return res.json(response);
  } catch (err) {
    console.error('Error in /api/auth:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

/* ============================================================
   🟢 1. /api/worker — جلب الفيديوهات المتاحة للمشاهدة
   ============================================================ */
app.get('/api/worker', async (req, res) => {
  try {
    const { user_id } = req.query;

    // تأكد من وجود user_id
    if (!user_id) return res.status(400).json({ error: "user_id مطلوب" });

    // جلب فيديوهات متاحة للمشاهدة
    const videosRes = await client.query(`
      SELECT id, title, video_url, duration_seconds, user_id, keywords, reward
      FROM user_videos
      WHERE reward > 0
      ORDER BY created_at DESC
      LIMIT 50
    `);

    const videos = videosRes.rows.map(v => ({
      id: v.id,
      title: v.title,
      url: v.video_url,
      duration_seconds: v.duration_seconds,
      user_id: v.user_id,
      reward: Number(v.reward),
      keywords: typeof v.keywords === 'string' ? JSON.parse(v.keywords) : v.keywords || []
    }));

    return res.json({ success: true, videos });
  } catch (err) {
    console.error('Error in /api/worker:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});


/* ============================================================
   🌐 /api/lang/full — النصوص والترجمات + قائمة الفيديوهات
   ============================================================ */
app.get('/api/lang/full', async (req, res) => {
  try {
    const { user_id, lang } = req.query;

    // 🌍 اختيار اللغة (افتراضي: الإنجليزية)
    const translations =
      lang === 'ar'
        ? {
            start_button: "ابدأ المشاهدة",
            stop_button: "إيقاف",
            balance_label: "رصيدك",
            coins_label: "العملات",
            membership_label: "العضوية",
            loading_text: "جارٍ تحميل المهام...",
            error_text: "حدث خطأ أثناء الاتصال بالخادم"
          }
        : {
            start_button: "Start Watching",
            stop_button: "Stop",
            balance_label: "Your Balance",
            coins_label: "Coins",
            membership_label: "Membership",
            loading_text: "Loading tasks...",
            error_text: "An error occurred while connecting to the server"
          };

    // 🎥 جلب الفيديوهات من قاعدة البيانات
    const videosRes = await client.query(`
      SELECT id, title, video_url, duration_seconds, user_id, keywords, reward
      FROM user_videos
      WHERE reward > 0
      ORDER BY created_at DESC
      LIMIT 50
    `);

    const videos = videosRes.rows.map(v => ({
      id: v.id,
      title: v.title,
      url: v.video_url,
      duration_seconds: v.duration_seconds,
      user_id: v.user_id,
      reward: Number(v.reward),
      keywords: typeof v.keywords === 'string' ? JSON.parse(v.keywords) : v.keywords || []
    }));

    // 🧩 البيانات التي يتوقعها الامتداد
    const payload = {
      lang: translations,
      videos,
      server_time: new Date().toISOString()
    };

    // 🔒 الإضافة تتوقع Base64
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    res.json({ langData: encoded });
  } catch (err) {
    console.error('Error in /api/lang/full:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ============================================================
   🟢 3. /api/check — تحقق من حالة المستخدم أو الجلسة
   ============================================================ */
app.get('/api/check', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    const result = await client.query(
      'SELECT telegram_id, balance, membership FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (result.rowCount === 0) {
      return res.json({ exists: false });
    }

    const user = result.rows[0];
    res.json({
      exists: true,
      user_id: user.telegram_id,
      balance: Number(user.balance),
      membership: user.membership
    });
  } catch (err) {
    console.error('Error in /api/check:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


/* ============================================================
   🟢 4. /api/redirect — إعادة توجيه العامل إلى رابط الفيديو
   ============================================================ */
app.get('/api/redirect', async (req, res) => {
  try {
    const { video_id } = req.query;
    if (!video_id) return res.status(400).send('video_id مطلوب');

    const videoRes = await client.query('SELECT video_url FROM user_videos WHERE id = $1', [video_id]);
    if (videoRes.rowCount === 0) return res.status(404).send('الفيديو غير موجود');

    const videoUrl = videoRes.rows[0].video_url;
    res.redirect(videoUrl);
  } catch (err) {
    console.error('Error in /api/redirect:', err);
    res.status(500).send('Server error');
  }
});


/* ============================================================
   🟢 5. /api/report — تسجيل إنجاز المشاهدة والمكافأة
   ============================================================ */
app.post('/api/report', async (req, res) => {
  try {
    const { user_id, video_id, duration, status } = req.body;
    if (!user_id || !video_id) return res.status(400).json({ error: 'user_id و video_id مطلوبان' });

    const videoRes = await client.query('SELECT reward FROM user_videos WHERE id = $1', [video_id]);
    if (videoRes.rowCount === 0) return res.status(404).json({ error: 'الفيديو غير موجود' });

    const reward = Number(videoRes.rows[0].reward) || 0.0005;

    await client.query('BEGIN');

    await client.query(
      'UPDATE users SET balance = balance + $1, coins = coins + $1 WHERE telegram_id = $2',
      [reward, user_id]
    );

    await client.query(
      `INSERT INTO user_reports (user_id, video_id, duration, reward, status, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [user_id, video_id, duration || 0, reward, status || 'completed']
    );

    await client.query('COMMIT');
    res.json({ success: true, reward_added: reward });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in /api/report:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


/* ============================================================
   🟢 6. /api/notify — إشعار المستخدم بحدث معين
   ============================================================ */
app.post('/api/notify', async (req, res) => {
  try {
    const { user_id, title, message } = req.body;
    if (!user_id || !message)
      return res.status(400).json({ error: 'user_id و message مطلوبان' });

    // يمكن هنا لاحقًا إرسال إشعار تلغرام فعلي أو حفظه بقاعدة البيانات
    await client.query(
      `INSERT INTO notifications (user_id, title, message, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [user_id, title || 'Notification', message]
    );

    res.json({ success: true, sent: true });
  } catch (err) {
    console.error('Error in /api/notify:', err);
    res.status(500).json({ error: 'Server error' });
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
