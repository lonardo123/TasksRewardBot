# Telegram CPA Bot with TimeWall & CPAlead

بوت تليجرام يدعم:
- لوحة الأدمن داخل البوت.
- إضافة الرصيد تلقائياً من TimeWall و CPAlead.
- طلبات سحب المستخدمين وقبول/رفض من الأدمن.
- PostgreSQL على Railway.

## المتطلبات
- Node.js >=18
- Telegram Bot Token
- حساب TimeWall و CPAlead
- قاعدة PostgreSQL (Railway)
- حساب Payeer (اختياري)

## خطوات الإعداد
1. رفع الملفات على GitHub.
2. إنشاء مشروع جديد على Railway.
3. إضافة قاعدة PostgreSQL على Railway.
4. نفّذ db.sql لإنشاء الجداول.
5. اضبط متغيرات البيئة كما في .env.example.
6. ضع WEBHOOK_URL الذي يعطيه Railway.
7. اضبط Postback URL في TimeWall:

https://your-app-name.up.railway.app/postback/timewall?userID={userID}&transactionID={transactionID}&revenue={revenue}&currencyAmount={currencyAmount}&type={type}&hash={hash}

8. شغل المشروع على Railway.

## تشغيل محلي
npm install
node index.js

## ملاحظات
- تأكد من أن webhook في Telegram مضبوط.
- تحقق من TimeWall و CPAlead Postback macros.