import {
  API_BASE,
  API_PUBLIC,
  API_MYVIDEOS,
  API_CALLBACK,
  SECRET_KEY
} from './db.js';

// ======================================================
//  توليد رابط عرض عشوائي مغلّف
// ======================================================
function generate_wrapped_url(original_url) {
  const encoded = encodeURIComponent(original_url);
  const sources = [
    `https://l.facebook.com/l.php?u=${encoded}`,
    `https://l.instagram.com/?u=${encoded}`,
    `https://www.google.com.eg/url?sa=t&url=${encoded}`
  ];
  return sources[Math.floor(Math.random() * sources.length)];
}

// ======================================================
//  جلب بيانات المستخدم من الإضافة
// ======================================================
let USER_ID = null;
try {
  if (chrome?.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ action: "get_user_id" }, (response) => {
      if (response?.user_id) USER_ID = response.user_id;
    });
  }
} catch (e) {
  console.warn("لم يتم العثور على user_id:", e);
}

// ======================================================
//  عناصر الصفحة
// ======================================================
const msgDiv = document.getElementById("message");
const loaderDiv = document.getElementById("loader-wrapper");
const videoDiv = document.getElementById("video-container");
const iframe = document.getElementById("video-frame");
const progressBar = document.getElementById("progress");
const statusText = document.getElementById("status-text");

// ======================================================
//  تهيئة العامل
// ======================================================
async function initWorker() {
  msgDiv.textContent = "جارٍ جلب الفيديوهات...";
  try {
    const [allResp, myResp] = await Promise.all([
      fetch(API_PUBLIC),
      fetch(`${API_MYVIDEOS}?user_id=${USER_ID}`)
    ]);
    const allVideos = await allResp.json();
    const myVideos = await myResp.json();
    const myIds = new Set(myVideos.map(v => v.id));

    // استبعاد فيديوهات المستخدم نفسه
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

// ======================================================
//  الحلقة الأساسية للمشاهدة
// ======================================================
async function startWatchingLoop(videos) {
  while (true) {
    const video = videos[Math.floor(Math.random() * videos.length)];
    const wrappedUrl = generate_wrapped_url(video.url);
    const duration = video.duration || 30;

    statusText.textContent = "جارٍ جلب فيديو للمشاهدة...";
    iframe.src = wrappedUrl;

    await waitForSeconds(3);
    statusText.textContent = "استمر في مشاهدة هذا الفيديو...";

    // تفعيل مراقبة الإعلانات في كل فيديو جديد
    monitorAdsAndSkip(iframe);

    await runProgress(duration);
    await sendReward(video.id, duration);

    statusText.textContent = "✅ تمت إضافة المكافأة إلى رصيدك";
    await waitForSeconds(3);

    statusText.textContent = "جارٍ البحث عن فيديو جديد للمشاهدة...";
    await waitForSeconds(2);
  }
}

// ======================================================
//  عداد وقت المشاهدة + شريط التقدم
// ======================================================
async function runProgress(duration) {
  for (let i = 0; i <= duration; i++) {
    const percent = (i / duration) * 100;
    progressBar.style.width = percent + "%";
    await waitForSeconds(1);
    if (i % 20 === 0) simulateScroll();
  }
}

// ======================================================
//  إرسال المكافأة إلى السيرفر
// ======================================================
async function sendReward(video_id, watched_seconds) {
  if (!USER_ID) return;
  try {
    const url = `${API_CALLBACK}?user_id=${USER_ID}&video_id=${video_id}&watched_seconds=${watched_seconds}&secret=${SECRET_KEY}`;
    await fetch(url);
  } catch (err) {
    console.warn("فشل إرسال المكافأة:", err);
  }
}

// ======================================================
//  تحريك الصفحة داخل iframe (سلوك طبيعي)
// ======================================================
function simulateScroll() {
  try {
    const scrollY = Math.floor(Math.random() * 400);
    iframe.contentWindow.scrollBy({ top: scrollY, behavior: 'smooth' });
  } catch (e) {}
}

// ======================================================
//  مراقبة الإعلانات وتخطيها تلقائيًا
// ======================================================
function monitorAdsAndSkip(iframe) {
  // نراقب محتوى iframe كل ثانيتين
  const skipInterval = setInterval(() => {
    try {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      if (!doc) return;

      // البحث عن أزرار "تخطي الإعلان"
      const skipButtons = doc.querySelectorAll('button, div');
      for (const btn of skipButtons) {
        const text = btn.innerText?.trim();
        if (/تخطي|Skip/i.test(text)) {
          btn.click();
          console.log("🎯 تم الضغط على زر تخطي الإعلان:", text);
          statusText.textContent = "⏩ تم تخطي إعلان تلقائيًا";
          clearInterval(skipInterval);
          break;
        }
      }
    } catch (e) {
      // لا يمكن الوصول إلى iframe في بعض الحالات
    }
  }, 2000);
}

// ======================================================
function waitForSeconds(sec) {
  return new Promise(res => setTimeout(res, sec * 1000));
}

// ======================================================
window.addEventListener('load', initWorker);
