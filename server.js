require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { pool } = require('./db');

// التقاط أي أخطاء لاحقة في الـ pool
pool.on('error', (err) => {
  console.error('⚠️ PG pool error:', err);
});

// === السيرفر (Express)
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ✅ هذا هو المسار الصحيح لإضافة كروم
app.get('/worker/start', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/worker/start.html'));
});

// 🧠 لتخزين آخر رسالة سيرفر مؤقتًا
let currentMessage = null;

// 🧩 1. Endpoint لإرسال أمر من السيرفر (مثلاً عبر لوحة التحكم أو API)
app.post("/api/server/send", (req, res) => {
  const { action, data } = req.body;
  if (!action) {
    return res.status(400).json({ status: "error", message: "action required" });
  }
  currentMessage = { action, data: data || {}, time: new Date().toISOString() };
  console.log("📨 تم تعيين رسالة جديدة إلى الإضافة:", currentMessage);
  res.json({ status: "ok", message: currentMessage });
});

// 🧩 2. Endpoint تطلبه الإضافة بشكل دوري (Polling)
app.get("/api/worker/message", (req, res) => {
  if (currentMessage) {
    res.json(currentMessage);
    // إعادة تعيين الرسالة حتى لا تتكرر
    currentMessage = null;
  } else {
    res.json({ action: "NONE" });
  }
});
async function getOrCreateUser(client, telegramId) {
  let q = await client.query(
    'SELECT id, balance FROM users WHERE telegram_id = $1',
    [telegramId]
  );

  if (q.rows.length === 0) {
    q = await client.query(
      'INSERT INTO users (telegram_id, balance) VALUES ($1, 0) RETURNING id, balance',
      [telegramId]
    );
  }

  return {
    userDbId: q.rows[0].id,
    balance: Number(q.rows[0].balance)
  };
}

async function getOrCreateUser(client, telegram_id) {
  // جلب المستخدم
  let userQ = await client.query(
    'SELECT id, balance FROM users WHERE telegram_id = $1',
    [telegram_id]
  );

  // إذا لم يوجد، إنشاء المستخدم
  if (!userQ.rows.length) {
    userQ = await client.query(
      'INSERT INTO users (telegram_id, balance) VALUES ($1, 0) RETURNING id, balance',
      [telegram_id]
    );
  }

  return {
    userDbId: userQ.rows[0].id,
    balance: Number(userQ.rows[0].balance)
  };
}

// ======================= API: جلب بيانات الاستثمار =======================
app.get('/api/investment-data', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.json({ status: "error", message: "user_id is required" });
    }

    const settingsQ = await pool.query(`
      SELECT price, admin_fee_fixed, admin_fee_percent
      FROM stock_settings
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    if (!settingsQ.rows.length) {
      return res.json({ status: "error", message: "Stock price is not set" });
    }

    const userQ = await pool.query(
      `SELECT balance FROM users WHERE telegram_id = $1`,
      [user_id]
    );

    if (!userQ.rows.length) {
      await pool.query(
        `INSERT INTO users (telegram_id, balance) VALUES ($1, 0)`,
        [user_id]
      );
    }

    const stocksQ = await pool.query(
      `SELECT stocks FROM user_stocks WHERE telegram_id = $1`,
      [user_id]
    );

    res.json({
      status: "success",
      data: {
        price: Number(settingsQ.rows[0].price),
        balance: Number(userQ.rows[0]?.balance || 0),
        stocks: Number(stocksQ.rows[0]?.stocks || 0),
        admin_fee_fixed: Number(settingsQ.rows[0].admin_fee_fixed),
        admin_fee_percent: Number(settingsQ.rows[0].admin_fee_percent)
      }
    });

  } catch (err) {
    console.error(err);
    res.json({ status: "error", message: "Error loading investment data" });
  }
});

// ======================= شراء الأسهم =======================
app.post('/api/buy-stock', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, quantity } = req.body;
    if (!user_id || quantity <= 0) {
      return res.json({ status: "error", message: "Invalid data" });
    }

    await client.query('BEGIN');
    // =======================
// 1️⃣ جلب الحد الأقصى للشراء
// =======================
const maxQ = await client.query(`
  SELECT max_buy
  FROM stock_limits
  ORDER BY updated_at DESC
  LIMIT 1
`);
const maxBuy = maxQ.rows[0]?.max_buy || 0;

// =======================
// 2️⃣ جلب أسهم المستخدم الحالية
// =======================
const userStocksQ = await client.query(`
  SELECT stocks
  FROM user_stocks
  WHERE telegram_id = $1
  FOR UPDATE
`, [user_id]);

const currentStocks = userStocksQ.rows[0]?.stocks || 0;

if (currentStocks + quantity > maxBuy) {
  await client.query('ROLLBACK');
  return res.json({
    status: "error",
    message: "❌ Max buy limit exceeded"
  });
}

// =======================
// 3️⃣ جلب الأسهم المتاحة إجمالاً
// =======================
const globalQ = await client.query(`
  SELECT total_stocks
  FROM stock_global
  WHERE id = 1
  FOR UPDATE
`);

const availableStocks = globalQ.rows[0].total_stocks;

if (quantity > availableStocks) {
  await client.query('ROLLBACK');
  return res.json({
    status: "error",
    message: "❌ Not enough stocks available"
  });
}

    const userQ = await client.query(
      `SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`,
      [user_id]
    );

    const balance = Number(userQ.rows[0]?.balance || 0);

    const priceQ = await client.query(`
      SELECT price, admin_fee_fixed, admin_fee_percent
      FROM stock_settings
      ORDER BY updated_at DESC LIMIT 1
    `);

    const price = Number(priceQ.rows[0].price);
    const fixedFee = Number(priceQ.rows[0].admin_fee_fixed);
    const percentFee = Number(priceQ.rows[0].admin_fee_percent);

    const subtotal = price * quantity;
    const fee = fixedFee + (subtotal * percentFee / 100);
    const total = subtotal + fee;

    if (balance < total) {
      await client.query('ROLLBACK');
      return res.json({ status: "error", message: "Insufficient balance" });
    }

    await client.query(
      `UPDATE users SET balance = balance - $1 WHERE telegram_id = $2`,
      [total, user_id]
    );

    await client.query(`
      INSERT INTO user_stocks (telegram_id, stocks)
      VALUES ($1, $2)
      ON CONFLICT (telegram_id)
      DO UPDATE SET stocks = user_stocks.stocks + $2
    `, [user_id, quantity]);

    // خصم الأسهم من المخزون العام
await client.query(`
  UPDATE stock_global
  SET total_stocks = total_stocks - $1
  WHERE id = 1
`, [quantity]);

    await client.query(`
      INSERT INTO stock_transactions
      (telegram_id, type, quantity, price, fee, total)
      VALUES ($1, 'BUY', $2, $3, $4, $5)
    `, [user_id, quantity, price, fee, total]);

    // =======================
// تسجيل دفعة شراء مقفولة 15 يوم
// =======================
await client.query(`
  INSERT INTO stock_holdings
  (telegram_id, quantity, bought_at, unlock_at)
  VALUES ($1, $2, NOW(), NOW() + INTERVAL '15 days')
`, [user_id, quantity]);

    await client.query('COMMIT');

    res.json({ status: "success", message: "Purchase completed successfully" });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ status: "error", message: "Purchase failed" });
  } finally {
    client.release();
  }
});


// ======================= بيع الأسهم =======================
app.post('/api/sell-stock', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, quantity } = req.body;
    if (!user_id || quantity <= 0) {
      return res.json({ status: "error", message: "Invalid data" });
    }

    await client.query('BEGIN');
    // =======================
// حساب الأسهم المتاحة للبيع فقط
// =======================
const unlockedQ = await client.query(`
  SELECT COALESCE(SUM(quantity - sold), 0) AS available
  FROM stock_holdings
  WHERE telegram_id = $1
    AND unlock_at <= NOW()
`, [user_id]);

const sellableStocks = Number(unlockedQ.rows[0].available);

if (sellableStocks < quantity) {
  await client.query('ROLLBACK');
  return res.json({
    status: "error",
    message: "❌ You can sell stocks only after 15 days from purchase"
  });
}
// =======================
// خصم الأسهم من دفعات الشراء (FIFO)
// =======================
let remainingToSell = quantity;

// جلب الدفعات القابلة للبيع
const batchesQ = await client.query(`
  SELECT id, quantity, sold
  FROM stock_holdings
  WHERE telegram_id = $1
    AND unlock_at <= NOW()
    AND quantity > sold
  ORDER BY bought_at ASC
  FOR UPDATE
`, [user_id]);

for (const batch of batchesQ.rows) {
  if (remainingToSell <= 0) break;

  const canSell = batch.quantity - batch.sold;
  const sellNow = Math.min(canSell, remainingToSell);

  await client.query(`
    UPDATE stock_holdings
    SET sold = sold + $1
    WHERE id = $2
  `, [sellNow, batch.id]);

  remainingToSell -= sellNow;
}

    // =======================
// إعادة الأسهم للمخزون العام
// =======================
await client.query(`
  UPDATE stock_global
  SET total_stocks = total_stocks + $1
  WHERE id = 1
`, [quantity]);

    const userQ = await client.query(
      `SELECT balance FROM users WHERE telegram_id = $1 FOR UPDATE`,
      [user_id]
    );

    if (!userQ.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ status: "error", message: "User not found" });
    }

    const stockQ = await client.query(
      `SELECT stocks FROM user_stocks WHERE telegram_id = $1 FOR UPDATE`,
      [user_id]
    );

    if (!stockQ.rows.length || stockQ.rows[0].stocks < quantity) {
      await client.query('ROLLBACK');
      return res.json({ status: "error", message: "Insufficient stocks" });
    }

    const priceQ = await client.query(`
      SELECT price, admin_fee_fixed, admin_fee_percent
      FROM stock_settings
      ORDER BY updated_at DESC
      LIMIT 1
    `);

    const price = Number(priceQ.rows[0].price);
    const fixedFee = Number(priceQ.rows[0].admin_fee_fixed);
    const percentFee = Number(priceQ.rows[0].admin_fee_percent);

    const gross = price * quantity;
    const fee = fixedFee + (gross * percentFee / 100);
    const total = gross - fee;

    await client.query(
      `UPDATE users SET balance = balance + $1 WHERE telegram_id = $2`,
      [total, user_id]
    );

    await client.query(
      `UPDATE user_stocks SET stocks = stocks - $1 WHERE telegram_id = $2`,
      [quantity, user_id]
    );

    await client.query(`
      INSERT INTO stock_transactions
      (telegram_id, type, quantity, price, fee, total)
      VALUES ($1, 'SELL', $2, $3, $4, $5)
    `, [user_id, quantity, price, fee, total]);

    await client.query('COMMIT');

    res.json({ status: "success", message: "Stocks sold successfully" });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ status: "error", message: "Sale failed" });
  } finally {
    client.release();
  }
});

// ======================= سجل الصفقات =======================
app.get('/api/transactions', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) {
      return res.json({ status: "error", message: "user_id is required" });
    }

    const q = await pool.query(`
      SELECT type, quantity, price, fee, total, created_at
      FROM stock_transactions
      WHERE telegram_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [user_id]);

    res.json({
      status: "success",
      data: q.rows.map(r => ({
        type: r.type,
        quantity: Number(r.quantity),
        price: Number(r.price),
        fee: Number(r.fee),
        total: Number(r.total),
        date: r.created_at
      }))
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "Failed to load investment data" });
  }
});
// ================= الأسهم المقفولة والمتاحة للمستخدم ======================
app.get('/api/my-stock-locks', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ message: "user_id is required" });
  }

  const q = await pool.query(`
    SELECT
      quantity,
      sold,
      bought_at,
      unlock_at,
      (quantity - sold) AS remaining,
      unlock_at > NOW() AS locked
    FROM stock_holdings
    WHERE telegram_id = $1
    ORDER BY bought_at DESC
  `, [user_id]);

  res.json(q.rows);
});

// ======================= الرسم البياني =======================
app.get('/api/stock-chart', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT price, updated_at
      FROM stock_settings
      ORDER BY updated_at ASC
      LIMIT 30
    `);

    res.json({
      status: "success",
      data: q.rows.map(r => ({
        price: Number(r.price),
        date: r.updated_at
      }))
    });
  } catch (err) {
    console.error('❌ خطأ في /api/stock-chart:', err.message);
    res.status(500).json({ status: "error", message: "Failed to load chart data" });
  }
});


// ======================= تحديث السعر من الادمن =======================
app.post('/api/admin/update-price', async (req, res) => {
  try {
    const { new_price, admin_fee_fixed = 0.05, admin_fee_percent = 3 } = req.body;
    if (!new_price || new_price <= 0) {
      return res.status(400).json({ status: "error", message: "سعر غير صالح" });
    }

    await pool.query(`
      INSERT INTO stock_settings (price, admin_fee_fixed, admin_fee_percent, updated_at)
      VALUES ($1, $2, $3, NOW())
    `, [new_price, admin_fee_fixed, admin_fee_percent]);

    res.json({
      status: "success",
      message: "تم تحديث السعر",
      data: { price: new_price }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: "error", message: "فشل التحديث" });
  }
});

app.get('/investment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'investment.html'));
});
// ======================= إجمالي الأسهم لجميع المستخدمين =======================
app.get('/api/total-stocks', async (req, res) => {
  try {
    const q = await pool.query(`
      SELECT COALESCE(SUM(stocks), 0) AS total_stocks
      FROM user_stocks
    `);

    res.json({
      status: "success",
      total_stocks: Number(q.rows[0].total_stocks)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      status: "error",
      message: "Failed to load total stocks"
    });
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
      keywords: Array.isArray(v.keywords) ? v.keywords : []   // نتأكد إنها Array
    }));
    return res.json(videos);
  } catch (err) {
    console.error('Error in /api/my-videos:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

app.post('/admin/set-price', async (req, res) => {
  const { price } = req.body;
  const parsedPrice = parseFloat(price);
  if (isNaN(parsedPrice) || parsedPrice < 0) {
    return res.json({ success: false, message: "❌ Invalid price" });
  }
  await pool.query(
    'INSERT INTO stock_settings (price, updated_at) VALUES ($1, NOW())',
    [parsedPrice]
  );
  res.json({
    success: true,
    message: `✅ Price updated to ${parsedPrice}`
  });
});

app.post('/admin/set-max', async (req, res) => {
  const { max } = req.body;
  try {
    await pool.query(
      'INSERT INTO stock_limits(max_buy) VALUES($1)',
      [max]
    );
    res.json({ message: "تم تحديث الحد الأقصى" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "فشل تحديث الحد الأقصى" });
  }
});
// =======================
// تحديث إجمالي الأسهم (ADMIN)
// =======================
app.post('/admin/set-total-stocks', async (req, res) => {
  try {
    const { total } = req.body;

    if (total === undefined || total < 0) {
      return res.json({
        success: false,
        message: "Invalid total stocks"
      });
    }

    await pool.query(`
      UPDATE stock_global
      SET total_stocks = $1,
          updated_at = NOW()
      WHERE id = 1
    `, [total]);

    res.json({
      success: true,
      message: "Total stocks updated"
    });

  } catch (err) {
    console.error('❌ set-total-stocks:', err);
    res.status(500).json({
      success: false,
      message: "Server error"
    });
  }
});
// =======================
// الأسهم المتاحة للشراء (GLOBAL)
// =======================
app.get('/api/available-stocks', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT total_stocks
      FROM stock_global
      WHERE id = 1
    `);

    res.json({
      status: "success",
      available: Number(r.rows[0].total_stocks)
    });

  } catch (err) {
    console.error('❌ available-stocks:', err);
    res.status(500).json({
      status: "error",
      message: "Failed to load available stocks"
    });
  }
});

// مثال endpoint في السيرفر
app.get('/admin/users-stocks', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        u.telegram_id AS user,
        u.balance,
        COALESCE(s.stocks, 0) AS total_stocks
      FROM users u
      LEFT JOIN user_stocks s
        ON u.telegram_id = s.telegram_id
      ORDER BY u.telegram_id ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('❌ users-stocks error:', err);
    res.status(500).json({ error: 'Server error' });
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
    const user_id = req.query.user_id; // *** مهم لجلب المعرف المرسل
    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    const videos = await pool.query(
      `
      SELECT
      uv.id, uv.title, uv.video_url, uv.duration_seconds, uv.user_id, uv.keywords,
      u.balance >= (uv.duration_seconds * 0.00002) AS has_enough_balance
      FROM user_videos uv
      JOIN users u ON uv.user_id = u.telegram_id
      WHERE
      u.balance >= (uv.duration_seconds * 0.00002)
      AND uv.user_id::text != $1::text
      AND NOT EXISTS (
        SELECT 1 FROM watched_videos w
        WHERE
        w.video_id = uv.id
        AND w.user_id::text = $1::text
        AND w.watched_at > (NOW() - INTERVAL '28 hours')
      )
      ORDER BY uv.views_count ASC, uv.created_at DESC
      LIMIT 50
      `,
      [user_id]
    );
    const available = videos.rows.filter(v => v.has_enough_balance);
    const mapped = available.map(v => {
      let keywords = [];
      if (v.keywords) {
        try {
          if (typeof v.keywords === "string") {
            keywords = JSON.parse(v.keywords);
          } else if (Array.isArray(v.keywords)) {
            keywords = v.keywords;
          }
        } catch {
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
    await pool.query('BEGIN');
    // ✅ التحقق من عدم تكرار العملية
    const existing = await pool.query(
      'SELECT * FROM earnings WHERE user_id = $1 AND source = $2 AND description = $3',
      [user_id, source, `Transaction: ${transaction_id}`]
    );
    if (existing.rows.length > 0) {
      await pool.query('ROLLBACK');
      console.log(`🔁 عملية مكررة تم تجاهلها: ${transaction_id}`);
      return res.status(200).send('Duplicate transaction ignored');
    }
    // ✅ تأكد أن المستخدم موجود أو أضفه
    const userCheck = await pool.query(
      'SELECT balance FROM users WHERE telegram_id = $1',
      [user_id]
    );
    if (userCheck.rows.length === 0) {
      // لو المستخدم مش موجود → إنشاؤه برصيد أولي
      await pool.query(
        'INSERT INTO users (telegram_id, balance, created_at) VALUES ($1, $2, NOW())',
        [user_id, finalAmount]
      );
    } else {
      // لو موجود → تحديث رصيده
      await pool.query(
        'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
        [finalAmount, user_id]
      );
    }
    // ✅ إضافة سجل الأرباح
    await pool.query(
      `INSERT INTO earnings (user_id, source, amount, description, watched_seconds, video_id, created_at)
      VALUES ($1, $2, $3, $4, NULL, NULL, NOW())`,
      [user_id, source, finalAmount, `Transaction: ${transaction_id}`]
    );
    console.log(`🟢 [${source}] أضيف ${finalAmount}$ (${percentage * 100}% من ${parsedAmount}$) للمستخدم ${user_id} (Transaction: ${transaction_id})`);
    // ✅ التحقق من وجود محيل
    const ref = await pool.query(
      'SELECT referrer_id FROM referrals WHERE referee_id = $1 LIMIT 1',
      [user_id]
    );
    if (ref.rows.length > 0) {
      const referrerId = ref.rows[0].referrer_id;
      const bonus = parsedAmount * 0.03; // 3% للمحيل
      // تحديث رصيد المحيل
      const refCheck = await pool.query(
        'SELECT balance FROM users WHERE telegram_id = $1',
        [referrerId]
      );
      if (refCheck.rows.length === 0) {
        // لو المحيل مش موجود → إنشاؤه برصيد أولي
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
      // إضافة سجل أرباح للمحيل
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
    // التحقق من السر
    if (secret !== process.env.CALLBACK_SECRET) {
      return res.status(403).send('Forbidden: Invalid Secret');
    }
    // جلب بيانات الفيديو
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
    // تحقق من رصيد صاحب الفيديو
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
    // خصم تكلفة المشاهدة من صاحب الفيديو
    await pool.query(
      'UPDATE users SET balance = balance - $1 WHERE telegram_id = $2',
      [cost, owner_id]
    );
    // تأكد إذا المشاهد موجود أو أضفه
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
    // إضافة المكافأة للمشاهد
    await pool.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [reward, user_id]
    );
    // إضافة سجل للأرباح
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
    // تحديث عداد المشاهدات للفيديو
    await pool.query(
      'UPDATE user_videos SET views_count = views_count + 1 WHERE id = $1',
      [video_id]
    );
    // ✅ تسجيل المشاهدة في جدول watched_videos
    await pool.query(
      `INSERT INTO watched_videos (user_id, video_id, watched_at)
      VALUES ($1, $2, NOW())`,
      [user_id, video_id]
    );
    await pool.query('COMMIT');
    console.log(
      `✅ فيديو ${video_id}: ${reward}$ للمشاهد ${user_id} — watched_seconds=${watched_seconds}`
    );
    return res.status(200).send({ "status": "success" });
  } catch (err) {
    try {
      await pool.query('ROLLBACK');
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
    const result = await pool.query(
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

/* ============================
🔹 /api/check — فحص حالة المستخدم
============================ */
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

/* ============================
🔹 /api/worker — جلب فيديوهات للمشاهدة
============================ */
app.post('/api/worker/start', async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id مطلوب' });
    // 🧩 تأكد من وجود المستخدم (العامل)
    const userCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }
    // 🎥 جلب الفيديوهات المتاحة من المعلنين فقط (ليست للعامل نفسه)
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
    // 🧠 تنسيق النتائج المرسلة للعامل
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
      // 💰 المكافأة للعامل تُحسب بناءً على مدة الفيديو
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),
      // 💸 تكلفة المعلن
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));
    // 🚀 إرسال النتيجة
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
    // 🧩 تأكد من وجود المستخدم (العامل)
    const userCheck = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [user_id]);
    if (userCheck.rows.length === 0) {
      await pool.query('INSERT INTO users (telegram_id, balance) VALUES ($1, 0)', [user_id]);
    }
    // 🎥 جلب الفيديوهات المتاحة من المعلنين فقط (ليست للعامل نفسه)
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
    // 🧠 تنسيق النتائج المرسلة للعامل
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
      // 💰 المكافأة للعامل تُحسب بناءً على مدة الفيديو
      reward_per_second: 0.00001,
      reward_total: parseFloat((v.duration_seconds * 0.00001).toFixed(6)),
      // 💸 تكلفة المعلن
      cost_to_owner: parseFloat((v.duration_seconds * 0.00002).toFixed(6))
    }));
    // 🚀 إرسال النتيجة
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

/* ============================
🔹 /api/report — تسجيل مشاهدة وتحديث الرصيد
============================ */
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

/* ============================
🔹 /api/lang/full — ترجمة واجهة الإضافة
============================ */
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

/* ============================
🔹 /api/notify — إشعار بسيط للعميل
============================ */
app.get('/api/notify', (req, res) => {
  res.json({
    success: true,
    message: "📢 لا توجد إشعارات جديدة حاليًا. استمر في المشاهدة لزيادة أرباحك!",
    timestamp: new Date().toISOString()
  });
});

/* ============================================
🔹 /worker/ — فحص جاهزية العامل (GET)
يستخدمه المتصفح أو الإضافة للتحقق من أن السيرفر يعمل
============================================ */
app.get('/worker/', (req, res) => {
  res.status(200).json({
    ok: true,
    status: 'ready',
    message: 'Worker endpoint is active and ready 🚀',
    server_time: new Date().toISOString()
  });
});

// === بدء التشغيل ===
const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
