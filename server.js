const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

// === مسار اختبار ===
app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! استقبلت طلبك بنجاح.');
});

// === مؤقتًا: تعطيل callbackRouter ===
app.get('/callback', (req, res) => {
  res.send('📌 تم استقبال callback. السر: ' + req.query.secret);
});

// === الاستماع على المنفذ الصحيح ===
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
