const crypto = require("crypto");

// هنا تدخل القيم يدوياً
const user_id = "6940442249";
const video_id = "12";
const watched_seconds = "50";
const source = "YouTube";

// نفس السر المستعمل في السيرفر (CALLBACK_SECRET)
const CALLBACK_SECRET = "MySuperSecretKey123ForCallbackOnly";  

// تكوين الـ payload
const payload = `${user_id}:${video_id}:${watched_seconds}:${source}`;

// حساب signature
const signature = crypto
  .createHmac("sha256", CALLBACK_SECRET)
  .update(payload)
  .digest("hex");

// تكوين الرابط النهائي
const url = `https://perceptive-victory-production.up.railway.app/video-callback?user_id=${user_id}&video_id=${video_id}&watched_seconds=${watched_seconds}&source=${source}&signature=${signature}`;

console.log("✅ الرابط النهائي:");
console.log(url);
