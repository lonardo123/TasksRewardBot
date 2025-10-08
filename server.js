require('dotenv').config();
const { Pool } = require('pg');
const express = require('express');
const crypto = require('crypto'); 
const path = require('path'); 
const fs = require('fs');

// === إعداد قاعدة البيانات باستخدام Pool (آمن وقابل لإعادة الاستخدام)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// التقاط أخطاء غير متوقعة على مستوى الـ Pool
pool.on('error', (err) => {
  console.error('⚠️ خطأ غير متوقع في اتصال قاعدة البيانات:', err);
});

// دالة لإنشاء/التأكد من الجداول والأعمدة (تنفيذ متسلسل لتجنب مشكلات multi-statement)
async function ensureTables() {
  // أنشئ جدول users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      balance NUMERIC(12,6) DEFAULT 0,
      payeer_wallet VARCHAR,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ✅ إنشاء / تعديل جدول user_videos ليتوافق مع جميع الحقول الجديدة
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_videos (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      title VARCHAR(255) NOT NULL,
      video_url TEXT NOT NULL,
      duration_seconds INT NOT NULL CHECK (duration_seconds >= 50),
      views_count INT DEFAULT 0,
      keywords TEXT,                     -- قائمة الكلمات المفتاحية بصيغة JSON
      viewing_method VARCHAR(50) DEFAULT 'keyword',  -- طريقة العرض (keyword, direct, channel...)
      like VARCHAR(10) DEFAULT 'no',      -- الإعجاب: yes / no / random
      subscribe VARCHAR(10) DEFAULT 'no', -- الاشتراك: yes / no / random
      comment VARCHAR(10) DEFAULT 'no',   -- التعليق: yes / no / random
      comment_like VARCHAR(10) DEFAULT 'no', -- إعجاب بالتعليق: yes / no / random
      filtering VARCHAR(10) DEFAULT 'no', -- تصفية الحركة: yes / no
      daily_budget NUMERIC(12,6) DEFAULT 0,  -- حد الميزانية اليومية
      total_budget NUMERIC(12,6) DEFAULT 0,  -- حد الميزانية الإجمالية
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // أنشئ جدول earnings (مهيأ ليشمل watched_seconds, video_id, created_at)
  await pool.query(`
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
  await pool.query(`
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id BIGINT,
      referee_id BIGINT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

// === السيرفر (Express)
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ✅ مسار /worker/start — يُرجع Start.js كـ JavaScript مباشر (لإضافة كروم)
app.get("/worker/start", (req, res) => {
  const filePath = path.join(__dirname, "public", "assets", "js", "core", "Start.js");
  if (fs.existsSync(filePath)) {
    res.type("application/javascript");
    res.sendFile(filePath);
  } else {
    res.status(404).send("// ⚠️ Start.js not found!");
  }
});

// ===========================================
// ✅ مسار التحقق من العامل (Worker Verification)
// ===========================================
app.all("/api/worker/verification/", (req, res) => {
  // دعم GET و POST مع رد ثابت يطمئن الإضافة
  res.status(200).json({
    ok: true,
    status: "verified",
    method: req.method,
    server_time: new Date().toISOString()
  });
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
    const result = await pool.query(
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
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, 0]
      );

      return res.json({
        status: "success",
        data: {
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
    const countRes = await pool.query('SELECT COUNT(*) AS cnt FROM user_videos WHERE user_id = $1', [user_id]);
    const existingCount = parseInt(countRes.rows[0].cnt, 10);
    if (existingCount >= 4) {
      return res.status(400).json({ error: 'وصلت للحد الأقصى (4) من الفيديوهات. احذف فيديوًا قبل إضافة آخر.' });
    }

    // جلب رصيد المستخدم
    const user = await pool.query('SELECT balance FROM users WHERE telegram_id = $1', [user_id]);
    if (user.rows.length === 0) {
      return res.status(400).json({ error: 'المستخدم غير موجود' });
    }

    if (parseFloat(user.rows[0].balance) < cost) {
      return res.status(400).json({ error: 'رصيدك غير كافٍ' });
    }

    // نحول keywords إلى JSON string للتخزين (نتأكد أنها مصفوفة أو نستخدم [])
    const keywordsArray = Array.isArray(keywords) ? keywords : [];
    const keywordsJson = JSON.stringify(keywordsArray);

    await pool.query('BEGIN');
    await pool.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [cost, user_id]);
    await pool.query(
      'INSERT INTO user_videos (user_id, title, video_url, duration_seconds, keywords) VALUES ($1, $2, $3, $4, $5)',
      [user_id, title, video_url, duration, keywordsJson]
    );
    await pool.query('COMMIT');

    return res.json({ success: true, cost });
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
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
    const result = await pool.query(`
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
      keywords: Array.isArray(v.keywords) ? v.keywords : []
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
    const result = await pool.query(
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
    const videos = await pool.query(`
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
          if (typeof v.keywords === 'string') {
            keywords = JSON.parse(v.keywords);
          } else if (Array.isArray(v.keywords)) {
            keywords = v.keywords;
          }
        } catch (parseErr) {
          console.warn(`⚠️ keywords غير صالحة للفيديو ID ${v.id}:`, v.keywords);
          keywords = [];
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

app.get('/callback', async (req, res) => {
  const { user_id, amount, transaction_id, secret, network } = req.query;

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
    await pool.query('BEGIN');

    const existing = await pool.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );

    if (existing.rows.length > 0) {
      await pool.query('ROLLBACK');
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return res.status(200).send('Duplicate transaction ignored');
    }

    const userCheck = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (userCheck.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, finalAmount]
      );
    } else {
      await pool.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [finalAmount, user_id]
      );
    }

    await pool.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at) 
       VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );

    console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${parsedAmount}$) للمستخدم ${user_id} (Transaction: ${transaction_id})`);

    const ref = await pool.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1',
      [user_id]
    );

    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03;

      const refCheck = await pool.query(
        'SELECT balance FROM users WHERE telegram_id = $1',
        [referrerId]
      );

      if (refCheck.rows.length === 0) {
        await pool.query(
          'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
          [referrerId, bonus]
        );
      } else {
        await pool.query(
          'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
          [bonus, referrerId]
        );
      }

      await pool.query(
        `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at) 
         VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
        [referrerId, 'referral', bonus, `Referral bonus from ${user_id} (Transaction: ${transaction_id})`]
      );

      console.log(`👥 تم إضافة ${bonus}$ (3%) للمحيل ${referrerId} من ربح المستخدم ${user_id}`);
    }

    await pool.query('COMMIT');
    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});

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

    const dup = await pool.query('SELECT 1 FROM earnings WHERE source=$1 AND description=$2 LIMIT 1', ['unity', `oid:${oid}`]);
    if (dup.rows.length > 0) {
      console.log('🔁 Unity callback duplicate oid ignored', oid);
      return res.status(200).send('Duplicate order ignored');
    }

    await pool.query('BEGIN');

    const uRes = await pool.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [sid]);
    if (uRes.rowCount === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [sid, 0]);
    }

    await pool.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [reward, sid]);
    await pool.query('INSERT INTO earnings (user_id, source, amount, description, created_at) VALUES ($1,$2,$3,$4,NOW())',
                      [sid, 'unity', reward, `oid:${oid}`]);

    await pool.query('COMMIT');

    console.log(`🎬 Unity S2S: credited ${reward}$ to ${sid} (oid=${oid})`);
    res.status(200).send('1');
  } catch (err) {
    try { await pool.query('ROLLBACK'); } catch (_) {}
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
    if (secret !== process.env.CALLBACK_SECRET) {
      return res.status(403).send('Forbidden: Invalid Secret');
    }

    const videoRes = await pool.query(
      'SELECT user_id AS owner_id, duration_seconds FROM user_videos WHERE id = $1',
      [video_id]
    );

    if (videoRes.rows.length === 0) {
      return res.status(400).send('الفيديو غير موجود');
    }

    const { owner_id, duration_seconds } = videoRes.rows[0];
    const reward = duration_seconds * 0.00001;
    const cost = duration_seconds * 0.00002;

    await pool.query('BEGIN');

    const ownerBalanceRes = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [owner_id]
    );

    if (
      ownerBalanceRes.rows.length === 0 ||
      parseFloat(ownerBalanceRes.rows[0].balance) < cost
    ) {
      await pool.query('ROLLBACK');
      return res.status(400).send('رصيد صاحب الفيديو غير كافٍ');
    }

    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [cost, owner_id]
    );

    const viewerExists = await pool.query(
      'SELECT 1 FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (viewerExists.rows.length === 0) {
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, 0]
      );
    }

    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [reward, user_id]
    );

    await pool.query(
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

    await pool.query(
      'UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1',
      [video_id]
    );

    await pool.query('COMMIT');

    console.log(
      `✅ فيديو ${video_id}: ${reward}$ للمشاهد ${user_id} — watched_seconds=${watched_seconds}`
    );

    return res.status(200).send('Success');
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
    } catch (_) {}
    console.error('Error in /video-callback:', err);
    return res.status(500).send('Server Error');
  }
});

app.get('/api/auth', async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id مطلوب' });
    }

    const result = await pool.query(
      'SELECT telegram_id, balance FROM users WHERE telegram_id = $1',
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }

    const user = result.rows[0];
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

app.get('/api/check', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    const userRes = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);

    if (userRes.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
      return res.json({ success: true, message: 'تم إنشاء المستخدم الجديد', balance: 0 });
    }

    const user = userRes.rows[0];
    res.json({
      success: true,
      user_id,
      balance: parseFloat(user.balance || 0),
      message: 'المستخدم موجود وجاهز'
    });
  } catch (err) {
    console.error('❌ /api/check:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

app.post('/api/worker/start', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    const userCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }

    const videosRes = await pool.query(`
      SELECT 
        uv.id,
        uv.user_id,
        uv.title,
        uv.video_url,
        uv.duration_seconds,
        uv.views_count,
        uv.keywords,
        uv.viewing_method,
        uv.like,
        uv.subscribe,
        uv.comment,
        uv.comment_like,
        uv.filtering,
        uv.daily_budget,
        uv.total_budget,
        u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.user_id != $1
        AND u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 20;
    `, [user_id]);

    const videos = videosRes.rows.map(v => ({
      id: v.id,
      user_id: v.user_id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count || 0,
      keywords: (() => {
        try {
          return Array.isArray(v.keywords) ? v.keywords : JSON.parse(v.keywords || '[]');
        } catch {
          return [];
        }
      })(),
      viewing_method: v.viewing_method || 'keyword',
      like: v.like || 'no',
      subscribe: v.subscribe || 'no',
      comment: v.comment || 'no',
      comment_like: v.comment_like || 'no',
      filtering: v.filtering || 'no',
      daily_budget: v.daily_budget || 0,
      total_budget: v.total_budget || 0,
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));

    return res.json({
      success: true,
      videos,
      count: videos.length
    });

  } catch (err) {
    console.error('❌ خطأ في /api/worker:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

app.post('/api/worker', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });

    const userCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }

    const videosRes = await pool.query(`
      SELECT 
        uv.id,
        uv.user_id,
        uv.title,
        uv.video_url,
        uv.duration_seconds,
        uv.views_count,
        uv.keywords,
        uv.viewing_method,
        uv.like,
        uv.subscribe,
        uv.comment,
        uv.comment_like,
        uv.filtering,
        uv.daily_budget,
        uv.total_budget,
        u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.user_id != $1
        AND u.balance >= (uv.duration_seconds * 0.00002)
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 20;
    `, [user_id]);

    const videos = videosRes.rows.map(v => ({
      id: v.id,
      user_id: v.user_id,
      title: v.title,
      video_url: v.video_url,
      duration_seconds: v.duration_seconds,
      views_count: v.views_count || 0,
      keywords: (() => {
        try {
          return Array.isArray(v.keywords) ? v.keywords : JSON.parse(v.keywords || '[]');
        } catch {
          return [];
        }
      })(),
      viewing_method: v.viewing_method || 'keyword',
      like: v.like || 'no',
      subscribe: v.subscribe || 'no',
      comment: v.comment || 'no',
      comment_like: v.comment_like || 'no',
      filtering: v.filtering || 'no',
      daily_budget: v.daily_budget || 0,
      total_budget: v.total_budget || 0,
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));

    return res.json({
      success: true,
      videos,
      count: videos.length
    });

  } catch (err) {
    console.error('❌ خطأ في /api/worker:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

app.post('/api/report', async (req, res) => {
  try {
    const { user_id, video_id, watched_seconds } = req.body;
    if (!user_id || !video_id || !watched_seconds)
      return res.status(400).json({ error: 'user_id, video_id, watched_seconds مطلوبة' });

    const videoRes = await pool.query(`
      SELECT uv.*, u.balance AS owner_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE uv.id = $1
    `, [video_id]);

    if (videoRes.rows.length === 0)
      return res.status(404).json({ error: 'الفيديو غير موجود' });

    const video = videoRes.rows[0];
    const owner_id = video.user_id;
    const duration = Math.min(video.duration_seconds, watched_seconds);

    const advertiserCost = duration * 0.00002;
    const workerReward = duration * 0.00001;

    if (parseFloat(video.owner_balance) < advertiserCost)
      return res.status(400).json({ error: 'رصيد المعلن غير كافٍ لدفع تكلفة المشاهدة' });

    await pool.query('BEGIN');

    await pool.query(`UPDATE users SET balance = balance - $1 WHERE telegram_id = $2`, [advertiserCost, owner_id]);
    await pool.query(`UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`, [workerReward, user_id]);
    await pool.query(`UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1`, [video_id]);

    await pool.query(`
      INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [user_id, 'watch', workerReward, 'Watching video', duration, video_id]);

    await pool.query('COMMIT');

    res.json({
      success: true,
      duration,
      advertiserCost,
      workerReward,
      message: 'تم تسجيل المشاهدة وتحديث الأرصدة بنجاح'
    });

  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('❌ /api/report:', err);
    res.status(500).json({ error: 'خطأ داخلي في الخادم' });
  }
});

app.get('/api/lang/full', async (req, res) => {
  try {
    const translations = {
      start_button: "ابدأ المشاهدة",
      stop_button: "إيقاف",
      balance_label: "رصيدك",
      coins_label: "العملات",
      membership_label: "العضوية",
      loading_text: "جارٍ تحميل المهام...",
      error_text: "حدث خطأ أثناء الاتصال بالخادم"
    };

    const payload = {
      lang: translations,
      server_time: new Date().toISOString()
    };

    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    res.json({ langData: encoded });

  } catch (err) {
    console.error('❌ /api/lang/full:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/notify', (req, res) => {
  res.json({
    success: true,
    message: "📢 لا توجد إشعارات جديدة حاليًا. استمر في المشاهدة لزيادة أرباحك!",
    timestamp: new Date().toISOString()
  });
});

app.get('/worker/', (req, res) => {
  res.status(200).json({
    ok: true,
    status: 'ready',
    message: 'Worker endpoint is active and ready 🚀',
    server_time: new Date().toISOString()
  });
});

// === بدء التشغيل ===
(async () => {
  try {
    await ensureTables();
    console.log('✅ الجداول جاهزة');
  } catch (err) {
    console.error('❌ فشل إنشاء الجداول:', err);
    process.exit(1);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Postback Server يعمل على المنفذ ${PORT}`);
  });
})();
