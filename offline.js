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
    icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
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

// ─── INSTALL PROMPT ────────────────────────────────────────────
let installPromptEvent = null;
const INSTALL_DISMISSED_KEY = 'plantrack-install-dismissed';
const INSTALL_MODAL_KEY     = 'plantrack-install-modal-shown';
const INSTALL_COMPLETED_KEY = 'plantrack-is-installed';

function isRunningStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}

function setupInstallPrompt() {
  // Already installed as standalone OR has the install flag — hide button and exit
  if (isRunningStandalone() || localStorage.getItem(INSTALL_COMPLETED_KEY)) {
    hideInstallBtn();
    return;
  }

  // Android / Chrome — native beforeinstallprompt
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installPromptEvent = e;
    showInstallBtn();
    // If the welcome modal wasn't shown yet, it will handle the install
    // Otherwise fall back to the bottom banner
    if (localStorage.getItem(INSTALL_MODAL_KEY)) {
      showInstallBanner();
    }
  });

  window.addEventListener('appinstalled', () => {
    toast('✅ PlanTrack installed! Open it from your home screen.', 'success');
    localStorage.setItem(INSTALL_COMPLETED_KEY, '1'); // Set permanent flagship
    installPromptEvent = null;
    hideInstallBtn();
    const b = document.getElementById('install-banner');
    if (b) b.remove();
    const m = document.getElementById('install-welcome-modal');
    if (m) m.remove();
  });

  // iOS — no beforeinstallprompt; show our own step-by-step guide
  if (isIOS()) {
    showInstallBtn();
  }
}

function showInstallBtn() {
  const btn = document.getElementById('install-app-btn');
  if (btn) btn.style.display = 'flex';
}
function hideInstallBtn() {
  const btn = document.getElementById('install-app-btn');
  if (btn) btn.style.display = 'none';
}

// Called by the sidebar "Install App" button
window.installPWA = async function() {
  if (installPromptEvent) {
    await doInstall();
  } else if (isIOS()) {
    showIosInstallBanner();
  } else {
    showInstallBanner();
  }
};

// ═══════════════════════════════════════════════════════════════
//  FIRST-VISIT WELCOME INSTALL MODAL (shown on page load)
// ═══════════════════════════════════════════════════════════════
function showInstallWelcomeModal() {
  if (isRunningStandalone() || localStorage.getItem(INSTALL_COMPLETED_KEY)) return;
  if (localStorage.getItem(INSTALL_DISMISSED_KEY)) return;
  if (localStorage.getItem(INSTALL_MODAL_KEY)) return; // Don't show twice
  if (document.getElementById('install-welcome-modal')) return;

  injectInstallStyles();
  localStorage.setItem(INSTALL_MODAL_KEY, '1'); // Record that we shown it once

  const ios = isIOS();

  const modal = document.createElement('div');
  modal.id = 'install-welcome-modal';
  modal.className = 'iwm-overlay';

  modal.innerHTML = `
    <div class="iwm-box">

      <!-- Glow blobs -->
      <div class="iwm-blob iwm-blob1"></div>
      <div class="iwm-blob iwm-blob2"></div>

      <!-- Logo / Hero -->
      <div class="iwm-hero">
        <div class="iwm-icon-ring">
          <img src="WhatsApp Image 2026-04-07 at 20.53.13.jpeg" style="width:100%; height:100%; border-radius:50%; object-fit:cover;" alt="Logo"/>
        </div>
        <div class="iwm-brand">PlanTrack</div>
        <div class="iwm-tagline">CONCENTRATION TOOL</div>
      </div>

      <!-- Benefits -->
      <div class="iwm-benefits">
        <div class="iwm-benefit"><span class="iwm-b-icon">⏰</span><span>Alarms that ring even when closed</span></div>
        <div class="iwm-benefit"><span class="iwm-b-icon">📵</span><span>Works offline — no internet needed</span></div>
        <div class="iwm-benefit"><span class="iwm-b-icon">🏠</span><span>One tap from your home screen</span></div>
        <div class="iwm-benefit"><span class="iwm-b-icon">🚀</span><span>Instant — no app store needed</span></div>
      </div>

      ${ios ? `
      <!-- iOS instructions -->
      <div class="iwm-ios-steps">
        <div class="iwm-steps-title">How to install on iPhone / iPad:</div>
        <div class="iwm-step">
          <div class="iwm-step-num">1</div>
          <div class="iwm-step-text">Tap the <strong>Share</strong> button <span class="iwm-share-icon">⎙</span> at the bottom of Safari</div>
        </div>
        <div class="iwm-step">
          <div class="iwm-step-num">2</div>
          <div class="iwm-step-text">Scroll and tap <strong>"Add to Home Screen"</strong></div>
        </div>
        <div class="iwm-step">
          <div class="iwm-step-num">3</div>
          <div class="iwm-step-text">Tap <strong style="color:var(--accent)">Add</strong> — done! 🎉</div>
        </div>
      </div>
      <div class="iwm-actions">
        <button class="iwm-btn-primary" onclick="closeInstallModal()">Got it!</button>
        <button class="iwm-btn-ghost" onclick="closeInstallModal()">Maybe later</button>
      </div>
      ` : `
      <!-- Android / Chrome install button -->
      <div class="iwm-actions">
        <button class="iwm-btn-primary" id="iwm-install-btn" onclick="iwmInstall()">
          <span>⬇</span> Install App — It's Free!
        </button>
        <button class="iwm-btn-ghost" onclick="closeInstallModal()">Maybe later</button>
      </div>
      <div class="iwm-footnote">No app store • No download • Instant access</div>
      `}

    </div>`;

  document.body.appendChild(modal);

  // Close on backdrop click
  modal.addEventListener('click', e => {
    if (e.target === modal) closeInstallModal();
  });
}

window.iwmInstall = async function() {
  if (installPromptEvent) {
    closeInstallModal();
    installPromptEvent.prompt();
    const { outcome } = await installPromptEvent.userChoice;
    if (outcome === 'accepted') {
      toast('Installing PlanTrack...', 'success');
    } else {
      // They cancelled the native prompt — show the banner as fallback
      setTimeout(showInstallBanner, 800);
    }
    installPromptEvent = null;
  } else {
    // beforeinstallprompt hasn't fired yet
    // Show a waiting state and retry once it does
    const btn = document.getElementById('iwm-install-btn');
    if (btn) { btn.textContent = 'Preparing install...'; btn.disabled = true; }
    let waited = 0;
    const wait = setInterval(() => {
      waited++;
      if (installPromptEvent) {
        clearInterval(wait);
        window.iwmInstall();
      } else if (waited > 10) {
        clearInterval(wait);
        closeInstallModal();
        showInstallBanner();
      }
    }, 500);
  }
};

window.closeInstallModal = function() {
  const modal = document.getElementById('install-welcome-modal');
  if (modal) {
    modal.style.animation = 'iwmFadeOut .25s ease forwards';
    setTimeout(() => modal.remove(), 250);
  }
  localStorage.setItem(INSTALL_MODAL_KEY, '1');
};

// ── Android / Chrome small bottom banner (fallback) ──
function showInstallBanner() {
  if (document.getElementById('install-banner')) return;
  if (isRunningStandalone()) return;

  const banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px">
      <span style="font-size:2.2rem;flex-shrink:0">📲</span>
      <div style="flex:1">
        <div style="font-weight:700;color:var(--text);font-size:.97rem;margin-bottom:3px">Install PlanTrack App</div>
        <div style="color:var(--text2);font-size:.78rem;line-height:1.5">Works offline · Alarms in background · Instant access from your home screen</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0">
        <button onclick="doInstall()" style="background:var(--accent);border:none;border-radius:10px;color:#000;padding:9px 18px;cursor:pointer;font-size:.85rem;font-weight:700;font-family:'DM Sans',sans-serif;white-space:nowrap;" type="button">⬇ Install</button>
        <button onclick="dismissInstallBanner()" style="background:transparent;border:1px solid var(--border2);border-radius:10px;color:var(--text2);padding:6px 10px;cursor:pointer;font-size:.75rem;font-family:'DM Sans',sans-serif;text-align:center;" type="button">Not now</button>
      </div>
    </div>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:2px solid var(--accent);
    border-radius:18px;padding:16px 18px;z-index:8000;
    max-width:480px;width:calc(100% - 32px);
    box-shadow:0 12px 48px rgba(0,0,0,0.65);
    animation:installSlideUp .4s cubic-bezier(.22,1,.36,1);`;

  injectInstallAnim();
  document.body.appendChild(banner);
}

// ── iOS Safari guide banner ──
function showIosInstallBanner() {
  if (document.getElementById('ios-install-banner')) return;
  if (isRunningStandalone()) return;

  const banner = document.createElement('div');
  banner.id = 'ios-install-banner';
  banner.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <div style="font-weight:700;color:var(--text);font-size:1rem;">📲 Install PlanTrack</div>
      <button onclick="dismissIosBanner()" style="background:none;border:none;color:var(--text2);cursor:pointer;font-size:1.1rem;padding:0 4px;" type="button">✕</button>
    </div>
    <div style="color:var(--text2);font-size:.82rem;line-height:1.7">
      <div style="margin-bottom:10px;color:var(--text);">Add to your iPhone / iPad home screen:</div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface3);border-radius:10px;margin-bottom:7px;">
        <span style="font-size:1.3rem;flex-shrink:0">1️⃣</span>
        <span>Tap <strong style="color:var(--text)">Share</strong> <span style="font-size:1.1rem">⎙</span> at the bottom of Safari</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface3);border-radius:10px;margin-bottom:7px;">
        <span style="font-size:1.3rem;flex-shrink:0">2️⃣</span>
        <span>Tap <strong style="color:var(--text)">"Add to Home Screen"</strong></span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:var(--surface3);border-radius:10px;margin-bottom:14px;">
        <span style="font-size:1.3rem;flex-shrink:0">3️⃣</span>
        <span>Tap <strong style="color:var(--accent)">Add</strong> — done! 🎉</span>
      </div>
    </div>
    <button onclick="dismissIosBanner()" style="width:100%;background:var(--accent);border:none;border-radius:10px;color:#000;padding:10px;cursor:pointer;font-size:.9rem;font-weight:700;font-family:'DM Sans',sans-serif;" type="button">Got it!</button>`;
  banner.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:var(--surface2);border:2px solid var(--accent);
    border-radius:18px;padding:18px 20px;z-index:8000;
    max-width:400px;width:calc(100% - 32px);
    box-shadow:0 12px 48px rgba(0,0,0,0.65);
    animation:installSlideUp .4s cubic-bezier(.22,1,.36,1);`;

  injectInstallAnim();
  document.body.appendChild(banner);
}

window.dismissInstallBanner = function() {
  const b = document.getElementById('install-banner');
  if (b) b.remove();
  localStorage.setItem(INSTALL_DISMISSED_KEY, '1');
};

window.dismissIosBanner = function() {
  const b = document.getElementById('ios-install-banner');
  if (b) b.remove();
  localStorage.setItem(INSTALL_COMPLETED_KEY, '1'); // Treat dismissing guide as "Installed"
};

window.doInstall = async function() {
  const b = document.getElementById('install-banner');
  if (b) b.remove();
  if (!installPromptEvent) return;
  installPromptEvent.prompt();
  const { outcome } = await installPromptEvent.userChoice;
  if (outcome === 'accepted') toast('Installing PlanTrack app...', 'success');
  installPromptEvent = null;
};

function injectInstallAnim() {
  if (document.getElementById('install-anim-style')) return;
  const st = document.createElement('style');
  st.id = 'install-anim-style';
  st.textContent = `
    @keyframes installSlideUp {
      from { opacity:0; transform:translateX(-50%) translateY(40px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }`;
  document.head.appendChild(st);
}

// ─── Inject styles for the welcome modal ───────────────────────
function injectInstallStyles() {
  if (document.getElementById('iwm-styles')) return;
  const st = document.createElement('style');
  st.id = 'iwm-styles';
  st.textContent = `
    /* ── Install Welcome Modal ── */
    .iwm-overlay {
      position:fixed; inset:0; z-index:99999;
      background:rgba(0,0,0,0.85);
      display:flex; align-items:center; justify-content:center;
      padding:20px; backdrop-filter:blur(8px);
      animation:iwmFadeIn .35s ease;
    }
    @keyframes iwmFadeIn {
      from { opacity:0; }
      to   { opacity:1; }
    }
    @keyframes iwmFadeOut {
      from { opacity:1; }
      to   { opacity:0; }
    }
    .iwm-box {
      position:relative; overflow:hidden;
      background:var(--surface);
      border:1.5px solid var(--border2);
      border-radius:24px;
      padding:36px 28px 28px;
      width:100%; max-width:400px;
      box-shadow:0 24px 80px rgba(0,0,0,0.7);
      animation:iwmSlideUp .4s cubic-bezier(.22,1,.36,1);
      text-align:center;
    }
    @keyframes iwmSlideUp {
      from { opacity:0; transform:translateY(60px) scale(.95); }
      to   { opacity:1; transform:translateY(0)    scale(1); }
    }
    /* blobs */
    .iwm-blob {
      position:absolute; border-radius:50%;
      filter:blur(70px); pointer-events:none;
    }
    .iwm-blob1 {
      width:250px; height:250px;
      background:var(--accent); opacity:.08;
      top:-80px; right:-60px;
    }
    .iwm-blob2 {
      width:200px; height:200px;
      background:var(--accent2); opacity:.07;
      bottom:-60px; left:-50px;
    }
    /* hero */
    .iwm-hero { margin-bottom:22px; }
    .iwm-icon-ring {
      width:72px; height:72px; border-radius:50%;
      background:linear-gradient(135deg,var(--accent),var(--accent2));
      display:flex; align-items:center; justify-content:center;
      margin:0 auto 12px; font-size:2rem;
      box-shadow:0 0 32px rgba(240,192,64,.35);
      animation:iwmGlow 3s ease-in-out infinite alternate;
    }
    @keyframes iwmGlow {
      from { box-shadow:0 0 24px rgba(240,192,64,.3); }
      to   { box-shadow:0 0 48px rgba(240,192,64,.6); }
    }
    .iwm-brand {
      font-family:'Playfair Display',serif;
      font-size:1.8rem; font-weight:900;
      color:var(--accent); letter-spacing:2px;
    }
    .iwm-tagline {
      font-size:.65rem; font-weight:700;
      letter-spacing:4px; color:var(--text3);
      margin-top:2px;
    }
    /* benefits */
    .iwm-benefits {
      background:var(--surface2); border:1px solid var(--border);
      border-radius:16px; padding:14px 16px;
      margin-bottom:20px; text-align:left;
      display:flex; flex-direction:column; gap:10px;
    }
    .iwm-benefit {
      display:flex; align-items:center; gap:10px;
      font-size:.86rem; color:var(--text2);
    }
    .iwm-b-icon { font-size:1rem; flex-shrink:0; }
    /* iOS steps */
    .iwm-ios-steps {
      background:var(--surface2); border:1px solid var(--border);
      border-radius:16px; padding:14px 16px;
      margin-bottom:20px; text-align:left;
    }
    .iwm-steps-title {
      font-size:.8rem; font-weight:700; color:var(--text2);
      text-transform:uppercase; letter-spacing:.8px;
      margin-bottom:12px;
    }
    .iwm-step {
      display:flex; align-items:flex-start; gap:10px;
      margin-bottom:10px; font-size:.85rem; color:var(--text2);
    }
    .iwm-step:last-child { margin-bottom:0; }
    .iwm-step-num {
      width:24px; height:24px; border-radius:50%;
      background:var(--accent); color:#000;
      font-weight:900; font-size:.75rem;
      display:flex; align-items:center; justify-content:center;
      flex-shrink:0;
    }
    .iwm-step-text { flex:1; line-height:1.5; padding-top:2px; }
    .iwm-share-icon { font-size:1rem; }
    /* actions */
    .iwm-actions {
      display:flex; flex-direction:column; gap:10px;
    }
    .iwm-btn-primary {
      width:100%; padding:14px;
      background:var(--accent); border:none;
      border-radius:14px; color:#000;
      font-family:'DM Sans',sans-serif;
      font-size:1rem; font-weight:800;
      cursor:pointer; transition:all .2s;
      display:flex; align-items:center; justify-content:center; gap:8px;
      letter-spacing:.3px;
    }
    .iwm-btn-primary:hover { background:var(--accent-dark); transform:translateY(-2px); box-shadow:0 8px 24px rgba(240,192,64,.4); }
    .iwm-btn-primary:disabled { opacity:.6; cursor:not-allowed; transform:none; }
    .iwm-btn-ghost {
      width:100%; padding:10px;
      background:transparent; border:1px solid var(--border2);
      border-radius:12px; color:var(--text3);
      font-family:'DM Sans',sans-serif;
      font-size:.85rem; font-weight:500;
      cursor:pointer; transition:all .2s;
    }
    .iwm-btn-ghost:hover { border-color:var(--text3); color:var(--text2); }
    .iwm-footnote {
      margin-top:12px; font-size:.72rem;
      color:var(--text3); letter-spacing:.3px;
    }
  `;
  document.head.appendChild(st);
}

function fmtTime(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}

// Show the welcome install modal after a short delay on every fresh visit
window.addEventListener('load', async () => {
  registerSW();
  
  // Bug Fix: Enhanced detection for already-installed apps on Chrome/Android
  if ('getInstalledRelatedApps' in navigator) {
    const apps = await navigator.getInstalledRelatedApps();
    if (apps && apps.length > 0) {
      localStorage.setItem(INSTALL_COMPLETED_KEY, '1');
      hideInstallBtn();
      return;
    }
  }

  // Show install modal 1.5s after load if not dismissed, completed, or already shown
  const isInstalled = localStorage.getItem(INSTALL_COMPLETED_KEY);
  const isDismissed = localStorage.getItem(INSTALL_DISMISSED_KEY);
  const hasSeen     = localStorage.getItem(INSTALL_MODAL_KEY);

  if (!isRunningStandalone() && !isInstalled && !isDismissed && !hasSeen) {
    // Record that we are GOING to show the modal immediately
    // so a fast refresh won't trigger another one
    localStorage.setItem(INSTALL_MODAL_KEY, '1');
    setTimeout(showInstallWelcomeModal, 1500);
  }
});

// Auto-refresh when the new Service Worker (v4) takes over
navigator.serviceWorker.addEventListener('controllerchange', () => {
  window.location.reload();
});
