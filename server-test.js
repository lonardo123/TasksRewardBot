require('dotenv').config();
const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.send('✅ السيرفر يعمل بشكل منفصل!');
});

app.get('/callback', (req, res) => {
  res.send('📌 استقبلت callback. السر: ' + req.query.secret);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
