// ================================================================
//  offline.js  —  PlanTrack System Offline & Background Manager
//  PLACE THIS FILE in your PlanTrack System folder (same folder as index.html)
// ================================================================

'use strict';

let swReg = null;

// ================================================================
//  STEP 1: Register the Service Worker
// ================================================================
async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Workers not supported on this browser.');
    return;
  }
  try {
    swReg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('✅ Service Worker registered');

    // Ask for notification permission after a short delay
    setTimeout(askNotificationPermission, 3000);

    // Setup online/offline banner
    setupOfflineBanner();

    // Setup install-to-home-screen prompt
    setupInstallPrompt();

    // Run alarm check every 60 seconds via the SW
    setInterval(() => sendToSW('CHECK_NOW', null), 60000);

    // Also check plans every hour (SW handles once-per-day logic)
    setInterval(() => sendToSW('CHECK_NOW', null), 3600000);

  } catch (err) {
    console.error('SW registration failed:', err);
  }
}

// ================================================================
//  STEP 2: Ask permission for notifications
// ================================================================
function askNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (!currentUser) { setTimeout(askNotificationPermission, 3000); return; }

  // Show a friendly in-app banner instead of the browser prompt directly
  const banner = document.createElement('div');
  banner.id = 'notif-prompt-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px">
      <span style="font-size:2rem">🔔</span>
      <div style="flex:1">
        <div style="font-weight:600;color:var(--text);font-size:.92rem;margin-bottom:3px">Enable Alarm Notifications</div>
        <div style="color:var(--text2);font-size:.78rem;line-height:1.5">
          Get alarm alerts and daily plan reminders even when the app is closed or your screen is off.
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button id="notif-no-btn" style="
          background:var(--surface3);border:1px solid var(--border2);border-radius:9px;
          color:var(--text2);padding:8px 14px;cursor:pointer;font-size:.82rem;
          font-family:'DM Sans',sans-serif;white-space:nowrap">Not now</button>
        <button id="notif-yes-btn" style="
          background:var(--accent);border:none;border-radius:9px;color:#000;
          padding:8px 16px;cursor:pointer;font-size:.82rem;font-weight:700;
          font-family:'DM Sans',sans-serif;white-space:nowrap">Allow</button>
      </div>
    </div>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:1px solid var(--accent);
    border-radius:16px;padding:16px 20px;z-index:8500;
    max-width:500px;width:calc(100% - 40px);
    box-shadow:0 8px 40px rgba(0,0,0,0.6);
    animation:notifSlideUp .35s ease;`;

  // Add animation keyframe
  if (!document.getElementById('notif-anim-style')) {
    const st = document.createElement('style');
    st.id = 'notif-anim-style';
    st.textContent = `
      @keyframes notifSlideUp {
        from { opacity:0; transform:translateX(-50%) translateY(30px); }
        to   { opacity:1; transform:translateX(-50%) translateY(0); }
      }
      @keyframes offlineSlide {
        from { transform:translateY(-100%); }
        to   { transform:translateY(0); }
      }`;
    document.head.appendChild(st);
  }

  document.body.appendChild(banner);

  document.getElementById('notif-yes-btn').onclick = async () => {
    banner.remove();
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      toast('🔔 Notifications enabled! Alarms will ring even when app is closed.', 'success');
      tryRegisterPeriodicSync();
    } else {
      toast('Notifications blocked. Alarms will only ring while the app is open.', 'info');
    }
  };
  document.getElementById('notif-no-btn').onclick = () => banner.remove();
}

// ================================================================
//  STEP 3: Periodic Background Sync (Android Chrome)
//  This lets the SW check alarms even when browser is fully closed
// ================================================================
async function tryRegisterPeriodicSync() {
  if (!swReg || !('periodicSync' in swReg)) return;
  try {
    const perm = await navigator.permissions.query({ name: 'periodic-background-sync' });
    if (perm.state === 'granted') {
      await swReg.periodicSync.register('alarm-check', { minInterval: 60 * 1000 });
      await swReg.periodicSync.register('plan-check',  { minInterval: 60 * 60 * 1000 });
      console.log('✅ Periodic background sync registered');
    }
  } catch(e) {
    console.log('Periodic sync not available on this browser/OS:', e.message);
  }
}

// ================================================================
//  STEP 4: Send alarms/plans to Service Worker for background use
//  Call these from app.js after loading data from Supabase
// ================================================================
function sendToSW(type, data) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type, data });
  }
}

// Called from app.js every time alarms are loaded
window.pushAlarmsToSW = function(alarms) {
  sendToSW('SAVE_ALARMS', alarms);
};

// Called from app.js every time plans are loaded
window.pushPlansToSW = function(plans) {
  sendToSW('SAVE_PLANS', plans);
};

// ================================================================
//  STEP 5: Foreground notification (when app IS open)
//  Shows a browser notification AND rings the in-app alarm
// ================================================================
window.fireAlarmNotification = function(alarm) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const notif = new Notification(`⏰ ${alarm.label}`, {
    body: `Your alarm is ringing! Time: ${fmtTime(alarm.time)}`,
    icon: './WhatsApp Image 2026-04-07 at 21.19.20.jpeg',
    tag:  `alarm-${alarm.id}`,
    requireInteraction: true,
  });
  notif.onclick = () => { window.focus(); notif.close(); };
};

// ================================================================
//  STEP 6: Online / Offline banner
// ================================================================
function setupOfflineBanner() {
  const bar = document.createElement('div');
  bar.id = 'offline-bar';
  bar.textContent = '📵  You are offline — the app still works with saved data';
  bar.style.cssText = `
    position:fixed;top:60px;left:0;right:0;
    background:#c0392b;color:#fff;text-align:center;
    padding:9px 16px;font-size:.82rem;font-weight:600;
    z-index:9999;display:none;
    font-family:'DM Sans',sans-serif;
    animation:offlineSlide .3s ease;`;
  document.body.appendChild(bar);

  function update() {
    const bar = document.getElementById('offline-bar');
    if (!bar) return;
    if (!navigator.onLine) {
      bar.style.display = 'block';
    } else {
      if (bar.style.display === 'block') {
        toast('✅ Back online!', 'success');
      }
      bar.style.display = 'none';
    }
  }
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ================================================================
//  STEP 7: "Add to Home Screen" install prompt
//  Lets users install the app on their phone/desktop like a real app
// ================================================================
let installPromptEvent = null;

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPromptEvent = e;
    // Show install banner 6 seconds after login
    setTimeout(showInstallBanner, 6000);
  });
  window.addEventListener('appinstalled', () => {
    toast('✅ PlanTrack System installed! You can now open it from your home screen.', 'success');
    installPromptEvent = null;
    const b = document.getElementById('install-banner');
    if (b) b.remove();
  });
}

function showInstallBanner() {
  if (!installPromptEvent || !currentUser) return;
  if (document.getElementById('install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px">
      <span style="font-size:1.8rem">📲</span>
      <div style="flex:1">
        <div style="font-weight:600;color:var(--text);font-size:.9rem;margin-bottom:2px">Install PlanTrack System App</div>
        <div style="color:var(--text2);font-size:.76rem">Works offline · Alarms in background · No data needed</div>
      </div>
      <div style="display:flex;gap:7px;flex-shrink:0">
        <button onclick="document.getElementById('install-banner').remove()" style="
          background:var(--surface3);border:1px solid var(--border2);border-radius:9px;
          color:var(--text2);padding:7px 12px;cursor:pointer;font-size:.8rem;
          font-family:'DM Sans',sans-serif;">Later</button>
        <button onclick="doInstall()" style="
          background:var(--accent);border:none;border-radius:9px;color:#000;
          padding:7px 16px;cursor:pointer;font-size:.8rem;font-weight:700;
          font-family:'DM Sans',sans-serif;">Install</button>
      </div>
    </div>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:1px solid var(--border2);
    border-radius:16px;padding:14px 18px;z-index:8000;
    max-width:460px;width:calc(100% - 40px);
    box-shadow:0 8px 40px rgba(0,0,0,0.55);
    animation:notifSlideUp .35s ease;`;
  document.body.appendChild(banner);
}

window.doInstall = async function() {
  const b = document.getElementById('install-banner');
  if (b) b.remove();
  if (!installPromptEvent) return;
  installPromptEvent.prompt();
  const { outcome } = await installPromptEvent.userChoice;
  if (outcome === 'accepted') {
    toast('Installing PlanTrack System app...', 'success');
  }
  installPromptEvent = null;
};

// ── Helper ───────────────────────────────────────────────────────
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── Auto-start when page loads ───────────────────────────────────
window.addEventListener('load', registerSW);
