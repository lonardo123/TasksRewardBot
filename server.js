require('dotenv').config();
const { Client } = require('pg');
const express = require('express');
const crypto = require('crypto'); // تمت الإضافة هنا لاحتساب HMAC

// === قاعدة البيانات ===
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function connectDB() {
  try {
    await client.connect();
    console.log('✅ اتصال قاعدة البيانات ناجح');

    // ✅ إنشاء الجداول إذا لم تكن موجودة
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

  CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id BIGINT,
    referee_id BIGINT,
    created_at TIMESTAMP DEFAULT NOW()
  );
  
  CREATE TABLE IF NOT EXISTS user_videos (
    id SERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    title VARCHAR(255) NOT NULL,
    video_url TEXT NOT NULL,
    duration_seconds INT NOT NULL CHECK (duration_seconds >= 50),
    views_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );      

  -- ✅ تعديلات جدول earnings
  ALTER TABLE earnings ADD COLUMN IF NOT EXISTS watched_seconds INTEGER;
  ALTER TABLE earnings ADD COLUMN IF NOT EXISTS video_id VARCHAR(255);
  ALTER TABLE earnings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
`);

console.log('✅ الجداول والأعمدة أنشئت أو موجودة مسبقًا');
  } catch (err) {
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    setTimeout(connectDB, 5000); // إعادة المحاولة
  }
}

// === السيرفر ===
const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! Postback جاهز.');
});

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

  // ✅ تحديد الشبكة
  const source = network === 'bitcotasks' ? 'bitcotasks' : 'offer';

  try {
    const existing = await client.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );

    if (existing.rows.length > 0) {
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return res.status(200).send('Duplicate transaction ignored');
    }

    // ✅ تحديث رصيد المستخدم
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [finalAmount, user_id]
    );

    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );

    console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${parsedAmount}$) للمستخدم ${user_id} (Transaction: ${transaction_id})`);

    // ✅ التحقق من وجود محيل للمستخدم
    const ref = await client.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1',
      [user_id]
    );

    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03; // 3% للمحيل

      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [bonus, referrerId]
      );

      await client.query(
        'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
        [referrerId, 'referral', bonus, `Referral bonus from ${user_id} (Transaction: ${transaction_id})`]
      );

      console.log(`👥 تم إضافة ${bonus}$ (3%) للمحيل ${referrerId} من ربح المستخدم ${user_id}`);
    }

    res.status(200).send('تمت المعالجة بنجاح');
  } catch (err) {
    console.error('Callback Error:', err);
    res.status(500).send('Server Error');
  }
});


// === Unity Ads S2S Callback ===
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

    // prepare param string per Unity's format (exclude hmac, sort keys)
    const paramsToSign = { ...params };
    delete paramsToSign.hmac;
    const keys = Object.keys(paramsToSign).sort();
    const paramString = keys.map(k => `${k}=${paramsToSign[k] === null ? '' : paramsToSign[k]}`).join(',');

    // compute HMAC-MD5
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

    // قيمة ثابتة للمكافأة من مشاهدة الإعلان: 0.0005$
    const reward = 0.0005;

    // تجنب التكرار
    const dup = await client.query('SELECT 1 FROM earnings WHERE source=$1 AND description=$2 LIMIT 1', ['unity', `oid:${oid}`]);
    if (dup.rows.length > 0) {
      console.log('🔁 Unity callback duplicate oid ignored', oid);
      return res.status(200).send('Duplicate order ignored');
    }

    // ابدأ المعاملة (transaction)
    await client.query('BEGIN');

    // تأكد من وجود المستخدم وإلا أنشئه
    const uRes = await client.query('SELECT telegram_id FROM users WHERE telegram_id = $1', [sid]);
    if (uRes.rowCount === 0) {
      await client.query('INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())', [sid, 0]);
    }

    // حدث رصيد المستخدم وأدرج السجل في earnings
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [reward, sid]);
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1,$2,$3,$4)',
      [sid, 'unity', reward, `oid:${oid}`]
    );

    // أكمل المعاملة
    await client.query('COMMIT');

    console.log(`🎬 Unity S2S: credited ${reward}$ to ${sid} (oid=${oid})`);

    // Unity expects "1" on success
    res.status(200).send('1');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('Error on /unity-callback', err);
    res.status(500).send('Server Error');
  }
});

// مكافأة المشاهدة — مع تحقق HMAC وتخزين source + watched_seconds
app.get('/video-callback', async (req, res) => {
  // ملاحظة: نستخدم client (الـ pg Client) كما في بقية الملف
  let { user_id, video_id, watched_seconds, source, signature } = req.query;

  // تحقق متطلبات الحدّ الأدنى (حافظ على التوافق الرجعي: إذا لم يكن CALLBACK_SECRET معرفًا
  // سنقبل شكل الطلب السابق الذي كان يطلب فقط user_id و video_id)
  if (!user_id || !video_id) {
    return res.status(400).send('Missing user_id or video_id');
  }

  try {
    // إذا تم إعداد CALLBACK_SECRET في .env => نفرض وجود watched_seconds, source, signature ونتحقق من HMAC
    const secret = process.env.CALLBACK_SECRET;
    if (secret) {
      if (!watched_seconds || !source || !signature) {
        return res.status(400).send('Missing required parameters (watched_seconds, source or signature) with CALLBACK_SECRET set');
      }

      // نبني الحمولة المتفق عليها للتوقيع: user_id:video_id:watched_seconds:source
      const payload = `${user_id}:${video_id}:${watched_seconds}:${source}`;
      const expectedSignature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      if (signature !== expectedSignature) {
        console.warn('video-callback: invalid signature', { user_id, video_id, payload, signature, expectedSignature: expectedSignature.slice(0,8) + '...' });
        return res.status(403).send('Invalid signature');
      }
    } else {
      // إذا لم يُعرّف CALLBACK_SECRET نواصل التوافق القديم — نملأ القيم الافتراضية إن لم تُرسل
      watched_seconds = watched_seconds || null;
      source = source || 'YouTube';
    }

    // جلب بيانات الفيديو (المالك والمدة)
    const videoRes = await client.query(
      'SELECT user_id AS owner_id, duration_seconds FROM user_videos WHERE id = $1',
      [video_id]
    );
    if (videoRes.rows.length === 0) {
      return res.status(400).send('الفيديو غير موجود');
    }

    const { owner_id, duration_seconds } = videoRes.rows[0];

    // احتساب المكافأة والتكلفة كما في الكود الأصلي (نعتمد مدة الفيديو المخزنة في DB)
    const reward = duration_seconds * 0.00001;
    const cost = duration_seconds * 0.00002;

    // بداية المعاملة
    await client.query('BEGIN');

    // تحقق رصيد صاحب الفيديو
    const ownerBalanceRes = await client.query('SELECT balance FROM users WHERE telegram_id = $1', [owner_id]);
    if (ownerBalanceRes.rows.length === 0 || parseFloat(ownerBalanceRes.rows[0].balance) < cost) {
      await client.query('ROLLBACK');
      return res.status(400).send('رصيد صاحب الفيديو غير كافٍ');
    }

    // خصم تكلفة المشاهدة من صاحب الفيديو
    await client.query('UPDATE users SET balance = balance - $1 WHERE telegram_id = $2', [cost, owner_id]);

    // تأكد من وجود صف للمشاهد (create if not exists)
    const viewerExists = await client.query('SELECT 1 FROM users WHERE telegram_id = $1', [user_id]);
    if (viewerExists.rows.length === 0) {
      await client.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }

    // إضافة رصيد للمشاهد
    await client.query('UPDATE users SET balance = balance + $1 WHERE telegram_id = $2', [reward, user_id]);

    // سجل الأرباح — نُدرج source و watched_seconds و video_id
    // التطبيقات القديمة كانت تستخدم: (user_id, source, amount, description)
    // هنا نضيف watched_seconds و video_id للحفاظ على السجل الكامل
    await client.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        user_id,                        // $1
        source || 'user_video',         // $2  (مثلاً YouTube/Facebook/Instagram) — أو 'user_video' إذا لم يُرسل
        reward,                         // $3
        \`user_video:\${video_id}\`,     // $4 الوصف كما في الأصل
        (watched_seconds ? parseInt(watched_seconds) : null), // $5
        video_id                        // $6
      ]
    );

    // زيادة عدّاد المشاهدات للفيديو
    await client.query('UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1', [video_id]);

    // إنهاء المعاملة بنجاح
    await client.query('COMMIT');

    console.log(\`✅ فيديو \${video_id}: \${reward}$ للمشاهد \${user_id} — source=\${source} watched_seconds=\${watched_seconds}\`);
    return res.status(200).send('Success');
  } catch (err) {
    // في حالة أي خطأ: تراجع المعاملة (إن لم يتم التراجع بالفعل)
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore rollback errors */ }
    console.error('Error in /video-callback:', err);
    return res.status(500).send('Server Error');
  }
});


// === التشغيل ===
(async () => {
  await connectDB();

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Postback Server يعمل على المنفذ ${PORT}`);
  });
})();
