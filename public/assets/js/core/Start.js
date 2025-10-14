import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// لتحديد مجلد المشروع بدقة
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// تقديم الملفات الثابتة (JS / CSS / HTML)
app.use(express.static(path.join(__dirname, "public")));

// صفحة العامل
app.get("/worker/start", (req, res) => {
  // يقرأ user_id من الرابط
  const userId = req.query.user_id || "";

  // يعرض صفحة HTML تضم الكود الخاص بك
  res.send(`
<!DOCTYPE html>
<html lang="ar">
<head>
  <meta charset="UTF-8">
  <title>Worker Start</title>
  <style>
    body { font-family: sans-serif; text-align: center; direction: rtl; }
    #loader-wrapper { margin-top: 50px; font-size: 20px; color: #444; }
    #video-container { display: none; }
    #progress { height: 10px; background: #4caf50; width: 0%; transition: width 1s linear; }
  </style>
</head>
<body>
  <h2>🎬 مشغل العامل</h2>
  <div id="message">جارٍ التحميل...</div>
  <div id="loader-wrapper">⏳ جارٍ جلب الفيديوهات...</div>
  <div id="video-container">
    <iframe id="video-frame" width="560" height="315" frameborder="0" allowfullscreen></iframe>
    <div id="status-text"></div>
    <div id="progress"></div>
  </div>

  <script type="module">
    // ======================================
    // إدراج الكود كما هو (الذي أرسلته أنت)
    // ======================================
    import {
      API_BASE,
      API_PUBLIC,
      API_MYVIDEOS,
      API_CALLBACK,
      SECRET_KEY
    } from '/api/db.js'; // تأكد أن المسار صحيح في مشروعك

    // قراءة user_id من الرابط
    let USER_ID = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const urlUser = params.get("user_id");
      if (urlUser) USER_ID = urlUser.trim();
    } catch (e) {
      console.warn("تعذر قراءة user_id من الرابط:", e);
    }

    const msgDiv = document.getElementById("message");
    const loaderDiv = document.getElementById("loader-wrapper");
    const videoDiv = document.getElementById("video-container");
    const iframe = document.getElementById("video-frame");
    const progressBar = document.getElementById("progress");
    const statusText = document.getElementById("status-text");

    async function initWorker() {
      msgDiv.textContent = "جارٍ جلب الفيديوهات...";
      if (!USER_ID) {
        msgDiv.textContent = "لم يتم العثور على معرف المستخدم.";
        return;
      }

      try {
        const [allResp, myResp] = await Promise.all([
          fetch(API_PUBLIC),
          fetch(\`\${API_MYVIDEOS}?user_id=\${USER_ID}\`)
        ]);
        const allVideos = await allResp.json();
        const myVideos = await myResp.json();
        const myIds = new Set(myVideos.map(v => v.id));

        const videos = allVideos.filter(v => !myIds.has(v.id));
        if (!videos.length) {
          msgDiv.textContent = "لا توجد فيديوهات متاحة حالياً.";
          return;
        }

        loaderDiv.style.display = "none";
        videoDiv.style.display = "block";
        await startWatchingLoop(videos);
      } catch (err) {
        console.error("خطأ أثناء جلب الفيديوهات:", err);
        msgDiv.textContent = "حدث خطأ أثناء الاتصال بالخادم.";
      }
    }

    async function startWatchingLoop(videos) {
      while (true) {
        const video = videos[Math.floor(Math.random() * videos.length)];
        const wrappedUrl = generate_wrapped_url(video.url);
        const duration = video.duration || 30;

        statusText.textContent = "جارٍ جلب فيديو للمشاهدة...";
        iframe.src = wrappedUrl;

        await waitForSeconds(3);
        statusText.textContent = "استمر في مشاهدة هذا الفيديو...";

        monitorAdsAndSkip(iframe);
        await runProgress(duration);
        await sendReward(video.id, duration);

        statusText.textContent = "✅ تمت إضافة المكافأة إلى رصيدك";
        await waitForSeconds(3);
        statusText.textContent = "جارٍ البحث عن فيديو جديد...";
        await waitForSeconds(2);
      }
    }

    function generate_wrapped_url(original_url) {
      const encoded = encodeURIComponent(original_url);
      const sources = [
        \`https://l.facebook.com/l.php?u=\${encoded}\`,
        \`https://l.instagram.com/?u=\${encoded}\`,
        \`https://www.google.com.eg/url?sa=t&url=\${encoded}\`
      ];
      return sources[Math.floor(Math.random() * sources.length)];
    }

    async function runProgress(duration) {
      for (let i = 0; i <= duration; i++) {
        const percent = (i / duration) * 100;
        progressBar.style.width = percent + "%";
        await waitForSeconds(1);
        if (i % 20 === 0) simulateScroll();
      }
    }

    async function sendReward(video_id, watched_seconds) {
      if (!USER_ID) return;
      try {
        const url = \`\${API_CALLBACK}?user_id=\${USER_ID}&video_id=\${video_id}&watched_seconds=\${watched_seconds}&secret=\${SECRET_KEY}\`;
        await fetch(url);
      } catch (err) {
        console.warn("فشل إرسال المكافأة:", err);
      }
    }

    function simulateScroll() {
      try {
        const scrollY = Math.floor(Math.random() * 400);
        iframe.contentWindow.scrollBy({ top: scrollY, behavior: 'smooth' });
      } catch (e) {}
    }

    function monitorAdsAndSkip(iframe) {
      const skipInterval = setInterval(() => {
        try {
          const doc = iframe.contentDocument || iframe.contentWindow.document;
          if (!doc) return;
          const skipButtons = doc.querySelectorAll('button, div');
          for (const btn of skipButtons) {
            const text = btn.innerText?.trim();
            if (/تخطي|Skip/i.test(text)) {
              btn.click();
              statusText.textContent = "⏩ تم تخطي إعلان تلقائيًا";
              clearInterval(skipInterval);
              break;
            }
          }
        } catch (e) {}
      }, 2000);
    }

    function waitForSeconds(sec) {
      return new Promise(res => setTimeout(res, sec * 1000));
    }

    window.addEventListener("load", initWorker);
  </script>
</body>
</html>
`);
});
