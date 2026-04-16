// ================================================================
//  offline.js  —  PlanTrack System Offline & Background Manager
// ================================================================

'use strict';

let swReg = null;

async function registerSW() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Service Workers not supported.');
    return;
  }
  try {
    swReg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('✅ Service Worker registered');
    setTimeout(askNotificationPermission, 3000);
    setupOfflineBanner();
    setupInstallPrompt();
    setInterval(() => sendToSW('CHECK_NOW', null), 60000);
  } catch (err) {
    console.error('SW registration failed:', err);
  }
}

function askNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  if (!currentUser) { setTimeout(askNotificationPermission, 3000); return; }

  const banner = document.createElement('div');
  banner.id = 'notif-prompt-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px">
      <span style="font-size:2rem;flex-shrink:0">🔔</span>
      <div style="flex:1">
        <div style="font-weight:600;color:var(--text);font-size:.92rem;margin-bottom:3px">Enable Alarm Notifications</div>
        <div style="color:var(--text2);font-size:.78rem;line-height:1.5">
          Get alarm alerts and plan reminders even when the app is closed.
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button id="notif-no-btn" style="background:var(--surface3);border:1px solid var(--border2);border-radius:9px;color:var(--text2);padding:8px 14px;cursor:pointer;font-size:.82rem;font-family:'DM Sans',sans-serif;" type="button">Not now</button>
        <button id="notif-yes-btn" style="background:var(--accent);border:none;border-radius:9px;color:#000;padding:8px 16px;cursor:pointer;font-size:.82rem;font-weight:700;font-family:'DM Sans',sans-serif;" type="button">Allow</button>
      </div>
    </div>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:1px solid var(--accent);
    border-radius:16px;padding:16px 20px;z-index:8500;
    max-width:500px;width:calc(100% - 32px);
    box-shadow:0 8px 40px rgba(0,0,0,0.6);`;

  if (!document.getElementById('notif-anim-style')) {
    const st = document.createElement('style');
    st.id = 'notif-anim-style';
    st.textContent = `
      @keyframes offlineSlide { from{transform:translateY(-100%)} to{transform:translateY(0)} }`;
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
    console.log('Periodic sync not available:', e.message);
  }
}

function sendToSW(type, data) {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type, data });
  }
}

window.pushAlarmsToSW = function(alarms) { sendToSW('SAVE_ALARMS', alarms); };
window.pushPlansToSW  = function(plans)  { sendToSW('SAVE_PLANS',  plans);  };

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

function setupOfflineBanner() {
  const bar = document.createElement('div');
  bar.id = 'offline-bar';
  bar.textContent = '📵  You are offline — the app still works with saved data';
  bar.style.cssText = `
    position:fixed;top:60px;left:0;right:0;
    background:#c0392b;color:#fff;text-align:center;
    padding:9px 16px;font-size:.82rem;font-weight:600;
    z-index:9999;display:none;
    font-family:'DM Sans',sans-serif;`;
  document.body.appendChild(bar);
  function update() {
    const b = document.getElementById('offline-bar');
    if (!b) return;
    if (!navigator.onLine) {
      b.style.display = 'block';
    } else {
      if (b.style.display === 'block') toast('✅ Back online!', 'success');
      b.style.display = 'none';
    }
  }
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

let installPromptEvent = null;

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPromptEvent = e;
    setTimeout(showInstallBanner, 6000);
  });
  window.addEventListener('appinstalled', () => {
    toast('✅ PlanTrack installed! Open it from your home screen.', 'success');
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
      <span style="font-size:1.8rem;flex-shrink:0">📲</span>
      <div style="flex:1">
        <div style="font-weight:600;color:var(--text);font-size:.9rem;margin-bottom:2px">Install PlanTrack App</div>
        <div style="color:var(--text2);font-size:.76rem">Works offline · Alarms in background · No data needed</div>
      </div>
      <div style="display:flex;gap:7px;flex-shrink:0">
        <button onclick="document.getElementById('install-banner').remove()" style="background:var(--surface3);border:1px solid var(--border2);border-radius:9px;color:var(--text2);padding:7px 12px;cursor:pointer;font-size:.8rem;font-family:'DM Sans',sans-serif;" type="button">Later</button>
        <button onclick="doInstall()" style="background:var(--accent);border:none;border-radius:9px;color:#000;padding:7px 16px;cursor:pointer;font-size:.8rem;font-weight:700;font-family:'DM Sans',sans-serif;" type="button">Install</button>
      </div>
    </div>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:1px solid var(--border2);
    border-radius:16px;padding:14px 18px;z-index:8000;
    max-width:460px;width:calc(100% - 32px);
    box-shadow:0 8px 40px rgba(0,0,0,0.55);`;
  document.body.appendChild(banner);
}

window.doInstall = async function() {
  const b = document.getElementById('install-banner');
  if (b) b.remove();
  if (!installPromptEvent) return;
  installPromptEvent.prompt();
  const { outcome } = await installPromptEvent.userChoice;
  if (outcome === 'accepted') toast('Installing PlanTrack app...', 'success');
  installPromptEvent = null;
};

function fmtTime(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}

window.addEventListener('load', registerSW);
