'use strict';

/* ============================================
   Start.js — Worker Entry Point (Manifest v3)
   ============================================ */

// إعداد السيرفر الرئيسي
const MainUrl = 'https://perceptive-victory-production.up.railway.app';

/**
 * ✅ نقطة البداية
 * يتم استدعاؤها عندما يرسل background.js رسالة StartWorker
 */
function StartWorker() {
  console.log('🚀 StartWorker() initialized');

  try {
    // تأكيد وجود chrome.runtime
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.warn('⚠️ chrome.runtime غير موجود — استخدام بديل وهمي');
      window.chrome = {
        runtime: {
          sendMessage: (msg) => console.log('📩 mock sendMessage:', msg),
          onMessage: { addListener: () => {} }
        }
      };
    }

    // عرض رسالة بدء العامل
    showStatus('🔧 بدء العامل...');

    // تشغيل التحقق ثم جلب الفيديو
    setTimeout(() => {
      if (typeof onTimesUp === 'function') {
        onTimesUp();
      } else if (typeof getVideo === 'function') {
        getVideo();
      } else {
        showStatus('⚠️ لم يتم العثور على دوال التشغيل!');
      }
    }, 1500);
  } catch (e) {
    console.error('❌ خطأ أثناء تشغيل StartWorker:', e);
  }
}

/**
 * 💬 عرض رسالة حالة داخل الصفحة
 */
function showStatus(text) {
  let el = document.getElementById('worker-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'worker-status';
    el.style.cssText = `
      position: fixed;
      bottom: 15px;
      left: 50%;
      transform: translateX(-50%);
      background: #111;
      color: #00ff9d;
      font-family: monospace;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 13px;
      z-index: 999999;
      box-shadow: 0 0 10px rgba(0,0,0,.4);
    `;
    document.body.appendChild(el);
  }
  el.textContent = text;
}

/**
 * ⏳ عندما يرسل الخلفية أمر البدء
 */
if (chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.msg) return;

    switch (message.msg) {
      case 'StartWorker':
        console.log('📩 استقبلنا أمر: StartWorker');
        StartWorker();
        break;

      case 'StartGetData':
        console.log('📩 استقبلنا أمر: StartGetData');
        if (typeof getVideo === 'function') {
          getVideo();
        }
        break;
    }
  });
}

/**
 * 🚀 تشغيل تلقائي عند تحميل الصفحة (احتياطي)
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ DOM Loaded: auto StartWorker');
  StartWorker();
});
