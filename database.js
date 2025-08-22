const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

client.connect();

// إنشاء الجداول إذا لم تكن موجودة
const initDB = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      balance DECIMAL DEFAULT 0,
      payeer_wallet VARCHAR,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS earnings (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      source VARCHAR(50),
      amount DECIMAL,
      description TEXT,
      timestamp TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      user_id BIGINT,
      amount DECIMAL,
      payeer_wallet VARCHAR,
      status VARCHAR(20) DEFAULT 'pending',
      requested_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP,
      admin_note TEXT
    );
  `;
  await client.query(query);
  console.log("✅ جداول قاعدة البيانات جاهزة");
};

module.exports = { client, initDB };
