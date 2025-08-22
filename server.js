const express = require('express');
const callbackRouter = require('./handlers/callback');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/callback', callbackRouter);

app.get('/', (req, res) => {
  res.send('Bot Server Running');
});

app.listen(PORT, () => {
  console.log(`✅ السيرفر يعمل على المنفذ ${PORT}`);
});
