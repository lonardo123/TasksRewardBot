import express from "express";
import pkg from "pg";

const { Pool } = pkg;
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// TimeWall Postback
app.get("/postback/timewall", async (req, res) => {
  try {
    const { userID, transactionID, revenue, currencyAmount, type } = req.query;

    if (!userID || !transactionID) {
      return res.status(400).send("Missing parameters");
    }

    // تحقق لو الترانزكشن متسجل قبل كده
    const checkTx = await pool.query(
      "SELECT id FROM transactions WHERE transaction_id = $1",
      [transactionID]
    );
    if (checkTx.rowCount > 0) {
      return res.status(200).send("Duplicate transaction");
    }

    // أضف الترانزكشن
    await pool.query(
      "INSERT INTO transactions (transaction_id, user_id, revenue, currency_amount, type) VALUES ($1,$2,$3,$4,$5)",
      [transactionID, userID, revenue, currencyAmount, type]
    );

    // عدل رصيد المستخدم
    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [currencyAmount, userID]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("TimeWall Postback Error:", err);
    res.sendStatus(500);
  }
});

// CPAlead Postback
app.get("/postback/cpalead", async (req, res) => {
  try {
    const { subid, trans_id, amount } = req.query;

    if (!subid || !trans_id) {
      return res.status(400).send("Missing parameters");
    }

    const checkTx = await pool.query(
      "SELECT id FROM transactions WHERE transaction_id = $1",
      [trans_id]
    );
    if (checkTx.rowCount > 0) {
      return res.status(200).send("Duplicate transaction");
    }

    await pool.query(
      "INSERT INTO transactions (transaction_id, user_id, revenue, currency_amount, type) VALUES ($1,$2,$3,$3,'credit')",
      [trans_id, subid, amount]
    );

    await pool.query(
      "UPDATE users SET balance = balance + $1 WHERE id = $2",
      [amount, subid]
    );

    res.sendStatus(200);
  } catch (err) {
    console.error("CPAlead Postback Error:", err);
    res.sendStatus(500);
  }
});

// Ping route
app.get("/", (req, res) => {
  res.send("Bot is running ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
