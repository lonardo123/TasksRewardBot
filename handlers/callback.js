const express = require('express');
const { client } = require('../database');
require('dotenv').config();

const callbackRouter = express.Router();

callbackRouter.get('/callback', async (req, res) => {
  const { user_id, amount, offer, secret } = req.query;

  if (secret !== process.env.CALLBACK_SECRET) {
    return res.status(403).send('Forbidden');
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) return res.status(400).send('Invalid amount');

  try {
    await client.query('BEGIN');

    // تحديث الرصيد
    await client.query(
      'UPDATE users SET balance = balance + $1 WHERE telegram_id = $2',
      [parsedAmount, user_id]
    );

    // تسجيل الأرباح
    await client.query(
      'INSERT INTO earnings (user_id, source, amount, description) VALUES ($1, $2, $3, $4)',
      [user_id, 'cpa_offer', parsedAmount, offer || 'Offer Completed']
    );

    await client.query('COMMIT');

    res.status(200).send('OK');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Error');
  }
});

module.exports = callbackRouter;
