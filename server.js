const express = require('express');
const callbackRouter = require('./handlers/callback'); // أو الكود الداخلي
require('dotenv').config();

const app = express();
app.use(express.json());

// === مسار اختبار ===
app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل! استقبلت طلبك بنجاح.');
});

// === استقبال Postback ===
app.use('/callback', callbackRouter);

// === الاستماع على المنفذ الصحيح ===
const PORT = process.env.PORT || 8080;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
