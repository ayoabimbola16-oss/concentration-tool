// ═══════════════════════════════════════════════════════════════
//  app.js  —  PlanTrack Concentration Tool
//  Fixed: login bug, profile page, alarm off indicator, mobile
// ═══════════════════════════════════════════════════════════════

'use strict';

/**
 * ═══════════════════════════════════════════════════════════════
 *  LAUNCH REFRESH + AUTO-UPDATE
 *
 *  1. Fresh open (app was closed): sessionStorage is empty →
 *     mark it, then reload once so latest files are loaded.
 *     sessionStorage clears automatically when the tab/app closes,
 *     so every new launch triggers this exactly once.
 *
 *  2. Service worker update detected: if a new SW is waiting,
 *     tell it to activate immediately → SW sends SW_UPDATED →
 *     app reloads automatically with the newest code.
 * ═══════════════════════════════════════════════════════════════
 */
(function() {
  // ── Step 0: NEVER reload if the URL contains OAuth tokens ─────
  //    After Google sign-in, Supabase redirects back with
  //    #access_token=...&refresh_token=... in the hash.
  //    We MUST let Supabase parse those tokens before any reload.
  const hash = window.location.hash || '';
  const hasOAuthTokens = hash.includes('access_token') || hash.includes('refresh_token');

  // ── Step 1: Fresh-open reload ──────────────────────────────
  const LAUNCH_KEY = 'pt_session_started';
  if (!sessionStorage.getItem(LAUNCH_KEY)) {
    sessionStorage.setItem(LAUNCH_KEY, '1');

    // Skip reload entirely when returning from OAuth redirect
    if (hasOAuthTokens) {
      // Let the rest of the script continue so Supabase can
      // detect and save the session from the URL hash.
    } else {
      // Check for a waiting SW first — if found, activate it and
      // let the SW_UPDATED message handle the reload instead.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(reg => {
          if (reg && reg.waiting) {
            // New SW waiting → activate it; it will trigger reload via SW_UPDATED
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } else {
            // No new SW — just do a plain reload to get fresh files
            setTimeout(() => window.location.reload(), 100);
          }
        }).catch(() => {
          setTimeout(() => window.location.reload(), 100);
        });
      } else {
        setTimeout(() => window.location.reload(), 100);
      }
      return; // stop rest of script until reload fires
    }
  }

  // ── Step 2: Check for SW updates on every page load ────────
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return;
      // If a new SW is already waiting (user had app open during push)
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
      // Ask the current SW to check for updates from server
      reg.update().catch(() => {});
    });
  }
})();

// ── Wait for Supabase to load ────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,         // store session in localStorage (default, explicit)
    autoRefreshToken: true,       // auto-refresh expired tokens
    detectSessionInUrl: true,     // parse OAuth tokens from URL hash
    storageKey: 'plantrack-auth', // custom key to avoid collisions
  }
});

// ── Global State ─────────────────────────────────────────────────
let currentUser             = null;
let currentUserId           = null;
let currentUserProfile      = null;
let alarmInterval           = null;
let editingAlarmId          = null;
let editingFolderId         = null;
let editingPlanId           = null;
let currentFolderId         = null;
let currentFolderName       = '';
let currentParentFolderId   = null;
let currentParentFolderName = '';
let selectedSound           = null;
let planFilter              = 'all';
let ringAudio               = null;
let userSounds              = [];
let ttEditId                = null;
let activityCounter         = 0;
let planReminderInterval    = null;
let ringActive              = false;
let ringAlarmId             = null;
let ringAlarmRepeat         = 'none';
let countdownInterval       = null;

// ── Chat State ───────────────────────────────────────────────────
let activeChatFriendId      = null;
let activeChatFriendProfile = null;
let chatRealtimeChannel     = null;
let chatFriendsCache        = [];
let chatMessagesCache       = {};
let activeSharePickerType   = null;
let messageStatusInterval   = null;


// ── Built-in Sounds ──────────────────────────────────────────────
const SOUNDS = [
  { id:'beep',    name:'Classic Beep', emoji:'📢', type:'beep'    },
  { id:'chime',   name:'Chime',        emoji:'🔔', type:'chime'   },
  { id:'alert',   name:'Alert',        emoji:'🚨', type:'alert'   },
  { id:'soft',    name:'Soft Bell',    emoji:'🎵', type:'soft'    },
  { id:'digital', name:'Digital',      emoji:'🤖', type:'digital' },
  { id:'rooster', name:'Morning Bird', emoji:'🐓', type:'rooster' },
  { id:'zen',     name:'Zen Bowl',     emoji:'🧘', type:'zen'     },
  { id:'pulse',   name:'Pulse',        emoji:'💓', type:'pulse'   },
  { id:'fanfare', name:'Fanfare',      emoji:'🎺', type:'fanfare' },
  { id:'rain',    name:'Rain Drop',    emoji:'🌧️', type:'rain'    },
  { id:'laser',   name:'Laser',        emoji:'⚡', type:'laser'   },
  { id:'piano',   name:'Piano Note',   emoji:'🎹', type:'piano'   },
];

// ═══════════════════════════════════════════════════════════════
//  AUDIO ENGINE
// ═══════════════════════════════════════════════════════════════
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Global resume on interaction to satisfy browser policies
['mousedown', 'touchstart', 'keydown'].forEach(evt => {
  window.addEventListener(evt, () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: false, passive: true });
});

function playSound(soundId, loop = false) {
  stopSound();
  if (soundId && soundId.startsWith('user-')) {
    const us = userSounds.find(s => s.id === soundId);
    if (us && us.url) {
      const audio = new Audio(us.url);
      audio.loop = loop;
      audio.volume = 1.0;
      audio.play().catch(() => {});
      ringAudio = { stop: () => { audio.pause(); audio.currentTime = 0; } };
      return;
    }
  }
  const s = SOUNDS.find(x => x.id === soundId) || SOUNDS[0];
  const ctx = getAudioCtx();
  let stopped = false;
  let nodes = [];

  function makeBeep(freq, st, dur, g = 0.3) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(g, st);
    gain.gain.exponentialRampToValueAtTime(0.001, st + dur);
    osc.start(st); osc.stop(st + dur + 0.05);
    nodes.push(osc);
  }

  let audioLoopTimeout = null;
  function pattern(fn) {
    fn();
    if (loop && !stopped) {
      audioLoopTimeout = setTimeout(() => { 
        if (!stopped) pattern(fn); 
      }, 3000);
    }
  }

  function playPattern() {
    const t = ctx.currentTime;
    switch (s.type) {
      case 'beep':    makeBeep(880,t,0.15); makeBeep(880,t+0.2,0.15); makeBeep(880,t+0.4,0.3); break;
      case 'chime':   [528,659,784,1047].forEach((f,i)=>makeBeep(f,t+i*0.18,0.5,0.25)); break;
      case 'alert':   for(let i=0;i<6;i++) makeBeep(i%2===0?1200:900,t+i*0.15,0.12,0.4); break;
      case 'soft':    makeBeep(440,t,1.5,0.15); makeBeep(550,t+0.5,1,0.1); break;
      case 'digital': for(let i=0;i<8;i++) makeBeep(660+(i*50),t+i*0.1,0.08,0.3); break;
      case 'rooster': [300,400,350,500,400].forEach((f,i)=>makeBeep(f,t+i*0.2,0.22,0.25)); break;
      case 'zen':     makeBeep(432,t,2,0.2); makeBeep(648,t+0.3,1.5,0.1); break;
      case 'pulse':   for(let i=0;i<4;i++) makeBeep(750,t+i*0.25,0.15,0.35); break;
      case 'fanfare': [523,659,784,1047,784,1047].forEach((f,i)=>makeBeep(f,t+i*0.15,0.18,0.3)); break;
      case 'rain':    for(let i=0;i<10;i++) makeBeep(150+Math.random()*100,t+Math.random()*1.5,0.1,0.1); break;
      case 'laser':   [1000,1200,900,1400,800].forEach((f,i)=>makeBeep(f,t+i*0.1,0.1,0.35)); break;
      case 'piano':   [262,330,392,523].forEach((f,i)=>makeBeep(f,t+i*0.25,0.8,0.25)); break;
      default:        makeBeep(880,t,0.4); break;
    }
  }

  pattern(playPattern);
  ringAudio = { 
    stop: () => { 
      stopped = true; 
      if (audioLoopTimeout) clearTimeout(audioLoopTimeout);
      nodes.forEach(n => { try { n.stop(); } catch(e){} }); 
    } 
  };
}

function stopSound() {
  if (ringAudio) { ringAudio.stop(); ringAudio = null; }
}

function previewSound(soundId) {
  playSound(soundId, false);
  setTimeout(() => stopSound(), 4000);
}

// ═══════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show toast-${type}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3200);
}

function showAuthMsg(msg, type = 'error') {
  const el = document.getElementById('auth-msg');
  el.textContent = msg;
  el.className = `auth-msg ${type}`;
  el.style.display = 'block';
}

function closeAuthMsg() {
  const el = document.getElementById('auth-msg');
  if (el) el.style.display = 'none';
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'flex';
}

function toggleEye(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.innerHTML = show ? '<i class="fa fa-eye-slash"></i>' : '<i class="fa fa-eye"></i>';
}

function fmt12(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}

function today() { return new Date().toISOString().split('T')[0]; }

function fmtDate(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'});
}

function getDurationLabel(d) {
  return {daily:'Daily',weekly:'Weekly',monthly:'Monthly',yearly:'Yearly'}[d]||d;
}

function fileSize(bytes) {
  if (bytes<1024) return bytes+' B';
  if (bytes<1024*1024) return (bytes/1024).toFixed(1)+' KB';
  return (bytes/(1024*1024)).toFixed(1)+' MB';
}

function fileIcon(name) {
  const ext = (name.split('.').pop()||'').toLowerCase();
  const types = {
    pdf:'fa-file-pdf doc',doc:'fa-file-word doc',docx:'fa-file-word doc',
    xls:'fa-file-excel doc',xlsx:'fa-file-excel doc',txt:'fa-file-alt doc',
    jpg:'fa-file-image img',jpeg:'fa-file-image img',png:'fa-file-image img',
    gif:'fa-file-image img',webp:'fa-file-image img',
    mp4:'fa-file-video vid',mov:'fa-file-video vid',avi:'fa-file-video vid',
    mp3:'fa-file-audio aud',wav:'fa-file-audio aud',ogg:'fa-file-audio aud',
    m4a:'fa-file-audio aud',flac:'fa-file-audio aud',
  };
  return types[ext]||'fa-file other';
}

function isImage(name) { return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name); }

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function capitalize(s) { return s?s.charAt(0).toUpperCase()+s.slice(1):''; }

/**
 * Client-side Image Compression
 * @param {File} file 
 * @param {number} maxWidth 
 * @param {number} quality (0 to 1) 
 * @returns {Promise<Blob>}
 */
function compressImage(file, maxWidth = 1920, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (blob) {
            // Only return compressed if it's actually smaller
            resolve(blob.size < file.size ? blob : file);
          } else {
            resolve(file);
          }
        }, file.type, quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

function showUploadProgress(show, percent = 0, status = 'Uploading...', loaded = 0, total = 0) {
  const overlay = document.getElementById('upload-progress-overlay');
  if (!overlay) return;
  overlay.style.display = show ? 'flex' : 'none';
  const fill = overlay.querySelector('.up-fill');
  const text = overlay.querySelector('.up-text');
  const stat = overlay.querySelector('.up-status');
  const det  = overlay.querySelector('.up-detail');
  
  if (fill) fill.style.width = `${percent}%`;
  if (text) text.textContent = `${Math.round(percent)}%`;
  if (stat) stat.textContent = status;
  if (det && total > 0) {
    det.textContent = `${(loaded / (1024*1024)).toFixed(1)} MB / ${(total / (1024*1024)).toFixed(1)} MB`;
  }
}

/**
 * Universal Share/Export Utility
 */
async function exportComponentAsImage(elementId, fileName, type = 'item') {
  const target = document.getElementById(elementId);
  const scWrap = document.getElementById('share-card-wrap');
  const scBody = document.getElementById('sc-content');
  if (!target || !scWrap || !scBody) return;

  toast('Capturing shareable image...', 'info');

  // Prepare the Share Card
  const isPreBuilt = target.id === 'share-card';
  
  if (!isPreBuilt) {
    scBody.innerHTML = '';
    const clone = target.cloneNode(true);
    clone.style.display = 'block'; // Ensure visible for capture
    
    // Remove interactive elements from clone
    clone.querySelectorAll('button, .icon-btn, .alarm-actions, .plan-card-actions, .tt-card-actions, .file-actions, .toggle-wrap, .status-btns')
      .forEach(el => el.remove());

    scBody.appendChild(clone);
  }

  try {
    const canvasSize = document.getElementById('share-card');
    const canvas = await html2canvas(canvasSize, {
      backgroundColor: '#0c0e14',
      scale: 2,
      useCORS: true,
      logging: false,
      scrollY: -window.scrollY,
      width: canvasSize.scrollWidth,
      windowWidth: canvasSize.scrollWidth + 100
    });

    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const file = new File([blob], `${fileName}.png`, { type: 'image/png' });

    if (navigator.share && window.isSecureContext) {
      await navigator.share({
        files: [file],
        title: `PlanTrack ${type}`,
        text: `Check out my ${type} on PlanTrack!`
      });
    } else {
      // Fallback: Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Image saved to downloads', 'success');
    }
  } catch (err) {
    console.error('Export failed:', err);
    toast('Capture failed. Please try again.', 'error');
  } finally {
    scBody.innerHTML = '';
  }
}

function shareFileCard(f) {
  const scBody = document.getElementById('sc-content');
  const scCard = document.getElementById('share-card');
  if (!scBody || !scCard) return;

  const isImg = isImage(f.name) && f.url;
  const icon = fileIcon(f.name);
  
  if (isImg) {
    // PURE IMAGE MODE: Only the image, no text/buttons/branding
    scBody.innerHTML = `
      <div class="sc-file-preview">
        <img src="${f.url}" alt="${escHtml(f.name)}" crossorigin="anonymous" />
      </div>`;
    scCard.classList.add('pure-image');
  } else {
    // STANDARD MODE: Branded card for other files
    scBody.innerHTML = `
      <div class="sc-file-card">
        <i class="fa ${icon} sc-file-icon"></i>
        <div class="sc-file-info">
          <div class="sc-file-name">${escHtml(f.name)}</div>
          <div class="sc-file-size">${fileSize(f.size || 0)}</div>
        </div>
        <div class="sc-download-btn">DOWNLOAD SECURELY ON PLANTRACK</div>
      </div>`;
    scCard.classList.add('no-brand');
  }

  const finalize = async () => {
    await exportComponentAsImage('share-card', `File_${f.name.replace(/\W/g,'_')}`, 'File');
    scCard.classList.remove('pure-image', 'no-brand');
  };

  if (isImg) {
    const img = scBody.querySelector('img');
    img.onload = finalize;
    img.onerror = finalize;
  } else {
    finalize();
  }
}

async function shareTimetable(id) {
  await viewTimetable(id); // Populates ttv-body
  // Wait a tiny bit for DOM to render
  setTimeout(() => exportComponentAsImage('ttv-body', `Timetable_${id}`, 'Timetable'), 100);
}

// ═══════════════════════════════════════════════════════════════
//  VOICE RECOGNITION
// ═══════════════════════════════════════════════════════════════
let recognition = null;

function startVoice(targetId, statusId) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast('Voice recognition not supported in this browser','error'); return;
  }
  if (recognition) { recognition.stop(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  
  // Find button by targetId match in onclick OR specific data attribute
  const btn = event?.currentTarget || document.querySelector(`[onclick*="${targetId}"]`);
  const statusEl = statusId ? document.getElementById(statusId) : null;
  if (btn) btn.classList.add('listening');
  if (statusEl) statusEl.textContent = '🎙️ Listening...';
  recognition.onresult = e => {
    document.getElementById(targetId).value = e.results[0][0].transcript;
    if (statusEl) statusEl.textContent = '✓ Got it!';
    setTimeout(() => { if (statusEl) statusEl.textContent=''; }, 2000);
  };
  recognition.onerror = () => {
    if (statusEl) statusEl.textContent = '⚠ Could not hear. Try again.';
    setTimeout(() => { if (statusEl) statusEl.textContent=''; }, 3000);
  };
  recognition.onend = () => { recognition=null; if (btn) btn.classList.remove('listening'); };
  recognition.start();
}

// ═══════════════════════════════════════════════════════════════
//  AUTH  — FIXED login bug
// ═══════════════════════════════════════════════════════════════
function switchTab(tab) {
  ['login','register','forgot'].forEach(t => {
    document.getElementById(`tab-${t}`).style.display = 'none';
  });
  document.getElementById(`tab-${tab}`).style.display = 'block';
  document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
  const tabs = document.querySelectorAll('.auth-tab');
  if (tab==='login' && tabs[0])    tabs[0].classList.add('active');
  if (tab==='register' && tabs[1]) tabs[1].classList.add('active');
  const welcomes = {
    login:    'Welcome back — sign in to continue',
    register: 'Create your account to get started',
    forgot:   'Reset your password',
  };
  const wEl = document.getElementById('auth-welcome-text');
  if (wEl) wEl.textContent = welcomes[tab]||'';
  const tabsEl = document.getElementById('auth-tabs');
  if (tabsEl) tabsEl.style.display = tab==='forgot'?'none':'flex';
  closeAuthMsg();
}

async function login() {
  const usernameEl = document.getElementById('l-user');
  const passwordEl = document.getElementById('l-pass');
  if (!usernameEl || !passwordEl) return;

  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  if (!username) { showAuthMsg('Please enter your username.'); return; }
  if (!password) { showAuthMsg('Please enter your password.'); return; }

  showAuthMsg('Signing in...', 'info');

  try {
    // Step 1: find email from username (case-insensitive match)
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('email')
      .ilike('username', username)
      .maybeSingle();

    if (profileError) {
      // Log the REAL Supabase error to the browser console
      console.error('[PlanTrack Login] Username lookup failed:', {
        code:    profileError.code,
        message: profileError.message,
        details: profileError.details,
        hint:    profileError.hint,
      });

      // Show a specific message based on error type
      if (!navigator.onLine) {
        showAuthMsg('You are offline. Please check your internet connection.');
      } else if (
        profileError.code === 'PGRST301' ||
        profileError.code === '42501'    ||
        (profileError.message || '').toLowerCase().includes('rls') ||
        (profileError.message || '').toLowerCase().includes('permission')
      ) {
        showAuthMsg('Database permission error. Please run fix-login-policy.sql in your Supabase SQL editor, then try again.');
      } else {
        showAuthMsg('Error looking up username (' + (profileError.message || 'unknown') + '). Please try again.');
      }
      return;
    }

    if (!profile) {
      showAuthMsg('Username not found. Please check spelling and try again.');
      return;
    }

    // Step 2: sign in with email + password
    const { data, error } = await db.auth.signInWithPassword({
      email:    profile.email,
      password: password,
    });

    if (error) {
      console.error('[PlanTrack Login] Sign-in failed:', error.message);
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('wrong')) {
        showAuthMsg('Incorrect password. Please try again.');
      } else if (msg.includes('email not confirmed')) {
        showAuthMsg('Please verify your email address first. Check your inbox for the confirmation link.');
      } else if (msg.includes('too many')) {
        showAuthMsg('Too many failed attempts. Please wait a few minutes and try again.');
      } else {
        showAuthMsg(error.message || 'Sign-in failed. Please try again.');
      }
      return;
    }

    if (!data || !data.user) {
      showAuthMsg('Login failed unexpectedly. Please try again.');
      return;
    }

    closeAuthMsg();
    await initApp(data.user);

  } catch (err) {
    console.error('[PlanTrack Login] Unexpected exception:', err);
    if (!navigator.onLine) {
      showAuthMsg('You are offline. Please check your internet connection.');
    } else {
      showAuthMsg('An unexpected error occurred. Please refresh the page and try again.');
    }
  }
}

async function signInWithGoogle() {
  try {
    // Build the redirect URL. On native Capacitor we use custom deep link scheme.
    const isCapacitor = window.Capacitor && window.Capacitor.isNative;
    const currentUrl = window.location.href.split('#')[0].split('?')[0];
    const redirectTo = isCapacitor ? 'com.lenovo.plantrack://login-callback' : currentUrl;

    showAuthMsg(isCapacitor ? 'Redirecting to Google…' : 'Opening Google sign-in…', 'info');

    // ── Get the OAuth URL without navigating away ──────────────
    const { data, error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo,
        skipBrowserRedirect: true   // ← don't navigate, just give us the URL
      }
    });
    if (error) throw error;

    if (!data?.url) {
      showAuthMsg('Could not start Google sign-in. Please try again.');
      return;
    }

    // ── Capacitor Native: Open in external Chrome/System Browser ──
    if (isCapacitor) {
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        await window.Capacitor.Plugins.Browser.open({ url: data.url, windowName: '_system' });
      } else {
        window.open(data.url, '_system');
      }
      return;
    }

    // ── Web Popup Flow ──
    const w = 500, h = 620;
    const left = Math.max(0, (screen.width - w) / 2);
    const top  = Math.max(0, (screen.height - h) / 2);
    const popup = window.open(
      data.url,
      'google-auth',
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,scrollbars=yes`
    );

    // Fallback: if popup was blocked, fall back to full redirect
    if (!popup || popup.closed) {
      showAuthMsg('Popup blocked — redirecting…', 'info');
      window.location.href = data.url;
      return;
    }

    // ── Poll the popup until it redirects back with tokens ────
    const pollTimer = setInterval(async () => {
      try {
        // Popup was closed manually by the user
        if (!popup || popup.closed) {
          clearInterval(pollTimer);
          closeAuthMsg();
          // Check if maybe the session was set anyway
          const { data: { session } } = await db.auth.getSession();
          if (!session) {
            showAuthMsg('Sign-in was cancelled.');
          }
          return;
        }

        // Try to read the popup's URL — throws while on Google's domain
        const popupUrl = popup.location.href;

        // Check if the popup redirected back to our origin with tokens
        if (popupUrl.startsWith(currentUrl) || popupUrl.startsWith(window.location.origin)) {
          const hashFragment = popup.location.hash;

          // Only process if we actually have tokens in the hash
          if (hashFragment && hashFragment.includes('access_token')) {
            clearInterval(pollTimer);
            popup.close();

            // Parse tokens from the hash fragment
            const params = new URLSearchParams(hashFragment.substring(1));
            const access_token  = params.get('access_token');
            const refresh_token = params.get('refresh_token');

            if (access_token && refresh_token) {
              // Set the session on our main-window Supabase client
              const { error: sessErr } = await db.auth.setSession({
                access_token,
                refresh_token
              });
              if (sessErr) {
                console.error('[Google Auth] setSession error:', sessErr);
                showAuthMsg('Error completing sign-in: ' + sessErr.message);
              }
              // onAuthStateChange will handle the rest (hide auth screen, init app)
            } else {
              showAuthMsg('Sign-in failed — missing tokens. Please try again.');
            }
          }
        }
      } catch (e) {
        // Cross-origin error — popup is still on Google/Supabase domain, keep polling
      }
    }, 400);

  } catch (err) {
    console.error('[Google Auth]', err);
    showAuthMsg('Error signing in with Google: ' + err.message);
  }
}

async function register() {
  const username = document.getElementById('r-user').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const password = document.getElementById('r-pass').value;
  const confirmPassword = document.getElementById('r-pass-confirm').value;

  if (!username) { showAuthMsg('Please enter a username.'); return; }
  if (!email)    { showAuthMsg('Please enter your email.'); return; }
  if (!password) { showAuthMsg('Please enter a password.'); return; }
  if (password !== confirmPassword) { showAuthMsg('Passwords do not match.'); return; }
  if (password.length < 6) { showAuthMsg('Password must be at least 6 characters.'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) { showAuthMsg('Username can only contain letters, numbers and underscores.'); return; }

  showAuthMsg('Creating account...', 'info');

  try {
    // Check if username already taken
    const { data: existing } = await db.from('profiles').select('id').eq('username', username).maybeSingle();
    if (existing) { showAuthMsg('Username already taken. Please choose another.'); return; }

    const { data, error } = await db.auth.signUp({ email, password });
    if (error) { showAuthMsg(error.message); return; }

    if (data.user) {
      // Create profile row — upsert so it works even if RLS partially blocks
      const { error: profileErr } = await db.from('profiles').upsert({
        id: data.user.id,
        username,
        email
      }, { onConflict: 'id' });
      if (profileErr) {
        console.warn('Profile upsert failed during register, will complete on login:', profileErr.message);
      }
      showAuthMsg('Account created! You can now sign in.', 'success');
      document.getElementById('r-user').value = '';
      document.getElementById('r-email').value = '';
      document.getElementById('r-pass').value = '';
      setTimeout(() => switchTab('login'), 1500);
    }
  } catch (err) {
    showAuthMsg('An error occurred. Please try again.');
  }
}

async function sendReset() {
  const email = document.getElementById('f-email').value.trim();
  if (!email) { showAuthMsg('Please enter your email.'); return; }
  const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
  if (error) { showAuthMsg(error.message); return; }
  showAuthMsg('Reset link sent! Check your inbox.', 'success');
}

async function logout() {
  stopAlarmChecker();
  stopSound();
  await db.auth.signOut();
  currentUser = null; currentUserId = null; currentUserProfile = null;
  document.getElementById('app').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  switchTab('login');
}

function confirmLogout() {
  document.getElementById('confirm-text').textContent = 'Are you sure you want to sign out?';
  openModal('modal-confirm');
  document.getElementById('confirm-ok').onclick = () => {
    closeModal('modal-confirm');
    logout();
  };
}

// ═══════════════════════════════════════════════════════════════
//  APP INIT
// ═══════════════════════════════════════════════════════════════
async function initApp(user) {
  currentUser   = user;
  currentUserId = user.id;

  // Load profile
  let { data: profile } = await db.from('profiles').select('*').eq('id', user.id).maybeSingle();
  
  const needsProfileSetup = !profile || !profile.username || !profile.avatar_url;

  if (needsProfileSetup) {
    // Pre-fill username if they already have one (only avatar missing)
    if (profile && profile.username) {
      const setupInput = document.getElementById('setup-username-input');
      if (setupInput) setupInput.value = profile.username;
    }

    // Show the complete profile modal
    openModal('modal-complete-profile');

    // Update modal subtitle based on what's missing
    const modalP = document.querySelector('#modal-complete-profile .mb p');
    if (modalP) {
      if (!profile || !profile.username) {
        modalP.textContent = 'Welcome! Please choose a username and upload a profile picture to continue.';
      } else {
        modalP.textContent = 'Almost there! Please upload a profile picture to complete your account setup.';
      }
    }

    // Hide the close button to force completion
    const closeBtn = document.querySelector('#modal-complete-profile .mclose');
    if (closeBtn) closeBtn.style.display = 'none';
  }

  currentUserProfile = profile;

  const displayName = profile?.username || user.email;
  const dispEl = document.getElementById('disp-user');
  if (dispEl) dispEl.textContent = displayName;

  // Set profile avatar initial
  renderAvatar();

  // Check and toggle Admin Panel nav visibility
  const adminNav = document.getElementById('nav-admin');
  if (adminNav) {
    adminNav.style.display = (profile && profile.is_admin) ? 'block' : 'none';
  }

  // Sync daily streak (Supabase-backed)
  await syncStreak();

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  await loadUserSounds();

  // Restore last visited section (so refresh stays on same page)
  const lastSection = (() => { try { return localStorage.getItem('pt_last_section') || 'alarms'; } catch(e) { return 'alarms'; } })();
  showSection(lastSection);

  startAlarmChecker();
  startAlarmCountdown();
  buildSoundGrid();
  
  // Sync state when coming back to app
  window.addEventListener('focus', () => {
    loadAlarms();
    syncStreak(); // re-check streak when user returns (e.g. app left open overnight)
    if (ringActive) {
       // Check if sound should still be playing
       // (e.g. if dismissed in background)
    }
  });

  // Schedule streak-loss reminder notification
  scheduleStreakReminder();

  // Init real social system
  if (window.initSocialReal) window.initSocialReal();

  // Dynamic message status relative time updater
  if (messageStatusInterval) clearInterval(messageStatusInterval);
  messageStatusInterval = setInterval(updateAllRelativeTimes, 5000);


  // ── Service Worker: listen for updates & auto-reload ─────────
  if ('serviceWorker' in navigator) {
    // Message from SW when a new version just activated
    navigator.serviceWorker.addEventListener('message', event => {
      const { type, alarm, minutesBefore } = event.data || {};
      if (type === 'SW_UPDATED') {
        setTimeout(() => window.location.reload(), 300);
      }
      // SW detected alarm time while app was in foreground
      if (type === 'RING_ALARM_INAPP' && alarm && !ringActive) {
        ringAlarm(alarm);
      }
      // SW detected 15/10-min reminder while app was in foreground
      if (type === 'SHOW_REMINDER' && alarm && minutesBefore) {
        showReminderBanner(alarm, minutesBefore);
      }
    });

    // Watch for a new SW installing while app is open
    navigator.serviceWorker.ready.then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // New SW installed and ready — activate it immediately
            newWorker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    });

    // Reload when controller changes (SW just took over)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
}

function renderAvatar() {
  const displayName = currentUserProfile?.username || currentUser?.email || 'U';
  const initial = displayName.charAt(0).toUpperCase();

  // Check DB first, then localStorage fallback
  const localKey = currentUserId ? `avatar_${currentUserId}` : null;
  const localUrl  = localKey ? localStorage.getItem(localKey) : null;
  const avatarUrl = currentUserProfile?.avatar_url || localUrl;

  // Helper to set any avatar element
  function setAvatarEl(el) {
    if (!el) return;
    if (avatarUrl) {
      el.innerHTML = `<img src="${avatarUrl}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="Avatar" onerror="this.parentElement.innerHTML='';this.parentElement.textContent='${initial}'">`;
    } else {
      el.innerHTML = '';
      el.textContent = initial;
    }
  }

  // Sync both avatar spots
  setAvatarEl(document.getElementById('profile-avatar-display'));
  setAvatarEl(document.getElementById('topbar-avatar-display'));
}

// ═══════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════
function showSection(name) {
  document.querySelectorAll('.sec').forEach(s => s.classList.remove('active'));
  const sec = document.getElementById(`sec-${name}`);
  if (sec) sec.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  const navBtn = document.getElementById(`nav-${name}`);
  if (navBtn) navBtn.classList.add('active');

  // Remember last section so refresh restores it
  try { localStorage.setItem('pt_last_section', name); } catch(e) {}

  const loaders = {
    alarms:       loadAlarms,
    timetable:    loadTimetables,
    files:        loadFolders,
    plans:        loadPlans,
    profile:      loadProfile,
    chats:        loadChats,
    addfriends:   loadFriendsReal,
    admin:        () => { if (window.loadAdminPanel) window.loadAdminPanel(); },
    focustimer:   loadFocusStats,
    social:       () => { if(window.loadFriends) loadFriends(); if(window.loadSharedWithMe) loadSharedWithMe(); },
  };
  if (loaders[name]) loaders[name]();

  // Close sidebar on mobile after navigation
  closeSidebarMobile();
}

function toggleSidebar() {
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sidebar-overlay');
  if (!sb) return;
  if (window.innerWidth <= 768) {
    sb.classList.toggle('open');
    if (ov) ov.classList.toggle('show');
  } else {
    sb.classList.toggle('collapsed');
  }
}

function closeSidebarMobile() {
  if (window.innerWidth <= 768) {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
  }
}

// ═══════════════════════════════════════════════════════════════
//  PROFILE
// ═══════════════════════════════════════════════════════════════
async function loadProfile() {
  if (!currentUserId) return;

  const profile = currentUserProfile;
  if (!profile) return;

  // Display info
  const usernameEl = document.getElementById('profile-username-display');
  const emailEl    = document.getElementById('profile-email-display');
  const joinedEl   = document.getElementById('profile-joined-display');
  const avatarEl   = document.getElementById('profile-avatar-display');

  if (usernameEl) usernameEl.textContent = profile.username || 'Unknown';
  if (emailEl)    emailEl.textContent    = profile.email || currentUser?.email || '';
  if (joinedEl)   joinedEl.textContent   = `Joined ${fmtDate(profile.created_at?.split('T')[0] || today())}`;
  renderAvatar();

  // Load stats
  const [alarms, timetables, folders, plans, sessions, friendships] = await Promise.all([
    db.from('alarms').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
    db.from('timetables').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
    db.from('folders').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
    db.from('plans').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
    db.from('focus_sessions').select('duration_secs').eq('user_id', currentUserId),
    db.from('friends').select('status').or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`),
  ]);

  const sessionCount = sessions.data ? sessions.data.length : 0;
  const totalSeconds = sessions.data ? sessions.data.reduce((sum, s) => sum + (s.duration_secs || 0), 0) : 0;
  const totalMins = Math.round(totalSeconds / 60);
  const friendsCount = friendships.data ? friendships.data.filter(f => f.status === 'accepted').length : 0;

  const setEl = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val||0; };
  setEl('stat-alarms',         alarms.count);
  setEl('stat-timetables',     timetables.count);
  setEl('stat-folders',        folders.count);
  setEl('stat-plans',          plans.count);
  setEl('stat-focus-sessions', sessionCount);
  setEl('stat-focus-mins',     `${totalMins}m`);
  setEl('stat-friends',        friendsCount);

  // Update profile streak badge from Supabase data
  const streakEl = document.getElementById('profile-streak-badge');
  if (streakEl && currentUserProfile) {
    const cs = currentUserProfile.current_streak || 0;
    const ls = currentUserProfile.longest_streak || 0;
    streakEl.textContent = `🔥 ${cs} Day Streak (Best: ${ls})`;
  }

  // Load friends and requests for the profile friends section
  if (typeof loadFriendsReal === 'function') {
    loadFriendsReal();
  }
}


function openEditProfileModal() {
  const inp = document.getElementById('edit-username-input');
  if (inp) inp.value = currentUserProfile?.username || '';
  openModal('modal-edit-profile');
}

async function saveProfile() {
  const val = document.getElementById('edit-username-input').value.trim();
  if (!val) { toast('Username cannot be empty', 'error'); return; }
  const { error } = await db.from('profiles').upsert({
    id: currentUserId,
    username: val,
    email: currentUser?.email || currentUserProfile?.email || ''
  }, { onConflict: 'id' });
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  if (!currentUserProfile) currentUserProfile = {};
  currentUserProfile.username = val;
  toast('Profile updated!', 'success');
  closeModal('modal-edit-profile');
  document.getElementById('disp-user').textContent = val;
  loadProfile();
}

let pendingSetupAvatarFile = null;

function setupAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please select an image', 'error'); return; }
  
  pendingSetupAvatarFile = file;
  
  // Show local preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const display = document.getElementById('setup-avatar-display');
    if (display) {
      display.style.backgroundImage = `url(${e.target.result})`;
      display.style.backgroundSize = 'cover';
      display.style.backgroundPosition = 'center';
      display.textContent = ''; // clear the '?'
    }
  };
  reader.readAsDataURL(file);
}

async function saveCompleteProfile() {
  const usernameInput = document.getElementById('setup-username-input');
  const val = usernameInput ? usernameInput.value.trim() : '';

  if (!val) { toast('Please choose a username', 'error'); return; }
  if (!/^[a-zA-Z0-9_]+$/.test(val)) { toast('Username can only contain letters, numbers and underscores.', 'error'); return; }

  showUploadProgress(true, 10, 'Saving profile...');

  try {
    // Check if username taken
    const { data: existing } = await db.from('profiles').select('id').eq('username', val).neq('id', currentUserId).maybeSingle();
    if (existing) { showUploadProgress(false); toast('Username already taken. Please choose another.', 'error'); return; }

    let avatarUrl = currentUserProfile?.avatar_url || currentUser?.user_metadata?.avatar_url || null;

    if (pendingSetupAvatarFile) {
      showUploadProgress(true, 30, 'Uploading picture...');
      const finalFile = await compressImage(pendingSetupAvatarFile, 800, 0.7);
      const path = `${currentUserId}/avatar_${Date.now()}`;
      const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, finalFile, { upsert: true });
      if (!upErr) {
        const { data: pubData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        avatarUrl = pubData.publicUrl;
      }
    }

    showUploadProgress(true, 80, 'Updating profile...');
    
    // Upsert: creates the row if it doesn't exist, updates if it does
    const { error: dbError } = await db.from('profiles').upsert({
      id: currentUserId,
      username: val,
      email: currentUser?.email || '',
      avatar_url: avatarUrl
    }, { onConflict: 'id' });
    
    if (dbError) throw dbError;

    if (!currentUserProfile) currentUserProfile = {};
    currentUserProfile.username = val;
    if (avatarUrl) currentUserProfile.avatar_url = avatarUrl;
    
    document.getElementById('disp-user').textContent = val;
    renderAvatar();
    if (typeof loadProfile === 'function') loadProfile();
    
    showUploadProgress(false);
    toast('Profile setup complete!', 'success');
    closeModal('modal-complete-profile');
    
    // Restore close button just in case
    const closeBtn = document.querySelector('#modal-complete-profile .mclose');
    if (closeBtn) closeBtn.style.display = 'block';

  } catch (err) {
    showUploadProgress(false);
    toast('Error: ' + err.message, 'error');
  }
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please select an image', 'error'); return; }
  
  showUploadProgress(true, 10, 'Optimizing image...');
  const finalFile = await compressImage(file, 800, 0.7);
  
  showUploadProgress(true, 40, 'Uploading picture...');

  const path = `${currentUserId}/avatar_${Date.now()}`;
  const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, finalFile, { 
    upsert: true,
    onUploadProgress: (p) => {
      const pct = 40 + (p.loaded / p.total) * 50;
      showUploadProgress(true, pct, 'Uploading picture...', p.loaded, p.total);
    }
  });

  if (upErr) {
    showUploadProgress(false);
    console.warn('Storage upload failed, using local fallback:', upErr.message);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const localKey = `avatar_${currentUserId}`;
      try {
        localStorage.setItem(localKey, dataUrl);
        if (currentUserProfile) currentUserProfile.avatar_url = null;
        renderAvatar();
        toast('Profile picture saved locally!', 'success');
      } catch (storageErr) {
        toast('Image too large to store locally.', 'error');
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
    return;
  }

  const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = urlData?.publicUrl;

  if (!publicUrl) {
    showUploadProgress(false);
    toast('Could not get image URL.', 'error');
    event.target.value = '';
    return;
  }

  const { error: dbErr } = await db.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUserId);
  showUploadProgress(false);

  if (dbErr) {
    localStorage.setItem(`avatar_${currentUserId}`, publicUrl);
    if (currentUserProfile) currentUserProfile.avatar_url = null;
    renderAvatar();
    toast('Profile picture saved!', 'success');
  } else {
    if (currentUserProfile) currentUserProfile.avatar_url = publicUrl;
    localStorage.removeItem(`avatar_${currentUserId}`);
    renderAvatar();
    toast('Profile picture updated!', 'success');
  }

  event.target.value = '';
}

function openChangePasswordModal() {
  const np = document.getElementById('new-password');
  const cp = document.getElementById('confirm-password');
  const pm = document.getElementById('password-msg');
  if (np) np.value = '';
  if (cp) cp.value = '';
  if (pm) pm.textContent = '';
  openModal('modal-password');
}

async function changePassword() {
  const newPw  = document.getElementById('new-password').value;
  const confPw = document.getElementById('confirm-password').value;
  const msgEl  = document.getElementById('password-msg');

  if (!newPw) { if(msgEl) msgEl.textContent='Please enter a new password.'; return; }
  if (newPw.length < 6) { if(msgEl) msgEl.textContent='Password must be at least 6 characters.'; return; }
  if (newPw !== confPw) { if(msgEl) msgEl.textContent='Passwords do not match.'; return; }

  const { error } = await db.auth.updateUser({ password: newPw });
  if (error) { if(msgEl) msgEl.textContent = error.message; return; }

  toast('Password updated successfully!', 'success');
  closeModal('modal-password');
}

// ═══════════════════════════════════════════════════════════════
//  USER SOUND LIBRARY
// ═══════════════════════════════════════════════════════════════
async function loadUserSounds() {
  try {
    const { data } = await db.from('user_sounds').select('*')
      .eq('user_id', currentUserId).order('created_at', { ascending: false });
    userSounds = (data||[]).map(s => ({ ...s, id: `user-${s.id}` }));
  } catch(e) {
    userSounds = [];
  }
}

async function uploadMusicFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('audio/')) {
    toast('Please upload an audio file (MP3, WAV, OGG, M4A etc)', 'error');
    event.target.value = ''; return;
  }
  
  showUploadProgress(true, 20, 'Uploading music...');
  const path = `${currentUserId}/sounds/${Date.now()}_${file.name}`;
  const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { 
    upsert: true,
    onUploadProgress: (p) => {
      const pct = 20 + (p.loaded / p.total) * 70;
      showUploadProgress(true, pct, 'Uploading music...', p.loaded, p.total);
    }
  });
  
  if (uploadErr) { 
    showUploadProgress(false);
    toast('Upload failed: '+uploadErr.message, 'error'); 
    return; 
  }
  
  showUploadProgress(true, 70, 'Saving to library...');
  const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const { error: dbErr } = await db.from('user_sounds').insert({
    user_id: currentUserId,
    name: file.name.replace(/\.[^/.]+$/, ''),
    path, url: urlData.publicUrl, size: file.size,
  });
  
  showUploadProgress(false);
  if (dbErr) { toast('Could not save sound: '+dbErr.message, 'error'); return; }
  toast(`✅ "${file.name}" added to your sounds!`, 'success');
  event.target.value = '';
  await loadUserSounds();
  buildSoundGrid();
}

async function deleteUserSound(soundId, soundName) {
  const { data: sound } = await db.from('user_sounds').select('path').eq('id', soundId).single();
  if (sound?.path) await db.storage.from(STORAGE_BUCKET).remove([sound.path]);
  await db.from('user_sounds').delete().eq('id', soundId).eq('user_id', currentUserId);
  if (selectedSound === `user-${soundId}`) selectedSound = null;
  toast(`"${soundName}" removed.`, 'info');
  await loadUserSounds();
  buildSoundGrid();
}

// ═══════════════════════════════════════════════════════════════
//  ALARMS
// ═══════════════════════════════════════════════════════════════
function buildSoundGrid() {
  const grid = document.getElementById('sound-grid');
  if (!grid) return;

  let html = `<div class="sound-section-label">🎵 Built-in Sounds</div>
    ${SOUNDS.map(s=>`
      <div class="sound-item" id="si-${s.id}" onclick="selectSound('${s.id}')">
        <span class="sound-emoji">${s.emoji}</span>
        <span class="sound-name">${s.name}</span>
        <button class="sound-preview-btn" onclick="event.stopPropagation();previewSound('${s.id}')" title="Preview" type="button">
          <i class="fa fa-play"></i>
        </button>
      </div>`).join('')}
    <div class="sound-section-label" style="margin-top:12px">🎶 My Music</div>`;

  if (userSounds.length) {
    html += userSounds.map(s=>`
      <div class="sound-item" id="si-${s.id}" onclick="selectSound('${s.id}')">
        <span class="sound-emoji">🎵</span>
        <span class="sound-name">${escHtml(s.name)}</span>
        <button class="sound-preview-btn" onclick="event.stopPropagation();previewSound('${s.id}')" title="Preview" type="button">
          <i class="fa fa-play"></i>
        </button>
        <button class="sound-del-btn" onclick="event.stopPropagation();deleteUserSound('${s.id.replace('user-','')}','${escHtml(s.name)}')" title="Remove" type="button">
          <i class="fa fa-trash"></i>
        </button>
      </div>`).join('');
  } else {
    html += `<div class="sound-empty-msg">No music uploaded yet. Upload below!</div>`;
  }

  html += `<label class="sound-upload-btn">
    <i class="fa fa-upload"></i> Upload Music (MP3, WAV, OGG, M4A)
    <input type="file" accept="audio/*" style="display:none" onchange="uploadMusicFile(event)"/>
  </label>`;

  grid.innerHTML = html;

  if (selectedSound) {
    const el = document.getElementById(`si-${selectedSound}`);
    if (el) el.classList.add('selected');
  }
}

function selectSound(id) {
  selectedSound = id;
  document.querySelectorAll('.sound-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById(`si-${id}`);
  if (el) el.classList.add('selected');
  previewSound(id);
}

function openAlarmModal(alarm = null) {
  editingAlarmId = alarm ? alarm.id : null;
  document.getElementById('alarm-modal-title').innerHTML =
    alarm ? '<i class="fa fa-edit"></i> Edit Alarm' : '<i class="fa fa-bell"></i> New Alarm';
  document.getElementById('a-time').value   = alarm?.time   || '';
  document.getElementById('a-date').value   = alarm?.date   || '';
  document.getElementById('a-label').value  = alarm?.label  || '';
  document.getElementById('a-repeat').value = alarm?.repeat || 'none';
  selectedSound = alarm?.sound || null;
  document.querySelectorAll('.sound-item').forEach(el => el.classList.remove('selected'));
  if (selectedSound) {
    const el = document.getElementById(`si-${selectedSound}`);
    if (el) el.classList.add('selected');
  }
  openModal('modal-alarm');
}

async function saveAlarm() {
  const time   = document.getElementById('a-time').value;
  const date   = document.getElementById('a-date').value;
  const label  = document.getElementById('a-label').value.trim();
  const repeat = document.getElementById('a-repeat').value;
  if (!time)          { toast('Please select a time.','error'); return; }
  if (!label)         { toast('Please enter a label/reason.','error'); return; }
  if (!selectedSound) { toast('Please choose an alarm sound.','error'); return; }
  const payload = { user_id:currentUserId, time, date:date||null, label, repeat, sound:selectedSound, is_active:true };
  let error;
  if (editingAlarmId) {
    ({error} = await db.from('alarms').update(payload).eq('id',editingAlarmId).eq('user_id',currentUserId));
  } else {
    ({error} = await db.from('alarms').insert(payload));
  }
  if (error) { toast('Error saving alarm: '+error.message,'error'); return; }
  toast(editingAlarmId?'Alarm updated!':'Alarm created!','success');
  closeModal('modal-alarm');
  loadAlarms();
}

async function loadAlarms() {
  const { data, error } = await db.from('alarms').select('*').eq('user_id',currentUserId).order('time');
  if (error) { toast('Could not load alarms.','error'); return; }
  renderAlarms(data||[]);
  if (window.pushAlarmsToSW) window.pushAlarmsToSW(data||[]);
  
  // ── CAPACITOR NATIVE ALARM INTEGRATION ────────────────────────────
  // If running as a compiled Android/iOS app via Capacitor, this will
  // schedule exact OS-level background alarms that survive app closure.
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
    try {
      await scheduleNativeCapacitorAlarms(data || []);
    } catch (e) {
      console.error('Capacitor native alarm scheduling failed:', e);
    }
  }
}

// Simple hash function for generating unique integer IDs for Capacitor
function generateNumericId(uuidStr, offset = 0) {
  let hash = 0;
  for (let i = 0; i < uuidStr.length; i++) {
    hash = ((hash << 5) - hash) + uuidStr.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash) % 1000000 + offset;
}

async function scheduleNativeCapacitorAlarms(alarms) {
  const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
  
  let permStatus = await LocalNotifications.checkPermissions();
  if (permStatus.display !== 'granted') {
    permStatus = await LocalNotifications.requestPermissions();
  }
  if (permStatus.display !== 'granted') return;

  // ── Android Exact Alarm Permission Check ──
  if (window.Capacitor.getPlatform() === 'android') {
    try {
      const exactStatus = await LocalNotifications.checkExactNotificationSetting();
      if (exactStatus.exact_alarm !== 'granted') {
        const confirmResult = confirm(
          "PlanTrack needs 'Alarms & Reminders' permission to ring alarms when the app is closed. Click OK to open Settings and turn it on."
        );
        if (confirmResult) {
          await LocalNotifications.changeExactNotificationSetting();
        }
        return; // Stop scheduling until permission is granted
      }
    } catch (e) {
      console.warn('[PlanTrack Native] Failed to check exact alarm setting:', e);
    }
  }

  // ── Create notification channels (Android 8+ REQUIRES this for custom sound) ──
  // Note: We use -v2 channel IDs because channel sound is immutable once created.
  try {
    await LocalNotifications.createChannel({
      id: 'plantrack-alarms-v2',
      name: 'PlanTrack Alarms',
      description: 'Alarm notifications with custom sound and vibration',
      importance: 5,          // MAX importance = heads-up + sound + vibrate
      visibility: 1,          // Show on lock screen
      sound: 'alarm_sound',   // Custom loud wav sound file (alarm_sound.wav in res/raw)
      vibration: true,
      lights: true,
      lightColor: '#FF6B35',
    });

    await LocalNotifications.createChannel({
      id: 'plantrack-reminders-v2',
      name: 'PlanTrack Reminders',
      description: 'Pre-alarm reminder notifications with custom sound',
      importance: 4,          // HIGH importance = heads-up + sound
      visibility: 1,
      sound: 'alarm_sound',
      vibration: true,
    });
    console.log('[PlanTrack Native] Notification channels v2 created with custom alarm sound.');
  } catch (e) {
    console.warn('[PlanTrack Native] Channel creation skipped:', e.message);
  }

  // Clear existing pending native notifications to avoid duplicates
  const pending = await LocalNotifications.getPending();
  if (pending.notifications && pending.notifications.length > 0) {
     await LocalNotifications.cancel({ 
       notifications: pending.notifications.map(n => ({ id: n.id })) 
     });
  }

  const notifsToSchedule = [];
  const now = Date.now();
  
  alarms.forEach(alarm => {
    if (!alarm.is_active) return;
    
    const nextDate = getNextAlarmDate(alarm.time, alarm.date, alarm.repeat);
    if (!nextDate) return;
    
    const nextMs = nextDate.getTime();
    if (nextMs <= now) return;

    const baseId = generateNumericId(alarm.id, 0);

    // ── Exact Alarm notification (LOUD, full sound, vibration) ──
    notifsToSchedule.push({
      id: baseId,
      title: `⏰ ${alarm.label}`,
      body: `Your alarm is ringing! Time: ${fmt12(alarm.time)}`,
      channelId: 'plantrack-alarms-v2',
      schedule: { at: new Date(nextMs), allowWhileIdle: true },
      sound: 'alarm_sound',
      extra: { alarmId: alarm.id, type: 'alarm' },
    });

    // ── 15-min reminder ──
    const r15 = nextMs - 15 * 60000;
    if (r15 > now) {
      notifsToSchedule.push({
        id: generateNumericId(alarm.id, 1000000),
        title: `🔔 Alarm in 15 minutes`,
        body: `"${alarm.label}" is coming up at ${fmt12(alarm.time)}`,
        channelId: 'plantrack-reminders-v2',
        schedule: { at: new Date(r15), allowWhileIdle: true },
        sound: 'alarm_sound',
        extra: { alarmId: alarm.id, type: 'reminder' },
      });
    }

    // ── 10-min reminder ──
    const r10 = nextMs - 10 * 60000;
    if (r10 > now) {
      notifsToSchedule.push({
        id: generateNumericId(alarm.id, 2000000),
        title: `🔔 Alarm in 10 minutes`,
        body: `"${alarm.label}" is coming up at ${fmt12(alarm.time)}`,
        channelId: 'plantrack-reminders-v2',
        schedule: { at: new Date(r10), allowWhileIdle: true },
        sound: 'alarm_sound',
        extra: { alarmId: alarm.id, type: 'reminder' },
      });
    }
  });

  if (notifsToSchedule.length > 0) {
    await LocalNotifications.schedule({ notifications: notifsToSchedule });
    console.log(`[PlanTrack Native] Scheduled ${notifsToSchedule.length} native alarms/reminders on v2 channels.`);
  }
}

function getSoundLabel(soundId) {
  if (!soundId) return { emoji:'🔔', name:'No Sound' };
  if (soundId.startsWith('user-')) {
    const us = userSounds.find(s => s.id === soundId);
    return us ? { emoji:'🎵', name:us.name } : { emoji:'🎵', name:'My Music' };
  }
  const s = SOUNDS.find(x => x.id === soundId);
  return s ? { emoji:s.emoji, name:s.name } : { emoji:'🔔', name:soundId };
}

function renderAlarms(alarms) {
  const grid  = document.getElementById('alarms-grid');
  const empty = document.getElementById('alarms-empty');
  grid.innerHTML = '';
  if (!alarms.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';

  alarms.forEach(a => {
    const sound = getSoundLabel(a.sound);
    const card  = document.createElement('div');
    card.className = `alarm-card${a.is_active ? '' : ' off'}`;
    card.innerHTML = `
      <div class="alarm-status-bar ${a.is_active ? 'status-on' : 'status-off'}">
        <span class="status-dot"></span>
        <span class="status-text">${a.is_active ? 'Active' : 'Disabled'}</span>
      </div>
      <div class="alarm-time" data-time="${a.time}" data-date="${a.date||''}" data-repeat="${a.repeat}" data-active="${a.is_active}">${fmt12(a.time)}</div>
      <div class="alarm-countdown-bar" data-time="${a.time}" data-date="${a.date||''}" data-repeat="${a.repeat}" data-active="${a.is_active}">
        <i class="fa fa-hourglass-half countdown-icon"></i>
        <span class="countdown-text"></span>
      </div>
      <div class="alarm-label">${escHtml(a.label)}</div>
      <div class="alarm-meta">
        ${a.date ? `<span><i class="fa fa-calendar"></i> ${fmtDate(a.date)}</span>` : ''}
        <span><i class="fa fa-redo-alt"></i> ${a.repeat==='none'?'Once':capitalize(a.repeat)}</span>
      </div>
      <div class="alarm-sound-tag"><i class="fa fa-music"></i> ${sound.emoji} ${escHtml(sound.name)}</div>
      <div class="alarm-actions">
        <div class="toggle-wrap" onclick="toggleAlarm('${a.id}',${!a.is_active})">
          <div class="toggle-switch ${a.is_active?'on':''}"></div>
          <span class="toggle-label">${a.is_active ? 'ON' : 'OFF'}</span>
        </div>
        <button class="icon-btn edit-alarm" title="Edit" type="button"><i class="fa fa-edit"></i></button>
        <button class="icon-btn del" onclick="confirmDelete('alarm','${a.id}','${escHtml(a.label)}')" title="Delete" type="button"><i class="fa fa-trash"></i></button>
      </div>`;
    
    card.querySelector('.edit-alarm').addEventListener('click', () => openAlarmModal(a));
    grid.appendChild(card);
  });
}

async function toggleAlarm(id, val) {
  await db.from('alarms').update({ is_active:val }).eq('id',id).eq('user_id',currentUserId);
  loadAlarms();
}

function startAlarmChecker() {
  stopAlarmChecker();
  alarmInterval = setInterval(checkAlarms, 15000);
  checkAlarms();
}

function stopAlarmChecker() {
  if (alarmInterval) clearInterval(alarmInterval);
}

function startAlarmCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  updateTimeLeft();
  countdownInterval = setInterval(updateTimeLeft, 1000); // live every second
}

function getNextAlarmDate(time, date, repeat) {
  const now = new Date();
  const [h, m] = time.split(':').map(Number);
  let alarmDate = new Date();
  alarmDate.setHours(h, m, 0, 0);

  if (repeat === 'none' && date) {
    const d = new Date(date + 'T00:00:00');
    alarmDate.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
  }

  if (alarmDate < now && repeat !== 'none') {
    alarmDate.setDate(alarmDate.getDate() + 1);
  }

  return alarmDate;
}

function updateTimeLeft() {
  const bars = document.querySelectorAll('.alarm-countdown-bar');
  const now = new Date();

  bars.forEach(bar => {
    const textEl = bar.querySelector('.countdown-text');
    const iconEl = bar.querySelector('.countdown-icon');
    if (!textEl) return;

    const isActive = bar.getAttribute('data-active') === 'true';
    if (!isActive) { bar.style.display = 'none'; return; }

    const time   = bar.getAttribute('data-time');
    const repeat = bar.getAttribute('data-repeat');
    const date   = bar.getAttribute('data-date');
    if (!time) return;

    const alarmDate = getNextAlarmDate(time, date, repeat);

    if (alarmDate < now) { bar.style.display = 'none'; return; }

    const diff = Math.max(0, alarmDate.getTime() - now.getTime());
    const totalSecs = Math.floor(diff / 1000);
    const hrs  = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    let text;
    if (totalSecs <= 0) {
      text = '🔔 Ringing now!';
    } else if (hrs > 0) {
      text = `${hrs}h ${String(mins).padStart(2,'0')}m ${String(secs).padStart(2,'0')}s`;
    } else if (mins > 0) {
      text = `${mins}m ${String(secs).padStart(2,'0')}s`;
    } else {
      text = `${secs}s`;
    }
    textEl.textContent = text;

    bar.classList.remove('countdown-soon', 'countdown-urgent', 'countdown-due');
    if (totalSecs <= 0) {
      bar.classList.add('countdown-due');
    } else if (totalSecs < 300) {
      bar.classList.add('countdown-urgent');
    } else if (totalSecs < 1800) {
      bar.classList.add('countdown-soon');
    }

    if (iconEl) {
      if (totalSecs < 300) {
        iconEl.className = 'fa fa-bell countdown-icon countdown-icon-ring';
      } else {
        iconEl.className = 'fa fa-hourglass-half countdown-icon';
      }
    }

    bar.style.display = 'flex';
  });
}

async function checkAlarms() {
  if (!currentUserId) return;
  const now      = new Date();
  const hhmm     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dayName  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];
  const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
  const weekends = ['saturday','sunday'];

  const { data } = await db.from('alarms').select('*')
    .eq('user_id', currentUserId).eq('is_active', true);
  if (!data?.length) return;

  for (const alarm of data) {
    // ── Exact alarm time: ring in-app ─────────────────────────────
    if (alarm.time === hhmm) {
      if (ringActive) continue;
      const ringEl = document.getElementById('alarm-ring');
      if (ringEl && ringEl.style.display === 'flex') continue;
      const todayStr = today();
      let shouldRing = false;
      switch (alarm.repeat) {
        case 'none':     shouldRing = !alarm.date || alarm.date === todayStr; break;
        case 'daily':    shouldRing = true; break;
        case 'weekdays': shouldRing = weekdays.includes(dayName); break;
        case 'weekends': shouldRing = weekends.includes(dayName); break;
        case 'weekly':   shouldRing = alarm.date ? new Date(alarm.date+'T00:00:00').getDay()===now.getDay() : true; break;
      }
      if (shouldRing) ringAlarm(alarm);
      continue;
    }

    // ── 15 / 10 minute in-app reminder check ─────────────────────
    const alarmMs = getNextAlarmDate(alarm.time, alarm.date, alarm.repeat)?.getTime?.() || 0;
    if (!alarmMs) continue;
    const minsLeft = Math.round((alarmMs - now.getTime()) / 60000);
    if (minsLeft === 15 || minsLeft === 10) {
      showReminderBanner(alarm, minsLeft);
    }
  }
}

function ringAlarm(alarm) {
  ringActive = true; 
  ringAlarmId = alarm.id;
  ringAlarmRepeat = alarm.repeat || 'none';
  document.getElementById('ring-label').textContent = alarm.label;
  document.getElementById('ring-time').textContent  = fmt12(alarm.time);
  document.getElementById('alarm-ring').style.display = 'flex';
  playSound(alarm.sound, true);
  if (window.fireAlarmNotification) window.fireAlarmNotification(alarm);
}

// ── In-app reminder banner (shown 15/10 min before alarm) ─────────
function showReminderBanner(alarm, minsLeft) {
  const existingId = `reminder-banner-${alarm.id}-${minsLeft}`;
  if (document.getElementById(existingId)) return; // already shown

  const banner = document.createElement('div');
  banner.id = existingId;
  banner.style.cssText = `
    position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
    background:var(--surface2); border:2px solid var(--accent);
    border-radius:16px; padding:14px 18px; z-index:9000;
    max-width:480px; width:calc(100% - 32px);
    box-shadow:0 8px 40px rgba(0,0,0,0.6);
    display:flex; align-items:center; gap:14px;
    animation:reminderSlideUp .4s cubic-bezier(.22,1,.36,1);
    font-family:'DM Sans',sans-serif;`;

  banner.innerHTML = `
    <span style="font-size:2rem;flex-shrink:0">🔔</span>
    <div style="flex:1">
      <div style="font-weight:700;color:var(--accent);font-size:.95rem;margin-bottom:2px">
        Alarm in ${minsLeft} minutes
      </div>
      <div style="color:var(--text2);font-size:.82rem">"${escHtml(alarm.label)}" at ${fmt12(alarm.time)}</div>
    </div>
    <button onclick="this.parentElement.remove()" style="
      background:none;border:1px solid var(--border2);border-radius:8px;
      color:var(--text3);padding:6px 10px;cursor:pointer;font-size:.8rem;
      font-family:'DM Sans',sans-serif;white-space:nowrap;flex-shrink:0"
      type="button">Dismiss</button>`;

  // Inject animation keyframes once
  if (!document.getElementById('reminder-anim-style')) {
    const st = document.createElement('style');
    st.id = 'reminder-anim-style';
    st.textContent = `@keyframes reminderSlideUp {
      from { opacity:0; transform:translateX(-50%) translateY(40px); }
      to   { opacity:1; transform:translateX(-50%) translateY(0); }
    }`;
    document.head.appendChild(st);
  }

  document.body.appendChild(banner);
  // Auto-dismiss after 2 minutes
  setTimeout(() => { if (banner.parentElement) banner.remove(); }, 120000);
}

// Make globally accessible for sw integration
window.dismissAlarm = dismissAlarm;
window.snoozeAlarm = snoozeAlarm;

function dismissAlarm(isRemote = false) {
  const activeId = ringAlarmId;
  const repeat   = ringAlarmRepeat;
  
  ringActive = false; 
  ringAlarmId = null; 
  ringAlarmRepeat = 'none';
  
  stopSound();
  document.getElementById('alarm-ring').style.display = 'none';
  
  if (!isRemote && window.broadcastAction) {
    window.broadcastAction('DISMISS_ALARM');
  }

  if (isRemote) return; // Background/Remote dismissal only stops UI/Sound

  if ('serviceWorker' in navigator && navigator.serviceWorker.controller && activeId) {
    navigator.serviceWorker.controller.postMessage({ type:'CANCEL_ALARM_NOTIFS', data:{ alarmId: activeId } });
  }
  
  if ('Notification' in window) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(reg => reg.getNotifications().then(notifs => notifs.forEach(n => n.close())));
    });
  }
  
  // Bug fix: only disable if it's a one-time alarm
  if (activeId && repeat === 'none') {
    toggleAlarm(activeId, false);
  }
}

async function snoozeAlarm(isRemote = false) {
  const activeId = ringAlarmId;
  const labelText = document.getElementById('ring-label').textContent;
  
  if (!activeId) { dismissAlarm(isRemote); return; }
  
  if (!isRemote && window.broadcastAction) {
    window.broadcastAction('SNOOZE_ALARM');
  }

  // If remote, we just stop local ring. The initiator handles the DB part.
  if (isRemote) { 
    dismissAlarm(true);
    return;
  }

  const now = new Date();
  now.setMinutes(now.getMinutes() + 10);
  const tm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  // Clean label logic: avoid [Snoozed] [Snoozed]
  const cleanLabel = labelText.replace(/^\[Snoozed\]\s*/, '');

  const payload = { 
    user_id: currentUserId, 
    time: tm, 
    date: now.toISOString().split('T')[0], 
    label: `[Snoozed] ${cleanLabel}`, 
    repeat: 'none', 
    sound: selectedSound || 'beep', 
    is_active: true 
  };
  
  await db.from('alarms').insert(payload);

  // Also tell the SW to schedule the snooze notification for background
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'SNOOZE_ALARM',
      data: { alarmId: activeId, snoozeMs: now.getTime(), label: cleanLabel }
    });
  }

  toast('Alarm snoozed for 10 minutes!', 'info');
  loadAlarms();
  dismissAlarm();
}

// ═══════════════════════════════════════════════════════════════
//  TIMETABLE
// ═══════════════════════════════════════════════════════════════
function openTimetableModal(tt = null) {
  ttEditId = tt ? tt.id : null;
  document.getElementById('tt-type').value = tt?.tt_type || '';
  document.getElementById('modal-tt1').style.display = 'flex';
}

function goTTStep2() {
  const type = document.getElementById('tt-type').value.trim();
  if (!type) { toast('Please enter a timetable type.','error'); return; }
  document.getElementById('modal-tt1').style.display = 'none';
  document.getElementById('tt2-heading').innerHTML = `<i class="fa fa-calendar-alt" style="color:var(--accent)"></i> ${escHtml(type)}`;
  document.getElementById('tt-type-badge').innerHTML = `<strong>${escHtml(type)} Timetable</strong><br>Add your schedule rows below.`;
  if (ttEditId) {
    db.from('timetables').select('*').eq('id',ttEditId).single().then(({ data }) => {
      if (!data) return;
      if (data.columns) document.getElementById('tt-cols').value = data.columns.join(',');
      buildTTTable();
      if (data.rows) {
        const tbody = document.querySelector('#tt-table-wrap tbody');
        if (tbody) tbody.innerHTML = '';
        data.rows.forEach(row => addTTRow(row));
      }
    });
  } else {
    buildTTTable(); addTTRow(); addTTRow(); addTTRow();
  }
  document.getElementById('modal-tt2').style.display = 'flex';
}

function backToTT1() { closeModal('modal-tt2'); document.getElementById('modal-tt1').style.display='flex'; }

function buildTTTable() {
  const cols = document.getElementById('tt-cols').value.split(',').map(c=>c.trim()).filter(Boolean);
  if (!cols.length) { toast('Please enter column headers.','error'); return; }
  const wrap = document.getElementById('tt-table-wrap');
  const existingRows = wrap.querySelectorAll('tbody tr');
  const rowData = [];
  existingRows.forEach(tr => rowData.push(Array.from(tr.querySelectorAll('input')).map(i=>i.value)));
  wrap.innerHTML = `<table class="tt-table">
    <thead><tr>${cols.map(c=>`<th>${escHtml(c)}</th>`).join('')}<th style="width:36px"></th></tr></thead>
    <tbody></tbody></table>`;
  rowData.forEach(rd => addTTRow(rd));
}

function addTTRow(values = []) {
  const cols  = document.getElementById('tt-cols').value.split(',').map(c=>c.trim()).filter(Boolean);
  const tbody = document.querySelector('#tt-table-wrap tbody');
  if (!tbody) { toast('Please apply column headers first.','error'); return; }
  const tr = document.createElement('tr');
  tr.innerHTML = cols.map((_,i)=>`<td><input type="text" value="${escHtml(values[i]||'')}" placeholder="..."/></td>`).join('')
    + `<td><button class="tt-row-del" onclick="this.closest('tr').remove()" type="button"><i class="fa fa-times"></i></button></td>`;
  tbody.appendChild(tr);
}

async function saveTimetable() {
  const type  = document.getElementById('tt-type').value.trim();
  const cols  = document.getElementById('tt-cols').value.split(',').map(c=>c.trim()).filter(Boolean);
  const tbody = document.querySelector('#tt-table-wrap tbody');
  if (!tbody) { toast('Please build the table first.','error'); return; }
  const rows = Array.from(tbody.querySelectorAll('tr')).map(tr=>Array.from(tr.querySelectorAll('input')).map(i=>i.value)).filter(r=>r.some(c=>c.trim()));
  if (!type)        { toast('Timetable type is required.','error'); return; }
  if (!rows.length) { toast('Please add at least one row.','error'); return; }
  const payload = { user_id:currentUserId, tt_type:type, columns:cols, rows };
  let error;
  if (ttEditId) {
    ({error} = await db.from('timetables').update(payload).eq('id',ttEditId).eq('user_id',currentUserId));
  } else {
    ({error} = await db.from('timetables').insert(payload));
  }
  if (error) { toast('Error saving timetable: '+error.message,'error'); return; }
  toast(ttEditId?'Timetable updated!':'Timetable saved!','success');
  closeModal('modal-tt2'); loadTimetables();
}

async function loadTimetables() {
  const { data } = await db.from('timetables').select('*').eq('user_id',currentUserId).order('created_at',{ascending:false});
  renderTimetables(data||[]);
}

function renderTimetables(list) {
  const grid  = document.getElementById('timetable-grid');
  const empty = document.getElementById('tt-empty');
  grid.innerHTML = '';
  if (!list.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';
  list.forEach(tt => {
    const card = document.createElement('div');
    card.className = 'tt-card';
    card.innerHTML = `
      <div class="tt-card-title">${escHtml(tt.tt_type)}</div>
      <div class="tt-type-pill"><i class="fa fa-table"></i> Timetable</div>
      <div class="tt-card-meta">${tt.rows?.length||0} rows · ${tt.columns?.length||0} columns</div>
      <div class="tt-card-actions">
        <button class="icon-btn" onclick="viewTimetable('${tt.id}')" type="button"><i class="fa fa-eye"></i> View</button>
        <button class="icon-btn" onclick="shareTimetable('${tt.id}')" type="button"><i class="fa fa-share-alt"></i> Share</button>
        <button class="icon-btn" onclick="editTimetable('${tt.id}')" type="button"><i class="fa fa-edit"></i> Edit</button>
        <button class="icon-btn del" onclick="confirmDelete('timetable','${tt.id}','${escHtml(tt.tt_type)}')" type="button"><i class="fa fa-trash"></i></button>
      </div>`;
    grid.appendChild(card);
  });
}

async function viewTimetable(id) {
  const { data:tt } = await db.from('timetables').select('*').eq('id',id).single();
  if (!tt) return;
  document.getElementById('ttv-heading').innerHTML = `<i class="fa fa-calendar-alt" style="color:var(--accent)"></i> ${escHtml(tt.tt_type)}`;
  document.getElementById('ttv-body').innerHTML = `<div class="tt-table-wrap">
    <table class="tt-table">
      <thead><tr>${tt.columns.map(c=>`<th>${escHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${(tt.rows||[]).map(row=>`<tr>${row.map(c=>`<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  openModal('modal-tt-view');
}

async function editTimetable(id) {
  const { data:tt } = await db.from('timetables').select('*').eq('id',id).single();
  if (!tt) return;
  ttEditId = id;
  document.getElementById('tt-type').value = tt.tt_type;
  goTTStep2();
}

// ═══════════════════════════════════════════════════════════════
//  FILE MANAGER
// ═══════════════════════════════════════════════════════════════
function openFolderModal(folder = null) {
  editingFolderId = folder ? folder.id : null;
  document.getElementById('folder-modal-title').innerHTML =
    folder ? '<i class="fa fa-edit"></i> Rename Folder' : '<i class="fa fa-folder-plus"></i> New Folder';
  document.getElementById('folder-name').value = folder?.name || '';
  document.getElementById('folder-parent-id').value = '';
  openModal('modal-folder');
}

function openSubFolderModal() {
  editingFolderId = null;
  document.getElementById('folder-modal-title').innerHTML = '<i class="fa fa-folder-plus"></i> New Folder Inside';
  document.getElementById('folder-name').value = '';
  document.getElementById('folder-parent-id').value = currentFolderId;
  openModal('modal-folder');
}

async function saveFolder() {
  const name     = document.getElementById('folder-name').value.trim();
  const parentId = document.getElementById('folder-parent-id').value || null;
  if (!name) { toast('Folder name is required.','error'); return; }
  let error;
  if (editingFolderId) {
    ({error} = await db.from('folders').update({ name }).eq('id',editingFolderId).eq('user_id',currentUserId));
    toast('Folder renamed!','success');
  } else {
    ({error} = await db.from('folders').insert({ user_id:currentUserId, name, parent_id:parentId }));
    toast('Folder created!','success');
  }
  if (error) { toast('Error saving folder: '+error.message,'error'); return; }
  closeModal('modal-folder');
  if (parentId) loadSubFolders(parentId);
  else loadFolders();
}

async function loadFolders() {
  currentFolderId = null; currentParentFolderId = null;
  document.getElementById('folders-grid').style.display = 'grid';
  document.getElementById('files-grid').style.display   = 'none';
  document.getElementById('breadcrumb').style.display   = 'none';
  document.getElementById('new-folder-btn').style.display    = 'flex';
  document.getElementById('new-subfolder-btn').style.display = 'none';
  document.getElementById('upload-btn').style.display        = 'none';

  const { data } = await db.from('folders').select('*')
    .eq('user_id',currentUserId).is('parent_id',null).order('created_at');
  const grid  = document.getElementById('folders-grid');
  const empty = document.getElementById('files-empty');
  grid.innerHTML = '';
  if (!data?.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';

  for (const f of data) {
    const { count } = await db.from('files').select('*',{count:'exact',head:true}).eq('folder_id',f.id).eq('user_id',currentUserId);
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.dataset.id = f.id;
    card.innerHTML = `
      <div class="folder-card-actions">
        <button class="icon-btn edit-folder" title="Rename" type="button"><i class="fa fa-edit"></i></button>
        <button class="icon-btn del" onclick="event.stopPropagation();confirmDelete('folder','${f.id}','${escHtml(f.name)}')" title="Delete" type="button"><i class="fa fa-trash"></i></button>
      </div>
      <i class="fa fa-folder"></i>
      <div class="fc-name">${escHtml(f.name)}</div>
      <div class="fc-count">${count||0} file${count===1?'':'s'}</div>`;
    
    card.addEventListener('click', () => openFolder(f));
    card.querySelector('.edit-folder').addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderModal(f);
    });
    grid.appendChild(card);
  }
}

function openFolder(folder) {
  currentParentFolderId = null; currentParentFolderName = '';
  currentFolderId = folder.id; currentFolderName = folder.name;
  document.getElementById('folders-grid').style.display = 'none';
  document.getElementById('files-grid').style.display   = 'grid';
  document.getElementById('breadcrumb').style.display   = 'flex';
  document.getElementById('bc-folder').textContent      = folder.name;
  document.getElementById('bc-arrow2').style.display    = 'none';
  document.getElementById('bc-subfolder').style.display = 'none';
  document.getElementById('new-folder-btn').style.display    = 'none';
  document.getElementById('new-subfolder-btn').style.display = 'flex';
  document.getElementById('upload-btn').style.display        = 'flex';
  document.getElementById('files-empty').style.display       = 'none';
  loadFiles(folder.id); loadSubFolders(folder.id);
}

function openSubFolder(folder) {
  currentParentFolderId = currentFolderId; currentParentFolderName = currentFolderName;
  currentFolderId = folder.id; currentFolderName = folder.name;
  document.getElementById('bc-arrow2').style.display    = 'inline';
  document.getElementById('bc-subfolder').style.display = 'inline';
  document.getElementById('bc-subfolder').textContent   = folder.name;
  document.getElementById('files-empty').style.display  = 'none';
  loadFiles(folder.id); loadSubFolders(folder.id);
}

function goToParentFolder() {
  if (!currentParentFolderId) return;
  openFolder({ id:currentParentFolderId, name:currentParentFolderName });
}

function goToFolders() {
  currentParentFolderId = null; currentParentFolderName = ''; loadFolders();
}

async function loadFiles(folderId) {
  const { data } = await db.from('files').select('*').eq('folder_id',folderId).eq('user_id',currentUserId).order('created_at');
  renderFiles(data||[]);
}

async function loadSubFolders(parentId) {
  const { data } = await db.from('folders').select('*').eq('user_id',currentUserId).eq('parent_id',parentId).order('created_at');
  const grid = document.getElementById('files-grid');
  const existing = document.getElementById('subfolder-section');
  if (existing) existing.remove();
  if (!data?.length) return;
  const section = document.createElement('div');
  section.id = 'subfolder-section';
  section.style.cssText = 'margin-bottom:20px';
  section.innerHTML = `
    <div style="font-size:.72rem;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">
      <i class="fa fa-folder" style="color:var(--accent);margin-right:6px"></i>Folders inside this folder
    </div>
    <div class="folders-grid" id="subfolder-grid"></div>`;
  grid.parentNode.insertBefore(section, grid);
  const subGrid = document.getElementById('subfolder-grid');
  data.forEach(f => {
    const card = document.createElement('div');
    card.className = 'folder-card';
    card.innerHTML = `
      <div class="folder-card-actions">
        <button class="icon-btn edit-folder" title="Rename" type="button"><i class="fa fa-edit"></i></button>
        <button class="icon-btn del" onclick="event.stopPropagation();confirmDelete('folder','${f.id}','${escHtml(f.name)}')" title="Delete" type="button"><i class="fa fa-trash"></i></button>
      </div>
      <i class="fa fa-folder"></i>
      <div class="fc-name">${escHtml(f.name)}</div>`;
    
    card.addEventListener('click', () => openSubFolder(f));
    card.querySelector('.edit-folder').addEventListener('click', (e) => {
      e.stopPropagation();
      openFolderModal(f);
    });
    subGrid.appendChild(card);
  });
}

function renderFiles(files) {
  const grid = document.getElementById('files-grid');
  grid.innerHTML = '';
  if (!files.length) {
    grid.innerHTML = '<div style="color:var(--text3);font-size:.85rem;padding:20px">No files yet. Click Upload to add files.</div>';
    return;
  }
  files.forEach(f => {
    const icon = fileIcon(f.name);
    const card = document.createElement('div');
    card.className = 'file-card';
    card.innerHTML = `
      ${isImage(f.name)&&f.url?`<img src="${f.url}" class="file-thumb" alt="${escHtml(f.name)}" loading="lazy"/>`:`<i class="fa ${icon} fc-icon"></i>`}
      <div class="fc-name">${escHtml(f.name)}</div>
      <div class="fc-size">${fileSize(f.size||0)}</div>
      <div class="file-actions">
        <a href="${f.url}" target="_blank" rel="noopener noreferrer" class="icon-btn" title="Open"><i class="fa fa-external-link-alt"></i></a>
        <button class="icon-btn" onclick="shareFileCard({name:'${escHtml(f.name).replace(/'/g,"\\'")}', size:${f.size||0}, url:'${f.url}', mime:'${f.mime}'})" title="Share"><i class="fa fa-share-alt"></i></button>
        <button class="icon-btn del" onclick="confirmDelete('file','${f.id}','${escHtml(f.name)}')" title="Delete" type="button"><i class="fa fa-trash"></i></button>
      </div>`;
    grid.appendChild(card);
  });
}

async function handleUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length || !currentFolderId) return;

  const total = files.length;
  let completed = 0;

  showUploadProgress(true, 0, `Preparing ${total} file(s)...`);

  const uploadPromises = files.map(async (file) => {
    try {
      let finalFile = file;
      if (file.type.startsWith('image/')) {
        finalFile = await compressImage(file, 1600, 0.8);
      }

      const path = `${currentUserId}/${currentFolderId}/${Date.now()}_${file.name}`;
      const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(path, finalFile, { 
        upsert: true,
        onUploadProgress: (p) => {
          // This is per-file, but we'll approximate batch progress
          // More advanced would track all active uploads
          showUploadProgress(true, (completed / total) * 100, `Uploading batch... (${completed}/${total})`, p.loaded, p.total);
        }
      });
      
      if (uploadErr) throw uploadErr;

      const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      await db.from('files').insert({
        user_id: currentUserId,
        folder_id: currentFolderId,
        name: file.name,
        path,
        url: urlData.publicUrl,
        size: finalFile.size,
        mime: file.type
      });

      completed++;
      const pct = (completed / total) * 100;
      showUploadProgress(true, pct, `Uploading... (${completed}/${total})`);
    } catch (err) {
      console.error('Upload error for', file.name, err);
      toast(`Failed: ${file.name}`, 'error');
    }
  });

  await Promise.all(uploadPromises);
  
  showUploadProgress(true, 100, 'All uploads complete!');
  setTimeout(() => showUploadProgress(false), 1500);
  
  event.target.value = '';
  loadFiles(currentFolderId);
}

// ═══════════════════════════════════════════════════════════════
//  PLANS & ACTIVITIES
// ═══════════════════════════════════════════════════════════════
function openPlanModal(plan = null) {
  editingPlanId = plan ? plan.id : null;
  document.getElementById('plan-modal-title').innerHTML =
    plan ? '<i class="fa fa-edit"></i> Edit Plan' : '<i class="fa fa-tasks"></i> New Plan';
  document.getElementById('p-title').value         = plan?.title         || '';
  document.getElementById('p-duration').value      = plan?.duration      || 'daily';
  document.getElementById('p-start').value         = plan?.start_date    || today();
  document.getElementById('p-end').value           = plan?.end_date      || '';
  document.getElementById('p-reminder-time').value = plan?.reminder_time || '08:00';
  document.getElementById('p-reminder-days').value = plan?.reminder_days || 'daily';
  const container = document.getElementById('activities-container');
  container.innerHTML = ''; activityCounter = 0;
  if (plan?.activities?.length) plan.activities.forEach(a => addActivityInput(a.text));
  else { addActivityInput(); addActivityInput(); }
  openModal('modal-plan');
}

function addActivityInput(value = '') {
  const id  = ++activityCounter;
  const row = document.createElement('div');
  row.className = 'activity-input-row'; row.id = `act-row-${id}`;
  row.innerHTML = `
    <input type="text" placeholder="Enter activity or task..." value="${escHtml(value)}"/>
    <button class="rm-act-btn" onclick="document.getElementById('act-row-${id}').remove()" type="button"><i class="fa fa-minus"></i></button>`;
  document.getElementById('activities-container').appendChild(row);
}

async function savePlan() {
  const title        = document.getElementById('p-title').value.trim();
  const duration     = document.getElementById('p-duration').value;
  const start        = document.getElementById('p-start').value;
  const end          = document.getElementById('p-end').value;
  const reminderTime = document.getElementById('p-reminder-time').value || '08:00';
  const reminderDays = document.getElementById('p-reminder-days').value || 'daily';
  if (!title) { toast('Plan title is required.','error'); return; }
  if (!start) { toast('Start date is required.','error'); return; }
  if (!end)   { toast('End date is required.','error'); return; }
  if (end < start) { toast('End date must be after start date.','error'); return; }
  const inputs     = document.querySelectorAll('#activities-container input');
  const activities = Array.from(inputs).map(i=>i.value.trim()).filter(Boolean);
  if (!activities.length) { toast('Add at least one activity.','error'); return; }
  const payload = {
    user_id:currentUserId, title, duration,
    start_date:start, end_date:end,
    activities:activities.map(text=>({text,status:null})),
    reminder_time:reminderTime, reminder_days:reminderDays,
  };
  let error;
  if (editingPlanId) {
    ({error} = await db.from('plans').update(payload).eq('id',editingPlanId).eq('user_id',currentUserId));
  } else {
    ({error} = await db.from('plans').insert(payload));
  }
  if (error) { toast('Error saving plan: '+error.message,'error'); return; }
  toast(editingPlanId?'Plan updated!':'Plan created!','success');
  closeModal('modal-plan'); loadPlans();
}

async function loadPlans() {
  const { data } = await db.from('plans').select('*').eq('user_id',currentUserId).order('created_at',{ascending:false});
  allPlans = data||[];
  renderPlans(allPlans);
  if (window.pushPlansToSW) window.pushPlansToSW(allPlans);
  schedulePlanReminders(allPlans);
}

let allPlans = [];

function filterPlans(type, btn) {
  planFilter = type;
  document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPlans(type==='all' ? allPlans : allPlans.filter(p=>p.duration===type));
}

function renderPlans(plans) {
  const list  = document.getElementById('plans-list');
  const empty = document.getElementById('plans-empty');
  list.innerHTML = '';
  if (!plans.length) { empty.style.display='block'; return; }
  empty.style.display = 'none';
  plans.forEach(plan => {
    const activities = plan.activities||[];
    const total      = activities.length;
    const completed  = activities.filter(a=>a.status==='done').length;
    const pct        = total ? Math.round((completed/total)*100) : 0;
    const incomplete = activities.filter(a=>a.status!=='done');
    const card = document.createElement('div');
    card.className = 'plan-card';
    card.innerHTML = `
      <div class="plan-header" id="ph-${plan.id}">
        <div class="plan-header-left">
          <div class="plan-title-text">${escHtml(plan.title)}</div>
          <span class="plan-duration-pill pill-${plan.duration}">${getDurationLabel(plan.duration)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:.78rem;color:var(--text2)">${fmtDate(plan.start_date)} – ${fmtDate(plan.end_date)}</span>
          <div class="plan-card-actions" onclick="event.stopPropagation()">
            <button class="icon-btn" onclick="exportComponentAsImage('pb-${plan.id}', 'Plan_${plan.id}', 'Plan')" type="button"><i class="fa fa-share-alt"></i></button>
            <button class="icon-btn edit-plan" type="button"><i class="fa fa-edit"></i></button>
            <button class="icon-btn del" onclick="confirmDelete('plan','${plan.id}','${escHtml(plan.title)}')" type="button"><i class="fa fa-trash"></i></button>
          </div>
          <i class="fa fa-chevron-down" style="color:var(--text3);font-size:.8rem"></i>
        </div>
      </div>
      <div class="plan-progress-bar-wrap">
        <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${pct}%"></div></div>
        <div class="plan-progress-label"><span>${completed} of ${total} completed</span><strong>${pct}% Done</strong></div>
      </div>
      <div class="plan-body" id="pb-${plan.id}" style="display:none">
        <div id="acts-${plan.id}">
          ${activities.map((a,i)=>`
            <div class="activity-row" id="ar-${plan.id}-${i}">
              <div class="activity-text">${escHtml(a.text)}</div>
              <div class="status-btns">
                <button class="status-btn green-btn${a.status==='done'?' active':''}" onclick="setActivityStatus('${plan.id}',${i},'done')" title="Completed" type="button"><i class="fa fa-check"></i></button>
                <button class="status-btn red-btn${a.status==='not-done'?' active':''}" onclick="setActivityStatus('${plan.id}',${i},'not-done')" title="Not Completed" type="button"><i class="fa fa-circle"></i></button>
              </div>
            </div>`).join('')}
        </div>
        <div class="plan-summary">
          <h4><i class="fa fa-chart-bar"></i> Summary</h4>
          <div class="summary-stat"><span class="lbl">Total Activities</span><span class="val">${total}</span></div>
          <div class="summary-stat"><span class="lbl">Completed</span><span class="val val-green">${completed} (${pct}%)</span></div>
          <div class="summary-stat"><span class="lbl">Not Completed</span><span class="val val-red">${total-completed}</span></div>
          ${incomplete.length?`
            <div class="incomplete-list">
              <p style="font-size:.75rem;color:var(--text2);margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px">Pending Activities</p>
              ${incomplete.map(a=>`<div class="incomplete-item"><i class="fa fa-times-circle"></i> ${escHtml(a.text)}</div>`).join('')}
            </div>`:''}
        </div>
      </div>`;
    card.querySelector(`#ph-${plan.id}`).addEventListener('click', () => togglePlanBody(`pb-${plan.id}`));
    card.querySelector('.edit-plan').addEventListener('click', (e) => {
      e.stopPropagation();
      openPlanModal(plan);
    });
    list.appendChild(card);
  });
}

function togglePlanBody(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display==='none' ? 'block' : 'none';
}

async function setActivityStatus(planId, idx, status) {
  const plan = allPlans.find(p=>p.id===planId);
  if (!plan) return;
  const activities = [...plan.activities];
  activities[idx] = { ...activities[idx], status: activities[idx].status===status ? null : status };
  const { error } = await db.from('plans').update({ activities }).eq('id',planId).eq('user_id',currentUserId);
  if (error) { toast('Could not update activity.','error'); return; }
  plan.activities = activities;
  renderPlans(planFilter==='all' ? allPlans : allPlans.filter(p=>p.duration===planFilter));
}

// ═══════════════════════════════════════════════════════════════
//  PLAN REMINDERS
// ═══════════════════════════════════════════════════════════════
function schedulePlanReminders(plans) {
  if (planReminderInterval) clearInterval(planReminderInterval);
  planReminderInterval = setInterval(() => checkPlanRemindersDue(plans), 60000);
  checkPlanRemindersDue(plans);
}

function checkPlanRemindersDue(plans) {
  if (!plans?.length) return;
  const now      = new Date();
  const hhmm     = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const dayName  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];
  const todayStr = today();
  const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
  const weekends = ['saturday','sunday'];
  plans.forEach(plan => {
    if (plan.end_date < todayStr) return;
    const incomplete = (plan.activities||[]).filter(a=>a.status!=='done');
    if (!incomplete.length) return;
    const reminderTime = (plan.reminder_time||'08:00').substring(0,5);
    if (hhmm !== reminderTime) return;
    const reminderDays = plan.reminder_days || 'daily';
    let shouldRemind = false;
    switch (reminderDays) {
      case 'daily':    shouldRemind = true; break;
      case 'weekdays': shouldRemind = weekdays.includes(dayName); break;
      case 'weekends': shouldRemind = weekends.includes(dayName); break;
      case 'once':     shouldRemind = plan.start_date === todayStr; break;
    }
    if (!shouldRemind) return;
    const shownKey = `plan-notif-${plan.id}-${todayStr}-${hhmm}`;
    if (localStorage.getItem(shownKey)) return;
    localStorage.setItem(shownKey, '1');
    showPlanReminderNotification(plan, incomplete);
  });
}

function showPlanReminderNotification(plan, incomplete) {
  showPlanReminderPopup(plan, incomplete);
  if ('Notification' in window && Notification.permission==='granted') {
    const body = incomplete.length<=3
      ? `Pending: ${incomplete.map(a=>a.text).join(', ')}`
      : `You have ${incomplete.length} pending activities.`;
    const notif = new Notification(`📋 ${plan.title} — Reminder`, {
      body, icon:'./WhatsApp Image 2026-04-07 at 20.53.13.jpeg', tag:`plan-reminder-${plan.id}`, requireInteraction:false,
    });
    notif.onclick = () => { window.focus(); showSection('plans'); notif.close(); };
    setTimeout(() => notif.close(), 8000);
  }
}

function showPlanReminderPopup(plan, incomplete) {
  const existing = document.getElementById('plan-reminder-popup');
  if (existing) existing.remove();
  const pct = plan.activities?.length
    ? Math.round(((plan.activities.length-incomplete.length)/plan.activities.length)*100) : 0;
  const popup = document.createElement('div');
  popup.id = 'plan-reminder-popup';
  popup.style.cssText = `
    position:fixed;top:80px;right:20px;background:var(--surface);
    border:1px solid var(--accent);border-radius:16px;padding:18px 20px;
    z-index:8000;max-width:320px;width:calc(100% - 40px);
    box-shadow:0 8px 40px rgba(0,0,0,0.6);animation:planPopupIn .4s ease;`;
  popup.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px">
      <div style="font-size:1.8rem;flex-shrink:0">📋</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;color:var(--text);font-size:.95rem;margin-bottom:3px">${escHtml(plan.title)}</div>
        <div style="font-size:.78rem;color:var(--text2);margin-bottom:10px">${incomplete.length} activit${incomplete.length===1?'y':'ies'} pending · ${pct}% done</div>
        <div style="background:var(--surface3);border-radius:99px;height:6px;overflow:hidden;margin-bottom:10px">
          <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--green),#51e98c);border-radius:99px"></div>
        </div>
        <div style="max-height:80px;overflow-y:auto;margin-bottom:12px">
          ${incomplete.slice(0,4).map(a=>`
            <div style="font-size:.78rem;color:var(--text2);padding:3px 0;display:flex;align-items:center;gap:6px">
              <i class="fa fa-circle" style="font-size:.4rem;color:var(--accent)"></i>${escHtml(a.text)}
            </div>`).join('')}
          ${incomplete.length>4?`<div style="font-size:.75rem;color:var(--text3)">+${incomplete.length-4} more...</div>`:''}
        </div>
        <div style="display:flex;gap:8px">
          <button onclick="showSection('plans');document.getElementById('plan-reminder-popup').remove()" type="button" style="
            flex:1;background:var(--accent);border:none;border-radius:9px;color:#000;
            padding:8px;cursor:pointer;font-size:.82rem;font-weight:700;font-family:'DM Sans',sans-serif;">
            <i class="fa fa-tasks"></i> View Plans
          </button>
          <button onclick="document.getElementById('plan-reminder-popup').remove()" type="button" style="
            background:var(--surface2);border:1px solid var(--border2);border-radius:9px;
            color:var(--text2);padding:8px 12px;cursor:pointer;font-size:.82rem;font-family:'DM Sans',sans-serif;">
            Dismiss
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(() => {
    const p = document.getElementById('plan-reminder-popup');
    if (p) { p.style.animation='planPopupOut .3s ease forwards'; setTimeout(()=>p.remove(),300); }
  }, 15000);
}

// ═══════════════════════════════════════════════════════════════
//  CONFIRM DELETE
// ═══════════════════════════════════════════════════════════════
function confirmDelete(type, id, name) {
  const msgs = {
    alarm:     `Delete alarm "${name}"? This cannot be undone.`,
    timetable: `Delete timetable "${name}"? All data will be lost.`,
    folder:    `Delete folder "${name}" and all its files?`,
    file:      `Delete file "${name}"? This cannot be undone.`,
    plan:      `Delete plan "${name}" and all activities?`,
  };
  document.getElementById('confirm-text').textContent = msgs[type] || 'Are you sure?';
  const confirmBtn = document.getElementById('confirm-ok');
  confirmBtn.innerHTML = '<i class="fa fa-trash"></i> Delete';
  openModal('modal-confirm');
  confirmBtn.onclick = async () => {
    closeModal('modal-confirm');
    await deleteItem(type, id);
  };
}

async function deleteItem(type, id) {
  const handlers = {
    alarm: async () => {
      await db.from('alarms').delete().eq('id',id).eq('user_id',currentUserId);
      toast('Alarm deleted.'); loadAlarms();
    },
    timetable: async () => {
      await db.from('timetables').delete().eq('id',id).eq('user_id',currentUserId);
      toast('Timetable deleted.'); loadTimetables();
    },
    folder: async () => {
      const { data:files } = await db.from('files').select('path').eq('folder_id',id).eq('user_id',currentUserId);
      for (const f of files||[]) await db.storage.from(STORAGE_BUCKET).remove([f.path]);
      await db.from('files').delete().eq('folder_id',id).eq('user_id',currentUserId);
      await db.from('folders').delete().eq('id',id).eq('user_id',currentUserId);
      toast('Folder deleted.'); loadFolders();
    },
    file: async () => {
      const { data:file } = await db.from('files').select('path').eq('id',id).single();
      if (file?.path) await db.storage.from(STORAGE_BUCKET).remove([file.path]);
      await db.from('files').delete().eq('id',id).eq('user_id',currentUserId);
      toast('File deleted.'); if (currentFolderId) loadFiles(currentFolderId);
    },
    plan: async () => {
      await db.from('plans').delete().eq('id',id).eq('user_id',currentUserId);
      toast('Plan deleted.'); loadPlans();
    },
  };
  if (handlers[type]) await handlers[type]();
}

// ═══════════════════════════════════════════════════════════════
//  NOTIFICATION PANEL
// ═══════════════════════════════════════════════════════════════
function toggleNotifPanel() {
  const panel = document.getElementById('notif-panel');
  if (!panel) return;
  const isOpen = panel.style.display === 'flex';
  panel.style.display = isOpen ? 'none' : 'flex';
  if (!isOpen && window.loadNotifications) loadNotifications();
}

document.addEventListener('click', e => {
  const panel = document.getElementById('notif-panel');
  const bell  = document.querySelector('.notif-bell-btn');
  if (panel && bell && !panel.contains(e.target) && !bell.contains(e.target)) {
    panel.style.display = 'none';
  }
});

window.startSubscription = function() {
  closeModal('modal-paywall');
  toast('Payment coming soon! Contact admin to subscribe.', 'info');
};

// ═══════════════════════════════════════════════════════════════
//  BOOTSTRAP
// ═══════════════════════════════════════════════════════════════
(async () => {
  const hideSplash = () => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 500);
    }
  };

  try {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      document.getElementById('auth-screen').style.display = 'none';
      await initApp(session.user);
    } else {
      document.getElementById('auth-screen').style.display = 'flex';
    }
  } catch(e) {
    console.error('Session check failed:', e);
    document.getElementById('auth-screen').style.display = 'flex';
  } finally {
    hideSplash();
  }

  db.auth.onAuthStateChange(async (event, session) => {
    console.log('[Auth]', event, session?.user?.email);

    // Handle all events that mean "user is logged in"
    if (
      (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') &&
      session?.user &&
      !currentUser
    ) {
      document.getElementById('auth-screen').style.display = 'none';
      await initApp(session.user);

      // Clean the URL hash after successful OAuth token pickup
      const h = window.location.hash || '';
      if (h.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }

    if (event === 'SIGNED_OUT') {
      currentUser = null;
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-screen').style.display = 'flex';
    }
  });

  // Handle Capacitor deep links (when the app is opened via a custom URL scheme)
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    const { App } = window.Capacitor.Plugins;
    App.addListener('appUrlOpen', async (data) => {
      console.log('[Capacitor] App opened with URL:', data.url);
      try {
        if (data.url) {
          const urlObj = new URL(data.url);
          const hashFragment = urlObj.hash;
          if (hashFragment && hashFragment.includes('access_token')) {
            const params = new URLSearchParams(hashFragment.substring(1));
            const access_token = params.get('access_token');
            const refresh_token = params.get('refresh_token');

            if (access_token && refresh_token) {
              showAuthMsg('Completing sign-in…', 'info');
              const { error } = await db.auth.setSession({
                access_token,
                refresh_token
              });
              if (error) {
                console.error('[Capacitor Auth] setSession error:', error);
                showAuthMsg('Error completing sign-in: ' + error.message);
              } else {
                closeAuthMsg();
              }
            }
          }
        }
      } catch (err) {
        console.error('[Capacitor Auth] Error handling appUrlOpen:', err);
      }
    });
  }

  const pStartEl = document.getElementById('p-start');
  if (pStartEl) pStartEl.value = today();
})();

// ═══════════════════════════════════════════════════════════════
//  FOCUS TIMER ENGINE
// ═══════════════════════════════════════════════════════════════
let focusInterval       = null;
let focusSecondsLeft    = 1500; // default 25m
let focusTotalSeconds   = 1500;
let focusIsRunning      = false;
let focusSessionsToday  = 0;
let focusTotalSecs      = 0;    // total focused seconds (accurate, from DB)
let focusCompletionSound = 'chime';

// ── Persist & Restore Timer State ───────────────────────────
const FOCUS_KEY = 'plantrack_focus_state';

function saveFocusState() {
  const state = {
    secondsLeft:     focusSecondsLeft,
    totalSeconds:    focusTotalSeconds,
    isRunning:       focusIsRunning,
    sessionsToday:   focusSessionsToday,
    focusTotalSecs:  focusTotalSecs,
    completionSound: focusCompletionSound,
    savedAt:         Date.now(),
    customH: parseInt(document.getElementById('custom-timer-hours')?.value) || 0,
    customM: parseInt(document.getElementById('custom-timer-mins')?.value)  || 0,
    customS: parseInt(document.getElementById('custom-timer-secs')?.value)  || 0,
  };
  try { localStorage.setItem(FOCUS_KEY, JSON.stringify(state)); } catch(e) {}
}

function restoreFocusState() {
  try {
    const raw = localStorage.getItem(FOCUS_KEY);
    if (!raw) return;
    const state = JSON.parse(raw);

    focusTotalSeconds    = state.totalSeconds    || 1500;
    focusSessionsToday   = state.sessionsToday   || 0;
    focusTotalSecs       = state.focusTotalSecs  || 0;
    focusCompletionSound = state.completionSound || 'chime';

    // If it was running when they left, deduct elapsed time
    if (state.isRunning && state.savedAt) {
      const elapsed = Math.floor((Date.now() - state.savedAt) / 1000);
      focusSecondsLeft = Math.max(0, (state.secondsLeft || focusTotalSeconds) - elapsed);
    } else {
      focusSecondsLeft = state.secondsLeft || focusTotalSeconds;
    }

    // Restore custom input fields
    const hEl = document.getElementById('custom-timer-hours');
    const mEl = document.getElementById('custom-timer-mins');
    const sEl = document.getElementById('custom-timer-secs');
    if (hEl) hEl.value = state.customH || 0;
    if (mEl) mEl.value = state.customM || Math.floor(focusTotalSeconds / 60);
    if (sEl) sEl.value = state.customS || 0;

    // If timer was running and still has time, auto-resume
    if (state.isRunning && focusSecondsLeft > 0) {
      // Small delay to let DOM settle before starting interval
      setTimeout(() => {
        focusIsRunning = true;
        const btn = document.getElementById('timer-toggle-btn');
        const container = document.querySelector('.timer-container');
        if (btn) { btn.innerHTML = '<i class="fa fa-pause"></i> Pause Focus'; btn.className = 'btn-cancel'; }
        if (container) container.classList.add('active');
        focusInterval = setInterval(() => {
          focusSecondsLeft--;
          updateFocusUI();
          saveFocusState();
          if (focusSecondsLeft <= 0) completeFocusSession();
        }, 1000);
        toast('⏱ Timer restored — still running!', 'info');
      }, 600);
    } else if (state.isRunning && focusSecondsLeft <= 0) {
      // Timer finished while away — complete session
      setTimeout(() => completeFocusSession(), 600);
    }

  } catch(e) {}
}

function clearFocusState() {
  try { localStorage.removeItem(FOCUS_KEY); } catch(e) {}
}

function buildTimerSoundPicker() {
  const picker = document.getElementById('timer-sound-picker');
  if (!picker) return;

  const builtIn = SOUNDS.map(s => `
    <div class="timer-sound-item ${focusCompletionSound === s.id ? 'selected' : ''}"
         id="tsi-${s.id}" onclick="selectTimerSound('${s.id}')">
      <span>${s.emoji}</span>
      <span class="timer-sound-name">${escHtml(s.name)}</span>
      <button class="sound-preview-btn" onclick="event.stopPropagation();previewSound('${s.id}')" type="button" title="Preview">
        <i class="fa fa-play"></i>
      </button>
    </div>`).join('');

  const userHtml = userSounds.length ? userSounds.map(s => `
    <div class="timer-sound-item ${focusCompletionSound === s.id ? 'selected' : ''}"
         id="tsi-${s.id}" onclick="selectTimerSound('${s.id}')">
      <span>🎵</span>
      <span class="timer-sound-name">${escHtml(s.name)}</span>
      <button class="sound-preview-btn" onclick="event.stopPropagation();previewSound('${s.id}')" type="button" title="Preview">
        <i class="fa fa-play"></i>
      </button>
      <button class="sound-preview-btn" onclick="event.stopPropagation();deleteTimerSound('${s.id.replace('user-','')}','${escHtml(s.name)}')" type="button" title="Delete" style="color:var(--red)">
        <i class="fa fa-trash"></i>
      </button>
    </div>`).join('') : `<div class="timer-no-music">No music uploaded yet — use the Upload button above!</div>`;

  picker.innerHTML = `
    <div class="timer-sound-section-label">🎵 Built-in Sounds</div>
    ${builtIn}
    <div class="timer-sound-section-label" style="margin-top:8px">🎶 My Music</div>
    ${userHtml}`;
}

function selectTimerSound(id) {
  focusCompletionSound = id;
  document.querySelectorAll('.timer-sound-item').forEach(el => el.classList.remove('selected'));
  const el = document.getElementById(`tsi-${id}`);
  if (el) el.classList.add('selected');
  saveFocusState();
}

async function uploadTimerMusic(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('audio/')) {
    toast('Please upload an audio file (MP3, WAV, OGG, M4A etc)', 'error');
    event.target.value = ''; return;
  }

  showUploadProgress(true, 20, 'Uploading music...');
  const path = `${currentUserId}/sounds/${Date.now()}_${file.name}`;
  const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, {
    upsert: true,
    onUploadProgress: (p) => {
      const pct = 20 + (p.loaded / p.total) * 70;
      showUploadProgress(true, pct, 'Uploading music...', p.loaded, p.total);
    }
  });

  if (uploadErr) {
    showUploadProgress(false);
    toast('Upload failed: ' + uploadErr.message, 'error');
    event.target.value = ''; return;
  }

  showUploadProgress(true, 95, 'Saving to library...');
  const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const { error: dbErr } = await db.from('user_sounds').insert({
    user_id: currentUserId,
    name: file.name.replace(/\.[^/.]+$/, ''),
    path, url: urlData.publicUrl, size: file.size,
  });

  showUploadProgress(false);
  if (dbErr) { toast('Could not save sound: ' + dbErr.message, 'error'); event.target.value = ''; return; }

  toast(`✅ "${file.name}" added! You can now select it as your completion sound.`, 'success');
  event.target.value = '';
  await loadUserSounds();
  buildTimerSoundPicker();
  buildSoundGrid(); // also refresh alarm sound grid
}

async function deleteTimerSound(soundId, soundName) {
  if (!confirm(`Remove "${soundName}" from your library?`)) return;
  const { data: sound } = await db.from('user_sounds').select('path').eq('id', soundId).single();
  if (sound?.path) await db.storage.from(STORAGE_BUCKET).remove([sound.path]);
  await db.from('user_sounds').delete().eq('id', soundId).eq('user_id', currentUserId);
  if (focusCompletionSound === `user-${soundId}`) focusCompletionSound = 'chime';
  toast(`"${soundName}" removed.`, 'info');
  await loadUserSounds();
  buildTimerSoundPicker();
  buildSoundGrid();
}

function applyCustomFocusTimer() {
  if (focusIsRunning) {
    toast('Pause or reset the timer before changing time.', 'error');
    return;
  }
  const h = parseInt(document.getElementById('custom-timer-hours').value) || 0;
  const m = parseInt(document.getElementById('custom-timer-mins').value)  || 0;
  const s = parseInt(document.getElementById('custom-timer-secs').value)  || 0;
  const total = h * 3600 + m * 60 + s;
  if (total <= 0) { toast('Please enter a valid time.', 'error'); return; }
  if (total > 24 * 3600) { toast('Maximum is 24 hours.', 'error'); return; }
  focusSecondsLeft  = total;
  focusTotalSeconds = total;
  updateFocusUI();
  saveFocusState();
  setActiveChip(null); // custom time — clear chip highlights
  const label = h > 0 ? `${h}h ${m}m ${s}s` : m > 0 ? `${m}m ${s}s` : `${s}s`;
  toast(`Timer set to ${label}. Ready?`, 'info');
}

function setFocusTimer(mins) {
  if (focusIsRunning) resetFocusTimer();
  focusSecondsLeft  = mins * 60;
  focusTotalSeconds = focusSecondsLeft;
  // Sync custom inputs
  const hEl = document.getElementById('custom-timer-hours');
  const mEl = document.getElementById('custom-timer-mins');
  const sEl = document.getElementById('custom-timer-secs');
  if (hEl) hEl.value = 0;
  if (mEl) mEl.value = mins;
  if (sEl) sEl.value = 0;
  updateFocusUI();
  saveFocusState();
  setActiveChip(mins);
  toast(`Timer set to ${mins} minutes. Ready?`, 'info');
}

function toggleFocusTimer() {
  const btn = document.getElementById('timer-toggle-btn');
  const container = document.querySelector('.timer-container');
  
  if (focusIsRunning) {
    // PAUSE
    clearInterval(focusInterval);
    focusIsRunning = false;
    btn.innerHTML = '<i class="fa fa-play"></i> Resume Focus';
    btn.className = 'btn-save';
    if (container) container.classList.remove('active');
    saveFocusState();
    toast('Timer paused.', 'info');
  } else {
    if (focusSecondsLeft <= 0) {
      toast('Timer is at zero. Please reset or set a new time.', 'error');
      return;
    }
    // START
    focusIsRunning = true;
    btn.innerHTML = '<i class="fa fa-pause"></i> Pause Focus';
    btn.className = 'btn-cancel';
    if (container) container.classList.add('active');
    
    focusInterval = setInterval(() => {
      focusSecondsLeft--;
      updateFocusUI();
      saveFocusState();
      if (focusSecondsLeft <= 0) {
        completeFocusSession();
      }
    }, 1000);
    saveFocusState();
    toast('Focus session started. Stay sharp!', 'success');
  }
}

function resetFocusTimer() {
  clearInterval(focusInterval);
  focusIsRunning = false;
  focusSecondsLeft = focusTotalSeconds;
  
  const btn = document.getElementById('timer-toggle-btn');
  const container = document.querySelector('.timer-container');
  if (btn) btn.innerHTML = '<i class="fa fa-play"></i> Start Focusing';
  if (btn) btn.className = 'btn-save';
  if (container) container.classList.remove('active');
  
  updateFocusUI();
  saveFocusState();
}

function updateFocusUI() {
  const timeEl = document.getElementById('timer-time');
  const progEl = document.getElementById('timer-progress');
  
  if (!timeEl || !progEl) return;
  
  const h = Math.floor(focusSecondsLeft / 3600);
  const m = Math.floor((focusSecondsLeft % 3600) / 60);
  const s = focusSecondsLeft % 60;

  if (h > 0) {
    timeEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    timeEl.style.fontSize = '2rem'; // shrink for 3-part display
  } else {
    timeEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    timeEl.style.fontSize = '';
  }
  
  // Update Progress Circle (Dasharray 283)
  const ratio = focusTotalSeconds > 0 ? focusSecondsLeft / focusTotalSeconds : 0;
  const offset = 283 - ratio * 283;
  progEl.style.strokeDashoffset = offset;
}

function completeFocusSession() {
  clearInterval(focusInterval);
  focusIsRunning = false;

  const btn = document.getElementById('timer-toggle-btn');
  const container = document.querySelector('.timer-container');
  if (btn) btn.innerHTML = '<i class="fa fa-play"></i> Start Focusing';
  if (btn) btn.className = 'btn-save';
  if (container) container.classList.remove('active');

  focusSecondsLeft = 0;
  updateFocusUI();
  clearFocusState(); // wipe saved running state
  
  // Update Stats — use actual duration in seconds
  focusSessionsToday++;
  // Streak is managed on app open via syncStreak(), not per session
  const secsAdded  = focusTotalSeconds;
  focusTotalSecs  += secsAdded;

  // ── Save session to Supabase ──────────────────────────────
  if (currentUserId) {
    const minsForDB = Math.round(secsAdded / 60); // rounded, not floored
    db.from('focus_sessions').insert({
      user_id:       currentUserId,
      duration_secs: secsAdded,
      duration_mins: minsForDB,
      sound_used:    focusCompletionSound,
    }).then(({ error }) => {
      if (error) console.warn('Could not save focus session:', error.message);
      else focusStatsLoaded = false; // force re-fetch next time section is opened
    });
  }

  // Update stats display
  const sessionsEl  = document.getElementById('focus-sessions-count');
  const totalTimeEl = document.getElementById('focus-total-time');
  if (sessionsEl)  sessionsEl.textContent = focusSessionsToday;
  if (totalTimeEl) totalTimeEl.textContent = formatFocusTime(focusTotalSecs);
  
  // Play the chosen completion sound — loop until dismissed
  playSound(focusCompletionSound, true);
  
  // Show a dismissible popup
  showFocusCompletePopup();
  
  // Vibrate if mobile
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  
  // Browser notification
  if ('Notification' in window && Notification.permission === 'granted') {
    const n = new Notification('⏰ Focus Session Complete!', {
      body: `Great job! You focused for ${formatFocusTime(secsAdded)}.`,
      icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
      tag: 'focus-complete',
      requireInteraction: true,
    });
    n.onclick = () => { window.focus(); n.close(); stopSound(); };
  }
}

function showFocusCompletePopup() {
  const existing = document.getElementById('focus-complete-popup');
  if (existing) existing.remove();

  const popup = document.createElement('div');
  popup.id = 'focus-complete-popup';
  popup.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;
    background:rgba(0,0,0,0.75);display:flex;align-items:center;
    justify-content:center;z-index:9999;animation:fadeIn .3s ease;`;
  popup.innerHTML = `
    <div style="background:var(--surface);border:2px solid var(--accent);border-radius:20px;
      padding:32px 28px;text-align:center;max-width:340px;width:90%;
      box-shadow:0 20px 60px rgba(0,0,0,0.6);animation:scaleIn .3s ease;">
      <div style="font-size:4rem;margin-bottom:12px;animation:pulse 1s infinite">🎉</div>
      <h2 style="font-family:'Playfair Display',serif;color:var(--accent);margin-bottom:8px">
        Focus Complete!
      </h2>
      <p style="color:var(--text2);font-size:.9rem;margin-bottom:20px;line-height:1.5">
        Excellent work! Your focus session is done.<br>Take a short break, you earned it.
      </p>
      <div style="background:var(--surface3);border-radius:12px;padding:12px;margin-bottom:20px">
        <div style="font-size:.75rem;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Sessions today</div>
        <div style="font-size:1.8rem;font-weight:700;color:var(--accent)">${focusSessionsToday}</div>
      </div>
      <button onclick="dismissFocusComplete()" type="button" style="
        background:var(--accent);border:none;border-radius:12px;color:#000;
        padding:14px 32px;font-size:1rem;font-weight:700;cursor:pointer;
        font-family:'DM Sans',sans-serif;width:100%">
        <i class="fa fa-stop-circle"></i> Stop &amp; Dismiss
      </button>
    </div>`;
  document.body.appendChild(popup);
}

function dismissFocusComplete() {
  stopSound();
  clearFocusState();
  const popup = document.getElementById('focus-complete-popup');
  if (popup) popup.remove();
  // Reset timer display
  focusSecondsLeft = focusTotalSeconds;
  updateFocusUI();
  saveFocusState();
  toast('Session dismissed. Ready for another round?', 'success');
}

// Helper — format seconds into "1h 23m 45s" or "23m 45s" or "45s"
function formatFocusTime(secs) {
  if (!secs || secs <= 0) return '0s';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

// Initialize Focus State
let focusStatsLoaded = false;

async function loadFocusStats() {
  restoreFocusState();
  buildTimerSoundPicker();
  updateFocusUI();

  if (!currentUserId) return;

  // If already loaded this session, just refresh display from memory
  if (focusStatsLoaded) {
    _updateFocusStatsDisplay();
    return;
  }

  try {
    const todayStr = today();
    const { data, error } = await db
      .from('focus_sessions')
      .select('duration_secs')
      .eq('user_id', currentUserId)
      .eq('date', todayStr);

    if (error) {
      console.warn('Focus stats fetch error:', error.message);
    } else if (data) {
      focusSessionsToday = data.length;
      focusTotalSecs     = data.reduce((sum, s) => sum + (s.duration_secs || 0), 0);
      focusStatsLoaded   = true;
    }
  } catch(e) { console.warn('loadFocusStats error:', e); }

  _updateFocusStatsDisplay();
}

function _updateFocusStatsDisplay() {
  const sessionsEl  = document.getElementById('focus-sessions-count');
  const totalTimeEl = document.getElementById('focus-total-time');
  if (sessionsEl)  sessionsEl.textContent = focusSessionsToday;
  if (totalTimeEl) totalTimeEl.textContent = formatFocusTime(focusTotalSecs);
}



// ── PREVENT ACCIDENTAL CLOSURE IF ALARMS ARE ACTIVE ───────────────
window.addEventListener('beforeunload', (e) => {
  // Check if there are any active alarms
  if (window.Capacitor && window.Capacitor.isNative) return; // Native apps handle background fine
  
  // Try to read alarms from DOM or a global variable
  const activeAlarmsExist = document.querySelectorAll('.alarm-card:not(.off)').length > 0;
  
  if (activeAlarmsExist) {
    const msg = "You have active alarms! If you close this tab, your alarms will NOT ring. Please leave the app open or minimized.";
    e.preventDefault();
    e.returnValue = msg;
    return msg;
  }
});


// ── CAPGO AUTO-UPDATE INITIALIZATION (Capacitor Native Only) ───────
(function() {
  // Wait a moment after page load to ensure Capacitor is fully loaded
  window.addEventListener('load', () => {
    if (!window.Capacitor || !window.Capacitor.Plugins) return;
    
    const { CapacitorUpdater } = window.Capacitor.Plugins;
    if (!CapacitorUpdater) return;

    // 1. Notify Capgo that the app has successfully launched (prevents rollback)
    try {
      CapacitorUpdater.notifyAppReady();
      console.log('[PlanTrack Native] App ready notified to Capgo.');
    } catch (err) {
      console.error('[PlanTrack Native] notifyAppReady failed:', err);
    }

    // 2. Schedule a check for updates
    setTimeout(checkForUpdates, 1500);

    // 3. Check for exact alarm permission on Android
    if (window.Capacitor.getPlatform() === 'android') {
      const LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
      if (LocalNotifications) {
        LocalNotifications.checkExactNotificationSetting().then(status => {
          if (status.exact_alarm !== 'granted') {
            setTimeout(() => {
              const confirmResult = confirm(
                "PlanTrack needs 'Alarms & Reminders' permission to ring alarms in the background when the app is closed. Open Settings now to grant it?"
              );
              if (confirmResult) {
                LocalNotifications.changeExactNotificationSetting();
              }
            }, 3000);
          }
        }).catch(e => console.warn('Launch exact alarm check failed:', e));
      }
    }

    async function checkForUpdates() {
      try {
        console.log('[PlanTrack Native] Checking for live updates...');
        const latest = await CapacitorUpdater.getLatest();
        console.log('[PlanTrack Native] getLatest result:', latest);

        // If a new version is available and it's different from the current version
        if (latest && latest.version && latest.version !== latest.current) {
          showForceUpdateUI(latest);
        } else {
          console.log('[PlanTrack Native] App is up to date.');
        }
      } catch (err) {
        console.warn('[PlanTrack Native] Live update check failed or no update available:', err);
      }
    }

    function showForceUpdateUI(versionInfo) {
      if (document.getElementById('capgo-update-overlay')) return;

      const overlay = document.createElement('div');
      overlay.id = 'capgo-update-overlay';
      overlay.className = 'update-overlay';

      overlay.innerHTML = `
        <div class="update-card">
          <div class="update-icon-wrapper">
            <i class="fa fa-arrow-circle-up"></i>
          </div>
          <h2>Update Available</h2>
          <p>A new version of PlanTrack is ready with improvements and fixes. Update now to keep using the app smoothly.</p>
          <div class="update-version-badge">Version ${versionInfo.version}</div>
          <button id="capgo-update-btn" class="update-btn-action">Update Now</button>
          
          <div id="capgo-progress-container" class="update-progress-container">
            <div class="update-progress-label">
              <span>Downloading update...</span>
              <span id="capgo-progress-percent">0%</span>
            </div>
            <div class="update-progress-bg">
              <div id="capgo-progress-fill" class="update-progress-fill"></div>
            </div>
            <div class="update-status-msg">Please do not close the app.</div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const updateBtn = document.getElementById('capgo-update-btn');
      const progressContainer = document.getElementById('capgo-progress-container');
      const progressFill = document.getElementById('capgo-progress-fill');
      const progressPercent = document.getElementById('capgo-progress-percent');

      updateBtn.addEventListener('click', async () => {
        updateBtn.style.display = 'none';
        progressContainer.style.display = 'block';

        let progressListener;
        try {
          // Listen to the download progress event
          progressListener = await CapacitorUpdater.addListener('download', (event) => {
            const percent = event.percent || 0;
            progressFill.style.width = percent + '%';
            progressPercent.textContent = Math.round(percent) + '%';
          });
          
          console.log('[PlanTrack Native] Starting update download...');
          const dlResult = await CapacitorUpdater.download(versionInfo);
          
          // Complete to 100% just in case
          progressFill.style.width = '100%';
          progressPercent.textContent = '100%';
          
          console.log('[PlanTrack Native] Download complete, applying update...', dlResult);
          
          // Brief delay for user visual completion, then apply and restart
          setTimeout(async () => {
            if (progressListener) progressListener.remove();
            await CapacitorUpdater.set(dlResult);
          }, 600);

        } catch (error) {
          console.error('[PlanTrack Native] Update download/apply failed:', error);
          alert('Update failed. Please check your internet connection and try again.');
          updateBtn.style.display = 'block';
          progressContainer.style.display = 'none';
          if (progressListener) progressListener.remove();
        }
      });
    }
  });
})();

// ── FOCUS TIMER ENHANCEMENTS ──────────────────────────────────────────

// ── Chip State Management ────────────────────────────────────────────
const CHIP_MINS = [15, 25, 45, 60, 90];
function setActiveChip(activeMins) {
  CHIP_MINS.forEach(m => {
    const el = document.getElementById(`chip-${m}`);
    if (el) el.classList.toggle('active', m === activeMins);
  });
}

// ── Direct-Binding Custom Inputs ─────────────────────────────────────
// Applied once the DOM is ready; listens on all 3 inputs and updates
// the timer display live as the user types, without needing "Set" button
function bindCustomTimerInputs() {
  ['custom-timer-hours','custom-timer-mins','custom-timer-secs'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (focusIsRunning) return;
      const h = parseInt(document.getElementById('custom-timer-hours').value) || 0;
      const m = parseInt(document.getElementById('custom-timer-mins').value)  || 0;
      const s = parseInt(document.getElementById('custom-timer-secs').value)  || 0;
      const total = h * 3600 + m * 60 + s;
      if (total > 0 && total <= 86400) {
        focusSecondsLeft  = total;
        focusTotalSeconds = total;
        updateFocusUI();
        setActiveChip(null);
      }
    });
  });
}

// ── Sound Label Sync ────────────────────────────────────────────────
function updateSoundLabel(soundId) {
  const el = document.getElementById('current-sound-label');
  if (!el) return;
  const builtin = (typeof SOUNDS !== 'undefined' ? SOUNDS : []).find(s => s.id === soundId);
  if (builtin) { el.textContent = `Sound: ${builtin.name}`; return; }
  const user = (typeof userSounds !== 'undefined' ? userSounds : []).find(s => s.id === soundId);
  el.textContent = user ? `Sound: ${user.name}` : 'Sound: Chime';
}

// ── Sound Bottom Sheet ───────────────────────────────────────────────
function openSoundBottomSheet() {
  buildSoundBottomSheet();
  const sheet = document.getElementById('sound-bottom-sheet');
  if (!sheet) return;
  sheet.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeSoundBottomSheet(e) {
  if (e && e.target !== document.getElementById('sound-bottom-sheet')) return;
  _doCloseSoundSheet();
}

function _doCloseSoundSheet() {
  const sheet = document.getElementById('sound-bottom-sheet');
  if (sheet) sheet.style.display = 'none';
  document.body.style.overflow = '';
}

function buildSoundBottomSheet() {
  const builtinEl = document.getElementById('bs-builtin-sounds');
  const userEl    = document.getElementById('bs-user-sounds');
  if (!builtinEl || !userEl) return;

  const sounds = typeof SOUNDS !== 'undefined' ? SOUNDS : [];
  const uSounds = typeof userSounds !== 'undefined' ? userSounds : [];

  builtinEl.innerHTML = sounds.map(s => `
    <div class="bs-sound-item ${focusCompletionSound === s.id ? 'selected' : ''}" onclick="_bsSelectSound('${s.id}')">
      <span class="bs-emoji">${s.emoji}</span>
      <span class="bs-name">${escHtml(s.name)}</span>
      <button class="bs-play-btn" onclick="event.stopPropagation();previewSound('${s.id}')" type="button"><i class="fa fa-play"></i></button>
    </div>`).join('');

  userEl.innerHTML = uSounds.length ? uSounds.map(s => `
    <div class="bs-sound-item ${focusCompletionSound === s.id ? 'selected' : ''}" onclick="_bsSelectSound('${s.id}')">
      <span class="bs-emoji">🎵</span>
      <span class="bs-name">${escHtml(s.name)}</span>
      <button class="bs-play-btn" onclick="event.stopPropagation();previewSound('${s.id}')" type="button"><i class="fa fa-play"></i></button>
      <button class="bs-del-btn" onclick="event.stopPropagation();deleteTimerSound('${s.id.replace('user-','')}','${escHtml(s.name)}')" type="button"><i class="fa fa-trash"></i></button>
    </div>`).join('') : '<div class="timer-no-music">No music uploaded yet — tap Upload above!</div>';
}

function _bsSelectSound(id) {
  focusCompletionSound = id;
  saveFocusState();
  updateSoundLabel(id);
  buildSoundBottomSheet(); // refresh selection highlights
  _doCloseSoundSheet();
  toast('✅ Sound selected!', 'success');
}

// ── Daily Streak Logic (Supabase-backed) ─────────────────────────────

/**
 * Get user's local date as YYYY-MM-DD (timezone-safe)
 */
function getLocalDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check if dateB is exactly 1 calendar day after dateA
 * Both are YYYY-MM-DD strings
 */
function isConsecutiveDay(dateA, dateB) {
  if (!dateA || !dateB) return false;
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  const diffMs = b.getTime() - a.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return diffDays === 1;
}

/**
 * Sync streak with Supabase on app open / focus return.
 * - Same day as last_active_date → do nothing
 * - Exactly 1 day after → current_streak++
 * - More than 1 day gap → current_streak = 1 (reset)
 * - Updates longest_streak if current exceeds it
 * - Saves to Supabase and updates all UI
 */
async function syncStreak() {
  if (!currentUserId) return;

  const todayStr = getLocalDateStr();

  try {
    // Read current streak data from Supabase
    const { data: profile, error: readErr } = await db
      .from('profiles')
      .select('current_streak, longest_streak, last_active_date')
      .eq('id', currentUserId)
      .single();

    if (readErr || !profile) {
      console.warn('Streak read error:', readErr?.message);
      return;
    }

    let currentStreak = profile.current_streak || 0;
    let longestStreak = profile.longest_streak || 0;
    const lastActive  = profile.last_active_date; // YYYY-MM-DD or null

    // Same day → do nothing (prevents multi-open cheating)
    if (lastActive === todayStr) {
      _updateStreakDisplay(currentStreak);
      _updateProfileStreakBadge(currentStreak, longestStreak);
      return;
    }

    // Calculate new streak
    if (isConsecutiveDay(lastActive, todayStr)) {
      currentStreak++;
    } else {
      currentStreak = 1; // reset — streak broken or first use
    }

    // Update longest
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
    }

    // Write to Supabase
    const { error: writeErr } = await db
      .from('profiles')
      .update({
        current_streak:   currentStreak,
        longest_streak:   longestStreak,
        last_active_date: todayStr,
        streak_public:    currentStreak  // backward compat
      })
      .eq('id', currentUserId);

    if (writeErr) {
      console.warn('Streak write error:', writeErr.message);
    }

    // Update cached profile
    if (currentUserProfile) {
      currentUserProfile.current_streak   = currentStreak;
      currentUserProfile.longest_streak   = longestStreak;
      currentUserProfile.last_active_date = todayStr;
      currentUserProfile.streak_public    = currentStreak;
    }

    // Update UI
    _updateStreakDisplay(currentStreak);
    _updateProfileStreakBadge(currentStreak, longestStreak);

    // Show splash on streak change
    _showStreakSplashIfNeeded(currentStreak);

  } catch (err) {
    console.warn('syncStreak error:', err);
  }
}

function _updateStreakDisplay(current) {
  const el = document.getElementById('focus-streak-count');
  if (el) el.textContent = `🔥 ${current} day${current !== 1 ? 's' : ''}`;
}

function _updateProfileStreakBadge(current, longest) {
  const el = document.getElementById('profile-streak-badge');
  if (el) el.textContent = `🔥 ${current} Day Streak (Best: ${longest})`;
}

function _showStreakSplashIfNeeded(currentStreak) {
  if (currentStreak < 1) return;

  // Only show the splash screen once per day
  const todayStr = getLocalDateStr();
  try {
    const lastShownDate = localStorage.getItem('plantrack_streak_splash_shown_date');
    if (lastShownDate === todayStr) return;
    localStorage.setItem('plantrack_streak_splash_shown_date', todayStr);
  } catch (e) {}

  const splashEl = document.getElementById('streak-splash');
  const numEl    = document.getElementById('streak-splash-num');
  const msgEl    = document.getElementById('streak-splash-msg');
  if (!splashEl) return;

  if (numEl) numEl.textContent = currentStreak;
  if (msgEl) {
    if (currentStreak === 1)      msgEl.textContent = 'Great start — come back tomorrow to build your streak!';
    else if (currentStreak < 7)   msgEl.textContent = `${currentStreak} days in a row! Keep the momentum going.`;
    else if (currentStreak < 30)  msgEl.textContent = `🔥 ${currentStreak} days strong! You're on fire!`;
    else                          msgEl.textContent = `🏆 ${currentStreak} days! You are an absolute machine!`;
  }

  splashEl.style.display = 'flex';
  setTimeout(() => dismissStreakSplash(), 5000);
}

function showStreakSplashIfNeeded() {
  // Reads from cached profile (already synced in initApp)
  const cs = currentUserProfile?.current_streak || 0;
  _updateStreakDisplay(cs);
  _showStreakSplashIfNeeded(cs);
}

function dismissStreakSplash() {
  const el = document.getElementById('streak-splash');
  if (el) el.style.display = 'none';
}

/**
 * Schedule a browser notification at 8 PM local time
 * to warn the user they're about to lose their streak.
 * Only fires if the user hasn't already synced today.
 */
let _streakReminderTimeout = null;
function scheduleStreakReminder() {
  if (_streakReminderTimeout) clearTimeout(_streakReminderTimeout);

  const cs = currentUserProfile?.current_streak || 0;
  if (cs < 1) return; // no streak to protect

  // Calculate ms until 8 PM local time today
  const now = new Date();
  const target = new Date();
  target.setHours(20, 0, 0, 0); // 8 PM

  let delay = target.getTime() - now.getTime();
  if (delay <= 0) return; // already past 8 PM

  _streakReminderTimeout = setTimeout(async () => {
    // Re-check: has user already been active today?
    const todayStr = getLocalDateStr();
    const lastActive = currentUserProfile?.last_active_date;

    if (lastActive === todayStr) return; // already active, no warning needed

    // Request notification permission if not granted
    if ('Notification' in window) {
      if (Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      if (Notification.permission === 'granted') {
        new Notification('🔥 Don\'t lose your streak!', {
          body: `You have a ${cs}-day streak! Open PlanTrack before midnight to keep it going.`,
          icon: 'WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
          tag: 'streak-reminder'
        });
      }
    }

    // Also show in-app toast if app is visible
    if (document.visibilityState === 'visible') {
      toast(`🔥 Don't lose your ${cs}-day streak! You've already opened the app — you're safe!`, 'info');
    }
  }, delay);
}

// ── Real Social Accountability, Presence, and Admin Dashboard ─────────

let activeHeartbeatInterval = null;
let socialNotificationInterval = null;
let activeCounterInterval = null;
window._viewingUserId = null;
window.currentRating = 0;
window.adminUsersList = [];

// Initialize real-time social layer
window.initSocialReal = function() {
  if (!currentUserId) return;

  // Clear existing intervals if any
  if (activeHeartbeatInterval) clearInterval(activeHeartbeatInterval);
  if (socialNotificationInterval) clearInterval(socialNotificationInterval);
  if (activeCounterInterval) clearInterval(activeCounterInterval);

  // 1. Initial actions
  updatePresence();
  updateActivePresenceCounter();
  checkSocialInteractions();
  loadFriendsReal();

  // 2. Set up Heartbeats/Polls
  // Presence heartbeat every 45s
  activeHeartbeatInterval = setInterval(updatePresence, 45000);

  // Social interactions (Seen check) every 15s
  socialNotificationInterval = setInterval(checkSocialInteractions, 15000);

  // Active users count update every 30s
  activeCounterInterval = setInterval(updateActivePresenceCounter, 30000);
};

// Heartbeat to update presence in Supabase
async function updatePresence() {
  if (!currentUserId) return;
  try {
    const { error } = await db.from('user_presence').upsert({
      user_id: currentUserId,
      last_seen: new Date().toISOString()
    });
    if (error) console.warn('Presence heartbeat error:', error.message);
  } catch (err) {
    console.warn('Presence update failed:', err);
  }
}
let notifiedFriendRequests = new Set();

// Check for unread Nudges / High-fives and Pending Friend Requests
async function checkSocialInteractions() {
  if (!currentUserId) return;
  try {
    // Select unseen notifications where current user is receiver
    const { data, error } = await db
      .from('social_interactions')
      .select('id, type, sender_id, created_at')
      .eq('receiver_id', currentUserId)
      .eq('seen', false)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('Social notifications fetch error:', error.message);
      return;
    }

    if (data && data.length > 0) {
      // Fetch details of senders
      const senderIds = data.map(i => i.sender_id);
      const { data: profiles, error: pError } = await db
        .from('profiles')
        .select('id, username')
        .in('id', senderIds);

      if (pError) return;

      const profileMap = {};
      profiles.forEach(p => { profileMap[p.id] = p.username; });

      for (const interaction of data) {
        const senderUsername = profileMap[interaction.sender_id] || 'Someone';
        if (interaction.type === 'nudge') {
          toast(`👊 Nudge! ${senderUsername} is reminding you to focus!`, 'info');
        } else if (interaction.type === 'highfive') {
          toast(`🙌 High-Five! ${senderUsername} sent you a high-five!`, 'success');
        }

        // Mark it as seen
        await db.from('social_interactions').update({ seen: true }).eq('id', interaction.id);
      }
    }

    // Check for Pending Friend Requests
    const { data: frData, error: frError } = await db
      .from('friends')
      .select('id, user_id')
      .eq('friend_id', currentUserId)
      .eq('status', 'pending');

    if (!frError && frData && frData.length > 0) {
      const senderIds = frData.map(f => f.user_id);
      const { data: frProfiles } = await db
        .from('profiles')
        .select('id, username')
        .in('id', senderIds);
      
      const pMap = {};
      if (frProfiles) {
        frProfiles.forEach(p => { pMap[p.id] = p.username; });
      }

      frData.forEach(fr => {
        if (!notifiedFriendRequests.has(fr.id)) {
          notifiedFriendRequests.add(fr.id);
          const senderName = pMap[fr.user_id] || 'Someone';
          
          // Request browser notification if permission granted
          if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('New Friend Request!', {
              body: `${senderName} wants to be your friend.`,
              icon: 'WhatsApp Image 2026-04-07 at 20.53.13.jpeg'
            });
          }

          toast(`👤 ${senderName} sent you a friend request! Check your profile to accept.`, 'info');
        }
      });
    }
  } catch (err) {
    console.warn('Social notifications error:', err);
  }
}

// Update the live focusing counter in header/UI
async function updateActivePresenceCounter() {
  try {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    // Count how many users have been active in the last 5 minutes
    const { count, error } = await db
      .from('user_presence')
      .select('*', { count: 'exact', head: true })
      .gte('last_seen', fiveMinutesAgo);

    if (!error && count !== null) {
      const el = document.getElementById('live-focus-counter');
      if (el) el.textContent = count;
    }
  } catch (err) {
    console.warn('Presence count fetch failed:', err);
  }
}

// Load accepted friends and pending requests
async function loadFriendsReal() {
  const container = document.getElementById('friends-list');
  const profileContainer = document.getElementById('profile-friends-list');
  const tabContainer = document.getElementById('tab-friends-list');
  if (!currentUserId) return;
  if (!container && !profileContainer && !tabContainer) return;

  try {
    // 1. Fetch friend relations
    const { data: friendships, error: fError } = await db
      .from('friends')
      .select('*')
      .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`);

    if (fError) {
      const errHtml = '<div style="color:var(--text3);font-size:.8rem">Error loading friends</div>';
      if (container) container.innerHTML = errHtml;
      if (profileContainer) profileContainer.innerHTML = errHtml;
      if (tabContainer) tabContainer.innerHTML = errHtml;
      return;
    }

    const acceptedFriendsIds = [];
    const pendingIncoming = [];

    friendships.forEach(f => {
      if (f.status === 'accepted') {
        acceptedFriendsIds.push(f.user_id === currentUserId ? f.friend_id : f.user_id);
      } else if (f.status === 'pending' && f.friend_id === currentUserId) {
        pendingIncoming.push(f);
      }
    });

    let html = '';

    // 2. Render pending incoming friend requests
    if (pendingIncoming.length > 0) {
      // Get profiles of request senders
      const senderIds = pendingIncoming.map(p => p.user_id);
      const { data: requestSenders } = await db
        .from('profiles')
        .select('id, username')
        .in('id', senderIds);

      if (requestSenders && requestSenders.length > 0) {
        html += `<div class="pending-requests-box" style="background:rgba(240,192,64,.08);border:1px solid rgba(240,192,64,.3);border-radius:12px;padding:12px;margin-bottom:14px">
          <div style="font-size:0.75rem;font-weight:700;color:var(--accent);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">Pending Friend Requests</div>`;
        requestSenders.forEach(sender => {
          const reqObj = pendingIncoming.find(p => p.user_id === sender.id);
          html += `
            <div style="display:flex;align-items:center;justify-content:between;margin-bottom:6px;font-size:0.82rem;gap:8px">
              <span style="flex:1;color:var(--text)">👤 <strong>${escHtml(sender.username)}</strong> wants to be friends</span>
              <button onclick="acceptFriendReq('${reqObj.id}')" class="btn-save" style="padding:4px 8px;font-size:0.75rem">Accept</button>
              <button onclick="declineFriendReq('${reqObj.id}')" class="btn-cancel" style="padding:4px 8px;font-size:0.75rem">Decline</button>
            </div>`;
        });
        html += `</div>`;
      }
    }

    // 3. Render Accepted Friends
    if (acceptedFriendsIds.length === 0) {
      html += '<div style="color:var(--text3);text-align:center;padding:20px;font-size:0.85rem">No friends added yet. Search users below to send friend requests!</div>';
      if (container) container.innerHTML = html;
      if (profileContainer) profileContainer.innerHTML = html;
      if (tabContainer) tabContainer.innerHTML = html;
      return;
    }

    // Fetch friend profiles & presence & focus
    const { data: friendsProfiles, error: pError } = await db
      .from('profiles')
      .select('id, username, streak_public')
      .in('id', acceptedFriendsIds);

    if (pError || !friendsProfiles) {
      const errHtml = html + '<div style="color:var(--text3);font-size:.8rem">Error fetching friend profiles</div>';
      if (container) container.innerHTML = errHtml;
      if (profileContainer) profileContainer.innerHTML = errHtml;
      if (tabContainer) tabContainer.innerHTML = errHtml;
      return;
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: presences } = await db
      .from('user_presence')
      .select('user_id, last_seen')
      .in('user_id', acceptedFriendsIds)
      .gte('last_seen', fiveMinutesAgo);

    const activeMap = {};
    if (presences) {
      presences.forEach(p => { activeMap[p.user_id] = true; });
    }

    const listHtml = friendsProfiles.map(friend => {
      const isOnline = !!activeMap[friend.id];
      const initial = (friend.username || '?').charAt(0).toUpperCase();
      const streakVal = friend.streak_public || 0;

      // Get gradient color based on username
      const charCode = (friend.username || '').charCodeAt(0) || 65;
      const gradients = [
        'linear-gradient(135deg,#4a90e2,#9b59b6)',
        'linear-gradient(135deg,#e07b3a,#f0c040)',
        'linear-gradient(135deg,#27ae60,#4a90e2)',
        'linear-gradient(135deg,#e74c3c,#9b59b6)'
      ];
      const grad = gradients[charCode % gradients.length];

      return `
        <div class="friend-item" id="fi-${friend.id}">
          <div class="friend-avatar" style="background:${grad};cursor:pointer" onclick="showUserProfile('${friend.id}')">${initial}</div>
          <div class="friend-info" style="cursor:pointer" onclick="showUserProfile('${friend.id}')">
            <div class="friend-name">${escHtml(friend.username)} <span style="font-size:0.75rem">🔥 ${streakVal}</span></div>
            <div class="friend-status ${isOnline ? 'focusing' : ''}">
              <span class="sdot"></span>
              ${isOnline ? 'Active right now' : 'Offline'}
            </div>
          </div>
          <div class="friend-actions">
            <button class="friend-action-btn nudge" onclick="sendNudge('${friend.id}','${escHtml(friend.username)}')" type="button">👊 Nudge</button>
            <button class="friend-action-btn hifi"  onclick="sendHighFive('${friend.id}','${escHtml(friend.username)}')" type="button">🙌 Hi-5</button>
          </div>
        </div>`;
    }).join('');

    if (container) container.innerHTML = html + listHtml;
    if (profileContainer) profileContainer.innerHTML = html + listHtml;
    if (tabContainer) tabContainer.innerHTML = html + listHtml;
  } catch (err) {
    console.warn('loadFriendsReal error:', err);
  }
}

// Friend actions: nudge and highfive
async function sendNudge(friendId, friendName) {
  if (!currentUserId) return;
  try {
    const { error } = await db.from('social_interactions').insert({
      sender_id: currentUserId,
      receiver_id: friendId,
      type: 'nudge'
    });
    if (error) {
      toast('Could not send nudge: ' + error.message, 'error');
    } else {
      toast(`👊 Nudge sent to ${friendName}!`, 'success');
      const btn = document.querySelector(`#fi-${friendId} .nudge`);
      if (btn) { btn.textContent = '✅ Nudged!'; btn.disabled = true; }
    }
  } catch (err) {
    console.warn('sendNudge error:', err);
  }
}

async function sendHighFive(friendId, friendName) {
  if (!currentUserId) return;
  try {
    const { error } = await db.from('social_interactions').insert({
      sender_id: currentUserId,
      receiver_id: friendId,
      type: 'highfive'
    });
    if (error) {
      toast('Could not send high-five: ' + error.message, 'error');
    } else {
      toast(`🙌 High-five sent to ${friendName}!`, 'success');
      const btn = document.querySelector(`#fi-${friendId} .hifi`);
      if (btn) { btn.textContent = '✅ Hi-5!'; btn.disabled = true; }
    }
  } catch (err) {
    console.warn('sendHighFive error:', err);
  }
}

// Accept friend request
async function acceptFriendReq(requestId) {
  try {
    const { error } = await db.from('friends').update({ status: 'accepted' }).eq('id', requestId);
    if (error) {
      toast('Could not accept request: ' + error.message, 'error');
    } else {
      toast('Friend request accepted!', 'success');
      loadFriendsReal();
    }
  } catch (err) {
    console.warn(err);
  }
}

// Decline/delete friend request
async function declineFriendReq(requestId) {
  try {
    const { error } = await db.from('friends').delete().eq('id', requestId);
    if (error) {
      toast('Could not decline request: ' + error.message, 'error');
    } else {
      toast('Friend request declined.', 'info');
      loadFriendsReal();
    }
  } catch (err) {
    console.warn(err);
  }
}

// Search users by username (real-time debounced)
let searchTimeout = null;
window.searchUsersDebounced = function() {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(searchUsersReal, 300);
};

async function searchUsersReal() {
  const query = document.getElementById('friend-search-input').value.trim();
  const resultsContainer = document.getElementById('friend-search-results');
  if (!resultsContainer) return;

  if (query.length < 2) {
    resultsContainer.innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">Type at least 2 characters to search...</div>';
    return;
  }

  resultsContainer.innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">Searching...</div>';

  try {
    // 1. Fetch matching profiles (excluding current user)
    const { data: matchedUsers, error } = await db
      .from('profiles')
      .select('id, username, streak_public')
      .neq('id', currentUserId)
      .ilike('username', `%${query}%`)
      .limit(10);

    if (error) {
      resultsContainer.innerHTML = `<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">Search failed: ${error.message}</div>`;
      return;
    }

    if (!matchedUsers || matchedUsers.length === 0) {
      resultsContainer.innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">No users found matching that name</div>';
      return;
    }

    // 2. Fetch existing relations to show correct action buttons
    const targetUserIds = matchedUsers.map(u => u.id);
    const { data: relations } = await db
      .from('friends')
      .select('*')
      .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`)
      .in('user_id', targetUserIds.concat(currentUserId))
      .in('friend_id', targetUserIds.concat(currentUserId));

    const relationMap = {};
    if (relations) {
      relations.forEach(rel => {
        const otherId = rel.user_id === currentUserId ? rel.friend_id : rel.user_id;
        relationMap[otherId] = rel;
      });
    }

    // 3. Render matching user cards
    resultsContainer.innerHTML = matchedUsers.map(u => {
      const rel = relationMap[u.id];
      let actionBtn = '';
      if (!rel) {
        actionBtn = `<button onclick="sendFriendReq('${u.id}')" class="btn-save" style="padding:6px 12px;font-size:0.75rem"><i class="fa fa-user-plus"></i> Add</button>`;
      } else if (rel.status === 'accepted') {
        actionBtn = `<span style="color:var(--green);font-size:0.75rem;font-weight:700"><i class="fa fa-check"></i> Friends</span>`;
      } else if (rel.status === 'pending') {
        if (rel.user_id === currentUserId) {
          actionBtn = `<span style="color:var(--accent);font-size:0.75rem;font-weight:700">Requested</span>`;
        } else {
          actionBtn = `<button onclick="acceptFriendReq('${rel.id}')" class="btn-save" style="padding:6px 12px;font-size:0.75rem">Accept</button>`;
        }
      }

      const initial = (u.username || '?').charAt(0).toUpperCase();

      return `
        <div class="fs-result-item">
          <div class="fs-user-details" onclick="showUserProfile('${u.id}')">
            <div class="fs-avatar">${initial}</div>
            <div>
              <div class="fs-name">${escHtml(u.username)}</div>
              <div style="font-size:0.7rem;color:var(--text3);margin-top:2px">🔥 Streak: ${u.streak_public || 0}</div>
            </div>
          </div>
          <div class="fs-action-wrapper" id="action-wrap-${u.id}">
            ${actionBtn}
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    console.warn(err);
  }
}

// Search users in the Add Friends tab (real-time debounced)
let tabSearchTimeout = null;
window.searchTabUsersDebounced = function() {
  if (tabSearchTimeout) clearTimeout(tabSearchTimeout);
  tabSearchTimeout = setTimeout(searchTabUsersReal, 300);
};

async function searchTabUsersReal() {
  const query = document.getElementById('tab-friend-search-input').value.trim();
  const resultsContainer = document.getElementById('tab-friend-search-results');
  if (!resultsContainer) return;

  if (query.length < 2) {
    resultsContainer.innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">Type at least 2 characters to search...</div>';
    return;
  }

  resultsContainer.innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">Searching...</div>';

  try {
    // 1. Fetch matching profiles (excluding current user)
    const { data: matchedUsers, error } = await db
      .from('profiles')
      .select('id, username, streak_public')
      .neq('id', currentUserId)
      .ilike('username', `%${query}%`)
      .limit(10);

    if (error) {
      resultsContainer.innerHTML = `<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">Search failed: ${error.message}</div>`;
      return;
    }

    if (!matchedUsers || matchedUsers.length === 0) {
      resultsContainer.innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">No users found matching that name</div>';
      return;
    }

    // 2. Fetch active status (presence) of matching users
    const targetUserIds = matchedUsers.map(u => u.id);
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: presences } = await db
      .from('user_presence')
      .select('user_id, last_seen')
      .in('user_id', targetUserIds)
      .gte('last_seen', fiveMinutesAgo);

    const activeMap = {};
    if (presences) {
      presences.forEach(p => { activeMap[p.user_id] = true; });
    }

    // 3. Fetch existing relations to show correct action buttons
    const { data: relations } = await db
      .from('friends')
      .select('*')
      .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`)
      .in('user_id', targetUserIds.concat(currentUserId))
      .in('friend_id', targetUserIds.concat(currentUserId));

    const relationMap = {};
    if (relations) {
      relations.forEach(rel => {
        const otherId = rel.user_id === currentUserId ? rel.friend_id : rel.user_id;
        relationMap[otherId] = rel;
      });
    }

    // 4. Render matching user cards with active status
    resultsContainer.innerHTML = matchedUsers.map(u => {
      const rel = relationMap[u.id];
      const isOnline = !!activeMap[u.id];
      let actionBtn = '';
      if (!rel) {
        actionBtn = `<button onclick="sendFriendReq('${u.id}')" class="btn-save" style="padding:6px 12px;font-size:0.75rem"><i class="fa fa-user-plus"></i> Add</button>`;
      } else if (rel.status === 'accepted') {
        actionBtn = `<span style="color:var(--green);font-size:0.75rem;font-weight:700"><i class="fa fa-check"></i> Friends</span>`;
      } else if (rel.status === 'pending') {
        if (rel.user_id === currentUserId) {
          actionBtn = `<span style="color:var(--accent);font-size:0.75rem;font-weight:700">Requested</span>`;
        } else {
          actionBtn = `<button onclick="acceptFriendReq('${rel.id}')" class="btn-save" style="padding:6px 12px;font-size:0.75rem">Accept</button>`;
        }
      }

      const initial = (u.username || '?').charAt(0).toUpperCase();

      return `
        <div class="fs-result-item" style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.02); padding:10px 14px; border-radius:8px; border:1px solid rgba(255,255,255,0.04)">
          <div class="fs-user-details" style="display:flex; align-items:center; gap:10px; cursor:pointer" onclick="showUserProfile('${u.id}')">
            <div class="fs-avatar" style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#4a90e2,#9b59b6); display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff">${initial}</div>
            <div>
              <div class="fs-name" style="font-size:0.85rem; font-weight:600; color:var(--text)">${escHtml(u.username)}</div>
              <div class="friend-status ${isOnline ? 'focusing' : ''}">
                <span class="sdot"></span>
                ${isOnline ? 'Active' : 'Offline'}
              </div>
            </div>
          </div>
          <div class="fs-action-wrapper" id="tab-action-wrap-${u.id}">
            ${actionBtn}
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    resultsContainer.innerHTML = `<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:20px">Error searching: ${err.message}</div>`;
  }
}

// Send friend request from search results or user profile modal
window.sendFriendReq = async function(targetUserId) {
  if (!targetUserId || !currentUserId) return;
  try {
    const { error } = await db.from('friends').insert({
      user_id: currentUserId,
      friend_id: targetUserId,
      status: 'pending'
    });

    if (error) {
      toast('Could not send friend request: ' + error.message, 'error');
    } else {
      toast('Friend request sent!', 'success');
      // Update results UI if open
      const wrap = document.getElementById(`action-wrap-${targetUserId}`);
      if (wrap) {
        wrap.innerHTML = `<span style="color:var(--accent);font-size:0.75rem;font-weight:700">Requested</span>`;
      }
      const tabWrap = document.getElementById(`tab-action-wrap-${targetUserId}`);
      if (tabWrap) {
        tabWrap.innerHTML = `<span style="color:var(--accent);font-size:0.75rem;font-weight:700">Requested</span>`;
      }
      // Update profile modal button if open
      const pModalBtn = document.getElementById('up-add-friend-btn');
      if (pModalBtn) {
        pModalBtn.innerHTML = '<i class="fa fa-clock"></i> Request Pending';
        pModalBtn.disabled = true;
      }
      loadFriendsReal();
    }
  } catch (err) {
    console.warn(err);
  }
};

// Show a specific user's public statistics on a modal card
window.showUserProfile = async function(userId) {
  if (!userId) return;
  window._viewingUserId = userId;
  openModal('modal-user-profile');

  // Set loading state
  document.getElementById('up-avatar').textContent = '?';
  document.getElementById('up-username').textContent = 'Loading...';
  document.getElementById('up-joined').textContent = '';
  document.getElementById('up-streak').textContent = '';
  document.getElementById('up-sessions').textContent = '—';
  document.getElementById('up-focus-mins').textContent = '—';

  const addFriendBtn = document.getElementById('up-add-friend-btn');
  if (addFriendBtn) {
    addFriendBtn.style.display = 'none';
    addFriendBtn.disabled = false;
    addFriendBtn.innerHTML = '<i class="fa fa-user-plus"></i> Add Friend';
  }

  try {
    // 1. Fetch public profile stats view
    const { data, error } = await db
      .from('public_profile_stats')
      .select('*')
      .eq('id', userId)
      .single();

    if (error || !data) {
      document.getElementById('up-username').textContent = 'User Profile';
      document.getElementById('up-joined').textContent = 'Failed to load details.';
      return;
    }

    document.getElementById('up-avatar').textContent = (data.username || '?').charAt(0).toUpperCase();
    document.getElementById('up-username').textContent = data.username || 'Anonymous User';
    document.getElementById('up-joined').textContent = `Joined ${fmtDate(data.joined_at?.split('T')[0] || today())}`;
    document.getElementById('up-streak').textContent = `🔥 Streak: ${data.current_streak || data.streak_public || 0} days (Best: ${data.longest_streak || 0})`;
    document.getElementById('up-sessions').textContent = data.total_sessions || 0;
    document.getElementById('up-focus-mins').textContent = data.total_focus_mins || 0;

    // 2. Fetch friendship relation to show/hide "Add Friend" option
    if (userId !== currentUserId && addFriendBtn) {
      addFriendBtn.style.display = 'block';
      const { data: rel, error: rError } = await db
        .from('friends')
        .select('*')
        .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`)
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`)
        .single();

      if (!rError && rel) {
        if (rel.status === 'accepted') {
          addFriendBtn.innerHTML = '<i class="fa fa-check"></i> Already Friends';
          addFriendBtn.disabled = true;
        } else if (rel.status === 'pending') {
          if (rel.user_id === currentUserId) {
            addFriendBtn.innerHTML = '<i class="fa fa-clock"></i> Request Pending';
            addFriendBtn.disabled = true;
          } else {
            addFriendBtn.innerHTML = 'Accept Friend Request';
            addFriendBtn.onclick = () => acceptFriendReq(rel.id);
          }
        }
      } else {
        // No relation: allow sending
        addFriendBtn.onclick = () => sendFriendReq(userId);
      }
    }
  } catch (err) {
    console.warn(err);
  }
};

// ── Star Ratings & Feedback System ───────────────────────────────────

window.setRating = function(ratingVal) {
  window.currentRating = ratingVal;
  const stars = document.querySelectorAll('#star-rating-row .star');
  stars.forEach((star, index) => {
    if (index < ratingVal) {
      star.classList.add('selected');
    } else {
      star.classList.remove('selected');
    }
  });
};

window.submitFeedback = async function() {
  if (!currentUserId) return;
  if (window.currentRating === 0) {
    toast('Please select at least 1 star rating!', 'error');
    return;
  }

  const commentVal = document.getElementById('feedback-comment').value.trim();

  try {
    const { error } = await db.from('feedback').insert({
      user_id: currentUserId,
      rating: window.currentRating,
      comment: commentVal,
      created_at: new Date().toISOString()
    });

    if (error) {
      toast('Failed to submit feedback: ' + error.message, 'error');
    } else {
      toast('⭐ Thank you for your feedback!', 'success');
      closeModal('modal-feedback');
      // Reset modal values
      setRating(0);
      document.getElementById('feedback-comment').value = '';
    }
  } catch (err) {
    console.warn(err);
  }
};

// ── Admin Dashboard System ───────────────────────────────────────────

window.loadAdminPanel = async function() {
  if (!currentUserProfile || !currentUserProfile.is_admin) {
    toast('Unauthorized: Admin access only.', 'error');
    showSection('alarms');
    return;
  }

  // Load Admin Metrics
  try {
    const [profilesCount, focusSessions, feedbackList] = await Promise.all([
      db.from('profiles').select('id', { count: 'exact', head: true }),
      db.from('focus_sessions').select('duration_mins'),
      db.from('feedback').select('rating, comment')
    ]);

    // Render Metrics
    const totalUsers = profilesCount.count || 0;
    const totalSessions = focusSessions.data ? focusSessions.data.length : 0;
    const totalFocusMins = focusSessions.data ? focusSessions.data.reduce((sum, s) => sum + (s.duration_mins || 0), 0) : 0;
    const totalFocusHours = Math.round(totalFocusMins / 60);

    const feedbackCount = feedbackList.data ? feedbackList.data.length : 0;
    const avgRating = feedbackCount > 0 ? (feedbackList.data.reduce((sum, f) => sum + f.rating, 0) / feedbackCount).toFixed(1) : '—';

    document.getElementById('admin-total-users').textContent = totalUsers;
    document.getElementById('admin-total-focus').textContent = `${totalFocusHours}h`;
    document.getElementById('admin-avg-rating').textContent = `${avgRating} ★`;
    document.getElementById('admin-total-feedback').textContent = feedbackCount;

    // Compute avg streak across all users
    try {
      const { data: streakData } = await db.from('profiles').select('current_streak');
      if (streakData && streakData.length > 0) {
        const avgStreak = (streakData.reduce((sum, p) => sum + (p.current_streak || 0), 0) / streakData.length).toFixed(1);
        const avgEl = document.getElementById('admin-avg-streak');
        if (avgEl) avgEl.textContent = `🔥 ${avgStreak}`;
      }
    } catch (e) { console.warn('Avg streak calc error:', e); }

    // Load admin user list view via function
    const { data: userOverview, error } = await db.rpc('get_admin_overview');

    if (error) {
      console.warn('RPC get_admin_overview error:', error.message);
      document.getElementById('admin-table-body').innerHTML = `<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text3)">Error loading user overview: ${error.message}</td></tr>`;
    } else if (userOverview) {
      const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: adminPres } = await db.from('user_presence').select('user_id').gte('last_seen', fiveMinsAgo);
      const adminActiveMap = {};
      if (adminPres) adminPres.forEach(p => adminActiveMap[p.user_id] = true);
      userOverview.forEach(u => u.isOnline = !!adminActiveMap[u.id]);

      window.adminUsersList = userOverview;
      renderAdminUsersTable(userOverview);
    }

    // Load feedback listings
    const { data: feedBackWithUser } = await db
      .from('feedback')
      .select('rating, comment, created_at, profiles(username)')
      .order('created_at', { ascending: false });

    const feedListContainer = document.getElementById('admin-feedback-list');
    if (feedListContainer) {
      if (!feedBackWithUser || feedBackWithUser.length === 0) {
        feedListContainer.innerHTML = '<div style="color:var(--text3);font-size:.85rem;text-align:center;padding:15px">No user reviews submitted yet.</div>';
      } else {
        feedListContainer.innerHTML = feedBackWithUser.map(fb => {
          const author = fb.profiles?.username || 'Unknown User';
          const starsHtml = '★'.repeat(fb.rating) + '☆'.repeat(5 - fb.rating);
          const dateStr = fmtDate(fb.created_at?.split('T')[0] || today());
          const authorInitial = author.charAt(0).toUpperCase();

          return `
            <div class="feedback-card">
              <div class="feedback-header">
                <div class="feedback-user-info">
                  <div class="feedback-avatar">${authorInitial}</div>
                  <div>
                    <span class="feedback-username">${escHtml(author)}</span>
                    <div class="feedback-date">${dateStr}</div>
                  </div>
                </div>
                <div class="feedback-rating-stars">${starsHtml}</div>
              </div>
              ${fb.comment ? `<p class="feedback-comment-text">${escHtml(fb.comment)}</p>` : '<p class="feedback-comment-text" style="font-style:italic;color:var(--text3)">No comment left</p>'}
            </div>`;
        }).join('');
      }
    }

  } catch (err) {
    console.warn(err);
  }
};

function renderAdminUsersTable(users) {
  const tbody = document.getElementById('admin-table-body');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text3)">No matching users found</td></tr>';
    return;
  }

  tbody.innerHTML = users.map(u => {
    const avatarLetter = (u.username || '?').charAt(0).toUpperCase();
    const joined = fmtDate(u.joined_at?.split('T')[0] || today());
    const focusHrs = Math.round((u.total_focus_mins || 0) / 60);
    const lastActive = u.last_focus_at ? fmtDate(u.last_focus_at?.split('T')[0]) : 'Never';
    const adminTag = u.is_admin ? '<span style="color:var(--accent);font-size:.7rem;font-weight:700;margin-left:5px">[ADMIN]</span>' : '';
    const curStreak = u.current_streak || 0;
    const bestStreak = u.longest_streak || 0;

    return `
      <tr>
        <td>
          <div class="user-cell" style="cursor:pointer" onclick="showUserProfile('${u.id}')">
            <div class="avatar-cell" style="position:relative;">
              ${avatarLetter}
              ${u.isOnline ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;background:var(--green);border-radius:50%;border:2px solid var(--surface)"></span>' : ''}
            </div>
            <div>
              <strong>${escHtml(u.username || 'Anonymous')}</strong>${adminTag}
              <div style="font-size:0.7rem; color:${u.isOnline ? 'var(--green)' : 'var(--text3)'}">${u.isOnline ? 'Online' : 'Offline'}</div>
            </div>
          </div>
        </td>
        <td>${escHtml(u.email || '—')}</td>
        <td>${joined}</td>
        <td>${u.total_sessions || 0}</td>
        <td>${focusHrs}h</td>
        <td><span style="color:var(--accent);font-weight:600">🔥 ${curStreak}</span> <span style="color:var(--text3);font-size:.75rem">(Best: ${bestStreak})</span></td>
        <td>${lastActive}</td>
        <td style="text-align:right">
          <button onclick="showUserProfile('${u.id}')" class="btn-outline-sm" style="padding:4px 8px;font-size:0.75rem"><i class="fa fa-eye"></i> Profile</button>
        </td>
      </tr>`;
  }).join('');
}

window.filterAdminTable = function() {
  const query = document.getElementById('admin-search-input').value.toLowerCase().trim();
  if (!query) {
    renderAdminUsersTable(window.adminUsersList);
    return;
  }

  const filtered = window.adminUsersList.filter(u => {
    const name = (u.username || '').toLowerCase();
    const email = (u.email || '').toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  renderAdminUsersTable(filtered);
};


// Hook into showSection to lazy-init Focus Timer extras and real-time social layers
function initFocusTimerExtras() {
  bindCustomTimerInputs();
  updateSoundLabel(focusCompletionSound || 'chime');
  loadFriendsReal();
  showStreakSplashIfNeeded();
}

(function patchShowSection() {
  const FOCUS_SECTION = 'focustimer';
  let _focusExtrasInit = false;
  const origFn = window.showSection;
  if (typeof origFn !== 'function') {
    window.addEventListener('load', patchShowSection);
    return;
  }
  window.showSection = function(name, ...args) {
    origFn(name, ...args);
    if (name === FOCUS_SECTION && !_focusExtrasInit) {
      setTimeout(initFocusTimerExtras, 150);
      _focusExtrasInit = true;
    }
  };
})();
// ═══════════════════════════════════════════════════════════════
//  CHAT FEATURE
// ═══════════════════════════════════════════════════════════════

// ── Helpers ─────────────────────────────────────────────────────

function chatFormatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  
  // Smart Twitter-style relative time for conversation list previews
  const now = new Date();
  const diffMs = now - d;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24 && d.toDateString() === now.toDateString()) return `${diffHours}h`;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yest.';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function chatFormatTimeAbsolute(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function chatFormatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
function chatAvatarHTML(profile, size = 40) {
  if (profile && profile.avatar_url) {
    return `<img src="${profile.avatar_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  }
  const name = (profile && profile.username) ? profile.username : '?';
  return name.charAt(0).toUpperCase();
}

function getRelativeTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  
  const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSecs < 5) {
    return 'Just now';
  }
  if (diffSecs < 60) {
    return `${diffSecs}s ago`;
  }
  
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function getMessageStatusHtml(msg) {
  const isSent = msg.sender_id === currentUserId;
  const timeStr = chatFormatTimeAbsolute(msg.created_at);
  let statusText = '';
  
  if (isSent) {
    const status = msg.status || (msg.is_read ? 'read' : 'sent');
    if (status === 'read') {
      statusText = `Seen ${getRelativeTime(msg.read_at || msg.created_at)}`;
    } else if (status === 'delivered') {
      statusText = `Delivered ${getRelativeTime(msg.delivered_at || msg.created_at)}`;
    } else {
      statusText = 'Just now';
    }
  } else {
    statusText = `Received ${getRelativeTime(msg.created_at)}`;
  }
  
  return `<span class="status-time-part">${timeStr}</span> <span class="status-dot">•</span> <span class="status-text-part">${statusText}</span>`;
}

function updateAllRelativeTimes() {
  if (!activeChatFriendId) return;
  const msgs = chatMessagesCache[activeChatFriendId] || [];
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const statusEls = container.querySelectorAll('.msg-status-text');
  statusEls.forEach(el => {
    const msgId = el.getAttribute('data-msg-id');
    const msg = msgs.find(m => m.id === msgId);
    if (msg) {
      el.innerHTML = getMessageStatusHtml(msg);
    }
  });
}

async function markAllSentMessagesDelivered() {
  if (!currentUserId) return;
  try {
    const now = new Date().toISOString();
    await db.from('messages')
      .update({ status: 'delivered', delivered_at: now })
      .eq('receiver_id', currentUserId)
      .eq('status', 'sent');
  } catch (err) {
    console.warn('Failed to mark incoming messages as delivered:', err);
  }
}

async function markMessageDelivered(msgId) {
  const now = new Date().toISOString();
  try {
    await db.from('messages')
      .update({ status: 'delivered', delivered_at: now })
      .eq('id', msgId)
      .eq('status', 'sent');
  } catch (err) {
    console.warn('Failed to mark message as delivered:', err);
  }
}

// ── Load Chats Section ──────────────────────────────────────────

async function loadChats() {
  const list = document.getElementById('chat-list');
  if (!list) return;
  list.innerHTML = '<div class="chat-msgs-loading"><i class="fa fa-spinner fa-spin"></i> Loading...</div>';

  // Mark any sent messages received by me as delivered
  await markAllSentMessagesDelivered();

  try {
    // Get accepted friends
    const { data: friendships } = await db.from('friends')
      .select('*')
      .or(`user_id.eq.${currentUserId},friend_id.eq.${currentUserId}`)
      .eq('status', 'accepted');

    if (!friendships || friendships.length === 0) {
      list.innerHTML = `<div class="chat-list-empty">
        <i class="fa fa-user-friends"></i>
        <p>No friends yet.<br/>Add friends to start chatting!</p>
      </div>`;
      return;
    }

    const friendIds = friendships.map(f => f.user_id === currentUserId ? f.friend_id : f.user_id);

    // Get profiles for all friends
    const { data: profiles } = await db.from('profiles')
      .select('id, username, avatar_url')
      .in('id', friendIds);

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: presences } = await db.from('user_presence')
      .select('user_id, last_seen')
      .in('user_id', friendIds)
      .gte('last_seen', fiveMinutesAgo);

    const activeMap = {};
    if (presences) presences.forEach(p => activeMap[p.user_id] = true);

    chatFriendsCache = profiles || [];
    chatFriendsCache.forEach(p => p.isOnline = !!activeMap[p.id]);

    // Get last message for each friend
    const convos = await Promise.all(friendIds.map(async (fid) => {
      const { data: msgs } = await db.from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${fid}),and(sender_id.eq.${fid},receiver_id.eq.${currentUserId})`)
        .order('created_at', { ascending: false })
        .limit(1);

      const { count } = await db.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', currentUserId)
        .eq('sender_id', fid)
        .eq('is_read', false);

      return { friendId: fid, lastMsg: msgs?.[0] || null, unread: count || 0 };
    }));

    // Sort by last message time (most recent first)
    convos.sort((a, b) => {
      if (!a.lastMsg && !b.lastMsg) return 0;
      if (!a.lastMsg) return 1;
      if (!b.lastMsg) return -1;
      return new Date(b.lastMsg.created_at) - new Date(a.lastMsg.created_at);
    });

    // Total unread
    const totalUnread = convos.reduce((sum, c) => sum + c.unread, 0);
    updateChatBadge(totalUnread);

    list.innerHTML = '';
    convos.forEach(convo => {
      const friend = profiles.find(p => p.id === convo.friendId);
      if (!friend) return;
      const item = buildConvoItem(friend, convo.lastMsg, convo.unread);
      list.appendChild(item);
    });

    // Subscribe to real-time incoming messages
    subscribeToChatMessages();

  } catch (err) {
    console.error('[Chat] loadChats error:', err);
    list.innerHTML = `<div class="chat-list-empty"><i class="fa fa-exclamation-circle"></i><p>Error loading chats</p></div>`;
  }
}

function buildConvoItem(friend, lastMsg, unread) {
  const div = document.createElement('div');
  div.className = 'chat-convo-item';
  div.id = `convo-${friend.id}`;
  div.onclick = () => openChat(friend);

  let preview = 'No messages yet';
  if (lastMsg) {
    if (lastMsg.type === 'timetable') preview = '📅 Shared a timetable';
    else if (lastMsg.type === 'file') preview = '📁 Shared a file';
    else if (lastMsg.type === 'plan') preview = '✅ Shared a plan';
    else preview = lastMsg.content || '';
    if (preview.length > 40) preview = preview.substring(0, 40) + '...';
    if (lastMsg.sender_id === currentUserId) preview = 'You: ' + preview;
  }

  const timeStr = lastMsg ? chatFormatTime(lastMsg.created_at) : '';

  div.innerHTML = `
    <div class="chat-convo-avatar">
      ${friend.avatar_url ? `<img src="${friend.avatar_url}" />` : friend.username.charAt(0).toUpperCase()}
      ${friend.isOnline ? '<span class="chat-online-dot"></span>' : ''}
    </div>
    <div class="chat-convo-body">
      <div class="chat-convo-name">${friend.username}</div>
      <div class="chat-convo-preview">${preview}</div>
    </div>
    <div class="chat-convo-meta">
      <span class="chat-convo-time">${timeStr}</span>
      ${unread > 0 ? `<span class="chat-convo-badge">${unread}</span>` : ''}
    </div>
  `;
  return div;
}

function updateChatBadge(count) {
  const badge = document.getElementById('chat-unread-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function filterChatList(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('.chat-convo-item').forEach(el => {
    const name = el.querySelector('.chat-convo-name')?.textContent.toLowerCase() || '';
    el.style.display = name.includes(q) ? '' : 'none';
  });
}

// ── Open a Chat ─────────────────────────────────────────────────

async function openChat(friend) {
  activeChatFriendId = friend.id;
  activeChatFriendProfile = friend;

  // Highlight active convo
  document.querySelectorAll('.chat-convo-item').forEach(el => el.classList.remove('active'));
  const convoItem = document.getElementById(`convo-${friend.id}`);
  if (convoItem) convoItem.classList.add('active');

  // Update header
  const headerAvatar = document.getElementById('chat-header-avatar');
  const headerName = document.getElementById('chat-header-name');
  const headerStatus = document.getElementById('chat-header-status');
  if (headerAvatar) headerAvatar.innerHTML = friend.avatar_url ? `<img src="${friend.avatar_url}" />` : friend.username.charAt(0).toUpperCase();
  if (headerName) headerName.textContent = friend.username;
  if (headerStatus) {
    headerStatus.textContent = friend.isOnline ? 'Online' : 'Offline';
    headerStatus.style.color = friend.isOnline ? 'var(--green)' : 'var(--text3)';
  }

  // Show chat active panel
  document.getElementById('chat-window-empty').style.display = 'none';
  document.getElementById('chat-active').style.display = 'flex';

  // Mobile
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) chatWindow.classList.add('mobile-open');

  // Close share bar
  closeShareBar();

  // Focus input
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (input) input.focus();
  }, 100);

  // Mark as read first so they load with the updated status
  await markMessagesRead(friend.id);

  // Load messages
  await loadChatMessages(friend.id);
}

function closeChatWindow() {
  activeChatFriendId = null;
  activeChatFriendProfile = null;
  document.getElementById('chat-window-empty').style.display = 'flex';
  document.getElementById('chat-active').style.display = 'none';
  const chatWindow = document.getElementById('chat-window');
  if (chatWindow) chatWindow.classList.remove('mobile-open');
  document.querySelectorAll('.chat-convo-item').forEach(el => el.classList.remove('active'));
}

// ── Load Messages ───────────────────────────────────────────────

async function loadChatMessages(friendId) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  container.innerHTML = '<div class="chat-msgs-loading"><i class="fa fa-spinner fa-spin"></i> Loading messages...</div>';

  try {
    const { data: msgs } = await db.from('messages')
      .select('*')
      .or(`and(sender_id.eq.${currentUserId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${currentUserId})`)
      .order('created_at', { ascending: true });

    chatMessagesCache[friendId] = msgs || [];
    renderMessages(msgs || [], container);
    scrollChatToBottom();

  } catch (err) {
    container.innerHTML = '<div class="chat-msgs-loading">Error loading messages</div>';
  }
}

function renderMessages(msgs, container) {
  if (!msgs || msgs.length === 0) {
    container.innerHTML = `
      <div class="chat-msgs-loading" style="flex-direction:column;gap:12px;padding:60px 20px;">
        <div style="font-size:2.5rem;">⚡</div>
        <span style="font-weight:600;color:var(--text2);">No messages yet</span>
        <span style="font-size:0.8rem;color:var(--text3);max-width:200px;text-align:center;line-height:1.6;">Start the conversation — share your focus session, a study plan, or just say hello!</span>
      </div>`;
    return;
  }

  // Build into a fragment first so if anything throws, the container keeps old content
  const frag = document.createDocumentFragment();
  let lastDate = '';
  let lastSenderId = null;
  let lastTimestamp = null;
  const GROUP_THRESHOLD_MS = 3 * 60 * 1000;

  for (let i = 0; i < msgs.length; i++) {
    try {
      const msg = msgs[i];
      if (!msg) continue;
      const dateLabel = chatFormatDate(msg.created_at);
      if (dateLabel !== lastDate) {
        const sep = document.createElement('div');
        sep.className = 'chat-date-sep';
        sep.innerHTML = `<span>${dateLabel || 'Today'}</span>`;
        frag.appendChild(sep);
        lastDate = dateLabel;
        lastSenderId = null;
      }

      const msgTime = msg.created_at ? new Date(msg.created_at).getTime() : Date.now();
      const timeDiff = lastTimestamp ? (msgTime - lastTimestamp) : Infinity;
      const isSameSender = msg.sender_id === lastSenderId;
      const isGrouped = isSameSender && timeDiff < GROUP_THRESHOLD_MS;

      lastSenderId = msg.sender_id;
      lastTimestamp = msgTime;

      const nextMsg = msgs[i + 1];
      const nextIsSame = nextMsg && nextMsg.sender_id === msg.sender_id &&
        nextMsg.created_at && (new Date(nextMsg.created_at).getTime() - msgTime) < GROUP_THRESHOLD_MS &&
        chatFormatDate(nextMsg.created_at) === dateLabel;

      let groupClass = '';
      if (isGrouped && nextIsSame) groupClass = 'group-mid';
      else if (isGrouped && !nextIsSame) groupClass = 'group-last';
      else if (!isGrouped && nextIsSame) groupClass = 'group-first';

      frag.appendChild(buildMessageRow(msg, isGrouped, groupClass));
    } catch (err) {
      console.warn('[Chat] Skipping bad message at index', i, err);
    }
  }

  // Only clear & replace after successful build
  container.innerHTML = '';
  container.appendChild(frag);
}

function buildMessageRow(msg, isGrouped = false, groupClass = '') {
  const isSent = msg.sender_id === currentUserId;
  const row = document.createElement('div');
  row.className = `msg-row ${isSent ? 'sent' : 'received'} ${groupClass}`;
  if (isGrouped) row.classList.add('grouped');
  row.id = `msg-${msg.id}`;

  const profile = isSent ? currentUserProfile : activeChatFriendProfile;
  const avatarHTML = profile?.avatar_url
    ? `<img src="${profile.avatar_url}" />`
    : (profile?.username || '?').charAt(0).toUpperCase();

  // Show avatar only on the last message in a group (or standalone)
  // group-mid and group-first hide the avatar via a placeholder
  const showAvatar = !isGrouped || groupClass === 'group-last';
  const avatarEl = showAvatar
    ? `<div class="msg-avatar-sm">${avatarHTML}</div>`
    : `<div class="msg-avatar-placeholder"></div>`;

  let bubbleContent = '';
  if (msg.type === 'text' || !msg.type) {
    bubbleContent = `<div class="msg-bubble" onclick="toggleMobileActions(event, '${msg.id}')">${escapeHtml(msg.content)}</div>`;
  } else {
    bubbleContent = `<div onclick="toggleMobileActions(event, '${msg.id}')">${buildSharedCard(msg)}</div>`;
  }

  let reactionsHtml = '';
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    reactionsHtml = '<div class="msg-reactions-list">';
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      if (users.length > 0) {
        const reactedByMe = users.includes(currentUserId);
        reactionsHtml += `<div class="reaction-badge ${reactedByMe ? 'reacted-by-me' : ''}" onclick="toggleReaction('${msg.id}', '${emoji}')">
          ${emoji} <span>${users.length}</span>
        </div>`;
      }
    }
    reactionsHtml += '</div>';
  }

  row.innerHTML = `
    ${avatarEl}
    <div class="msg-content-wrapper">
      <div class="msg-bubble-row">
        ${bubbleContent}
        <div class="msg-actions-bar">
          <div class="quick-emojis">
            <button class="quick-emoji-btn" onclick="toggleReaction('${msg.id}', '🔥')" type="button">🔥</button>
            <button class="quick-emoji-btn" onclick="toggleReaction('${msg.id}', '❤️')" type="button">❤️</button>
            <button class="quick-emoji-btn" onclick="toggleReaction('${msg.id}', '💡')" type="button">💡</button>
            <button class="quick-emoji-btn" onclick="toggleReaction('${msg.id}', '🎯')" type="button">🎯</button>
          </div>
          <div class="actions-separator"></div>
          <div class="action-btn-wrap">
            <button class="action-bar-btn emoji-trigger" onclick="showReactionPicker('${msg.id}', this)" type="button">
              <i class="fa-regular fa-smile"></i>
            </button>
            <div class="action-tooltip">React</div>
          </div>
          <button class="action-bar-btn" onclick="copyMessageText('${msg.id}')" type="button" title="Copy">
            <i class="fa-regular fa-copy"></i>
          </button>
          <button class="action-bar-btn" onclick="showMoreMessageActions('${msg.id}', this)" type="button" title="More">
            <i class="fa fa-ellipsis-h"></i>
          </button>
        </div>
      </div>
      ${reactionsHtml}
      <div class="msg-status-text" data-msg-id="${msg.id}">${getMessageStatusHtml(msg)}</div>
    </div>
  `;
  return row;
}

function buildSharedCard(msg) {
  const att = msg.attachment || {};
  let iconClass = '', icon = '', title = '', meta = '', typeLabel = '', actionLabel = '', onClickFn = '';

  if (msg.type === 'timetable') {
    iconClass = 'timetable'; icon = 'fa-calendar-alt';
    title = att.name || 'Timetable';
    meta = att.slots ? `${att.slots} slots` : '';
    typeLabel = 'Timetable'; actionLabel = 'View';
    onClickFn = `viewSharedTimetable(${JSON.stringify(att).replace(/"/g, '&quot;')})`;
  } else if (msg.type === 'file') {
    iconClass = 'file'; icon = 'fa-file';
    title = att.name || 'File';
    meta = att.size || '';
    typeLabel = 'File'; actionLabel = 'Open';
    onClickFn = `openSharedFile('${att.url}')`;
  } else if (msg.type === 'plan') {
    iconClass = 'plan'; icon = 'fa-tasks';
    title = att.title || 'Plan';
    const planDuration = att.duration || att.type || '';
    meta = planDuration ? `${planDuration} plan` : '';
    typeLabel = 'Plan'; actionLabel = 'View';
    onClickFn = `viewSharedPlan(${JSON.stringify(att).replace(/"/g, '&quot;')})`;
  }

  return `<div class="shared-card">
    <div class="shared-card-header">
      <div class="shared-card-icon ${iconClass}"><i class="fa ${icon}"></i></div>
      <div>
        <div class="shared-card-title">${escapeHtml(title)}</div>
        <div class="shared-card-meta">${escapeHtml(meta)}</div>
      </div>
    </div>
    <div class="shared-card-footer">
      <span class="shared-card-type-tag">${typeLabel}</span>
      <button class="shared-card-action" onclick="${onClickFn}" type="button">${actionLabel} →</button>
    </div>
  </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scrollChatToBottom() {
  const container = document.getElementById('chat-messages');
  if (container) setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
}

// ── Send Message ────────────────────────────────────────────────

let isTypingSent = false;
let typingTimeout = null;

window.handleChatInput = function() {
  try {
    const inputEl = document.getElementById('chat-input');
    const micIcon = document.getElementById('send-icon-mic');
    const planeIcon = document.getElementById('send-icon-plane');
    const sendBtn = document.getElementById('chat-send-btn');
    if (micIcon && planeIcon && sendBtn) {
      const hasText = inputEl && inputEl.value.trim().length > 0;
      if (hasText) {
        micIcon.style.display = 'none';
        planeIcon.style.display = '';
        sendBtn.style.background = 'linear-gradient(135deg, #f0c040, #d4950f)';
      } else {
        micIcon.style.display = '';
        planeIcon.style.display = 'none';
        sendBtn.style.background = 'linear-gradient(135deg, rgba(240,192,64,0.7), rgba(212,149,15,0.7))';
      }
    }
  } catch (err) {
    console.warn('[Chat] handleChatInput error:', err);
  }

  // Real-time typing notification
  try {
    if (!activeChatFriendId || !typingChannel) return;

    if (!isTypingSent) {
      isTypingSent = true;
      typingChannel.send({
        type: 'broadcast',
        event: 'typing',
        payload: { senderId: currentUserId, isTyping: true }
      });
    }

    if (typingTimeout) clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTypingSent = false;
      if (typingChannel) {
        try {
          typingChannel.send({
            type: 'broadcast',
            event: 'typing',
            payload: { senderId: currentUserId, isTyping: false }
          });
        } catch (e) {}
      }
    }, 2000);
  } catch (err) {
    console.warn('[Chat] typingChannel broadcast error:', err);
  }
};

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !activeChatFriendId) return;
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  // Reset send/mic morph
  window.handleChatInput();
  
  await sendRawMessage('text', text, null);
}

async function sendRawMessage(type, content, attachment) {
  if (!activeChatFriendId) return;

  const msg = {
    sender_id: currentUserId,
    receiver_id: activeChatFriendId,
    type,
    content: content || null,
    attachment: attachment || null,
    is_read: false
  };

  const { data, error } = await db.from('messages').insert(msg).select().single();
  if (error) { toast('Failed to send message: ' + error.message, 'error'); return; }

  // Push to local messages cache
  if (!chatMessagesCache[activeChatFriendId]) {
    chatMessagesCache[activeChatFriendId] = [];
  }
  chatMessagesCache[activeChatFriendId].push(data);

  // Append to UI immediately
  const container = document.getElementById('chat-messages');
  if (container) {
    try {
      // Remove empty-state placeholder if present
      const emptyDiv = container.querySelector('.chat-msgs-loading');
      if (emptyDiv) container.innerHTML = '';
      // Try grouped re-render
      renderMessages(chatMessagesCache[activeChatFriendId], container);
    } catch (renderErr) {
      // Fallback: just append the new message row directly
      console.warn('[Chat] renderMessages failed, using fallback:', renderErr);
      const emptyDiv = container.querySelector('.chat-msgs-loading');
      if (emptyDiv) container.innerHTML = '';
      container.appendChild(buildMessageRow(data));
    }
    scrollChatToBottom();
  }

  // Update conversation preview
  refreshConvoPreview(activeChatFriendId, data);
}

function refreshConvoPreview(friendId, msg) {
  const item = document.getElementById(`convo-${friendId}`);
  if (!item) {
    loadChats();
    return;
  }
  const preview = item.querySelector('.chat-convo-preview');
  const time = item.querySelector('.chat-convo-time');
  const badge = item.querySelector('.chat-convo-badge');

  let previewText = '';
  if (msg.type === 'timetable') previewText = 'You: 📅 Shared a timetable';
  else if (msg.type === 'file') previewText = 'You: 📁 Shared a file';
  else if (msg.type === 'plan') previewText = 'You: ✅ Shared a plan';
  else previewText = 'You: ' + (msg.content || '');
  if (previewText.length > 40) previewText = previewText.substring(0, 40) + '...';

  if (preview) preview.textContent = previewText;
  if (time) time.textContent = chatFormatTime(msg.created_at);
  if (badge) badge.remove();

  // Move to top of list
  const list = document.getElementById('chat-list');
  if (list && item.parentNode === list) list.prepend(item);
}

// ── Mark Read ───────────────────────────────────────────────────

async function markMessagesRead(friendId) {
  if (!currentUserId) return;
  const now = new Date().toISOString();
  try {
    await db.from('messages')
      .update({ status: 'read', read_at: now, delivered_at: now })
      .eq('receiver_id', currentUserId)
      .eq('sender_id', friendId)
      .eq('status', 'sent');

    await db.from('messages')
      .update({ status: 'read', read_at: now })
      .eq('receiver_id', currentUserId)
      .eq('sender_id', friendId)
      .eq('status', 'delivered');
  } catch (err) {
    console.warn('Failed to mark messages as read:', err);
  }

  // Clear badge on convo item
  const badge = document.querySelector(`#convo-${friendId} .chat-convo-badge`);
  if (badge) badge.remove();

  // Recalculate total badge
  const allBadges = document.querySelectorAll('.chat-convo-badge');
  let total = 0;
  allBadges.forEach(b => total += parseInt(b.textContent) || 0);
  updateChatBadge(total);
}

// ── Realtime ─────────────────────────────────────────────────────

function subscribeToChatMessages() {
  if (chatRealtimeChannel) {
    db.removeChannel(chatRealtimeChannel);
  }

  chatRealtimeChannel = db.channel('chat-messages-' + currentUserId)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'messages'
    }, (payload) => {
      if (payload.eventType === 'DELETE') {
        if (payload.old && payload.old.id) {
          handleDeletedMessage(payload.old.id);
        }
        return;
      }
      const msg = payload.new;
      if (!msg) return;
      if (msg.receiver_id === currentUserId || msg.sender_id === currentUserId) {
         if (payload.eventType === 'INSERT' && msg.sender_id !== currentUserId) {
            handleIncomingMessage(msg);
         } else if (payload.eventType === 'UPDATE') {
            handleUpdatedMessage(msg);
         }
      }
    })
    .subscribe();
}

function handleIncomingMessage(msg) {
  const fromFriend = msg.sender_id;

  // If this chat is currently open, render with proper grouping
  if (activeChatFriendId === fromFriend) {
    // Update local cache
    if (!chatMessagesCache[fromFriend]) {
      chatMessagesCache[fromFriend] = [];
    }
    chatMessagesCache[fromFriend].push(msg);

    const container = document.getElementById('chat-messages');
    if (container) {
      try {
        renderMessages(chatMessagesCache[fromFriend], container);
      } catch (renderErr) {
        console.warn('[Chat] renderMessages failed on incoming, using fallback:', renderErr);
        const emptyDiv = container.querySelector('.chat-msgs-loading');
        if (emptyDiv) container.innerHTML = '';
        container.appendChild(buildMessageRow(msg));
      }
      scrollChatToBottom();
    }
    // Mark as read immediately since chat is open
    markMessagesRead(fromFriend);
  } else {
    // Mark as delivered
    markMessageDelivered(msg.id);

    // Update badge on the convo item
    let convoItem = document.getElementById(`convo-${fromFriend}`);
    if (convoItem) {
      let badge = convoItem.querySelector('.chat-convo-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'chat-convo-badge';
        badge.textContent = '1';
        convoItem.querySelector('.chat-convo-meta').appendChild(badge);
      } else {
        badge.textContent = (parseInt(badge.textContent) || 0) + 1;
      }
    } else {
      // New friend texted us - reload chat list
      loadChats();
    }

    // Play subtle sound notification
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch(e) {}

    // Update total badge
    const allBadges = document.querySelectorAll('.chat-convo-badge');
    let total = 0;
    allBadges.forEach(b => total += parseInt(b.textContent) || 0);
    updateChatBadge(total);
  }

  // Update preview
  if (document.getElementById(`convo-${fromFriend}`)) {
    const item = document.getElementById(`convo-${fromFriend}`);
    const preview = item.querySelector('.chat-convo-preview');
    const time = item.querySelector('.chat-convo-time');
    let previewText = msg.type === 'timetable' ? '📅 Shared a timetable' :
                      msg.type === 'file' ? '📁 Shared a file' :
                      msg.type === 'plan' ? '✅ Shared a plan' : (msg.content || '');
    if (preview) preview.textContent = previewText;
    if (time) time.textContent = chatFormatTime(msg.created_at);
    const list = document.getElementById('chat-list');
    if (list && item.parentNode === list) list.prepend(item);
  }
}

// ── Share Pickers ────────────────────────────────────────────────

async function openSharePicker(type) {
  if (!activeChatFriendId) return;

  if (activeSharePickerType === type) {
    closeShareBar();
    return;
  }
  activeSharePickerType = type;

  const bar = document.getElementById('chat-share-bar');
  const items = document.getElementById('share-bar-items');
  const title = document.querySelector('.share-bar-title');
  if (!bar || !items) return;

  items.innerHTML = '<div class="chat-msgs-loading"><i class="fa fa-spinner fa-spin"></i></div>';
  bar.style.display = 'block';

  try {
    let data = [];
    if (type === 'timetable') {
      if (title) title.textContent = '📅 Share a Timetable:';
      const { data: tts } = await db.from('timetables').select('*').eq('user_id', currentUserId);
      data = tts || [];
      items.innerHTML = data.length === 0
        ? '<div style="color:var(--text3);font-size:.85rem;padding:8px;">No timetables created yet.</div>'
        : '';
      data.forEach(tt => {
        const el = createShareBarItem('fa-calendar-alt', 'timetable', tt.tt_type || 'Untitled', '', () => {
          shareItem('timetable', { id: tt.id, name: tt.tt_type, slots: (tt.rows || []).length, data: tt });
        });
        items.appendChild(el);
      });

    } else if (type === 'file') {
      if (title) title.textContent = '📁 Share a File:';
      const { data: files } = await db.from('files').select('*').eq('user_id', currentUserId);
      data = files || [];
      items.innerHTML = data.length === 0
        ? '<div style="color:var(--text3);font-size:.85rem;padding:8px;">No files uploaded yet.</div>'
        : '';
      data.forEach(file => {
        const sizeStr = file.size ? formatBytes(file.size) : '';
        const el = createShareBarItem('fa-file', 'file', file.name || 'Untitled', sizeStr, () => {
          shareItem('file', { id: file.id, name: file.name, url: file.url, size: sizeStr, file_type: file.type });
        });
        items.appendChild(el);
      });

    } else if (type === 'plan') {
      if (title) title.textContent = '✅ Share a Plan:';
      const { data: plans } = await db.from('plans').select('*').eq('user_id', currentUserId);
      data = plans || [];
      items.innerHTML = data.length === 0
        ? '<div style="color:var(--text3);font-size:.85rem;padding:8px;">No plans created yet.</div>'
        : '';
      data.forEach(plan => {
        const el = createShareBarItem('fa-tasks', 'plan', plan.title || 'Untitled', plan.duration || '', () => {
          shareItem('plan', { id: plan.id, title: plan.title, duration: plan.duration, type: plan.duration, activities: (plan.activities || []).length, data: plan });
        });
        items.appendChild(el);
      });
    }

  } catch(err) {
    items.innerHTML = '<div style="color:var(--red);font-size:.85rem;padding:8px;">Error loading items.</div>';
  }
}

function createShareBarItem(icon, type, name, meta, onClick) {
  const el = document.createElement('div');
  el.className = 'share-bar-item';
  const colorMap = { 'fa-calendar-alt': 'timetable', 'fa-file': 'file', 'fa-tasks': 'plan' };
  const iconClass = colorMap[icon] || '';
  el.innerHTML = `
    <div class="share-bar-item-icon ${iconClass}"><i class="fa ${icon}"></i></div>
    <div>
      <div class="share-bar-item-name">${escapeHtml(name)}</div>
      ${meta ? `<div class="share-bar-item-meta">${escapeHtml(meta)}</div>` : ''}
    </div>
    <i class="fa fa-share-square" style="color:var(--accent);font-size:0.85rem;margin-left:auto"></i>
  `;
  el.onclick = onClick;
  return el;
}

async function shareItem(type, attachment) {
  closeShareBar();
  await sendRawMessage(type, null, attachment);
  toast(`${type.charAt(0).toUpperCase() + type.slice(1)} shared!`, 'success');
}

function closeShareBar() {
  activeSharePickerType = null;
  const bar = document.getElementById('chat-share-bar');
  if (bar) bar.style.display = 'none';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── View Shared Items ────────────────────────────────────────────

function viewSharedTimetable(att) {
  const tt = att.data || att;
  if (!tt) return;
  document.getElementById('ttv-heading').innerHTML = `<i class="fa fa-calendar-alt" style="color:var(--accent)"></i> Shared: ${escapeHtml(tt.tt_type || tt.name || 'Timetable')}`;
  document.getElementById('ttv-body').innerHTML = `<div class="tt-table-wrap">
    <table class="tt-table">
      <thead><tr>${(tt.columns || []).map(c=>`<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
      <tbody>${(tt.rows||[]).map(row=>`<tr>${(row || []).map(c=>`<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
  openModal('modal-tt-view');
}

function openSharedFile(url) {
  if (!url) { toast('File URL unavailable', 'error'); return; }
  window.open(url, '_blank');
}

function viewSharedPlan(att) {
  const plan = att.data || att;
  if (!plan) return;
  
  const activities = plan.activities || [];
  const total = activities.length;
  const completed = activities.filter(a => a.status === 'done').length;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  
  document.getElementById('planv-heading').innerHTML = `<i class="fa fa-tasks" style="color:var(--accent)"></i> Shared Plan: ${escapeHtml(plan.title || 'Plan')}`;
  
  document.getElementById('planv-body').innerHTML = `
    <div style="margin-bottom:15px">
      <span class="plan-duration-pill pill-${plan.duration || 'daily'}">${getDurationLabel(plan.duration || 'daily')}</span>
      <span style="font-size:.85rem;color:var(--text2);margin-left:10px">${plan.start_date ? fmtDate(plan.start_date) : ''} – ${plan.end_date ? fmtDate(plan.end_date) : ''}</span>
    </div>
    <div class="plan-progress-bar-wrap" style="margin-bottom:20px">
      <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${pct}%"></div></div>
      <div class="plan-progress-label"><span>${completed} of ${total} completed</span><strong>${pct}% Done</strong></div>
    </div>
    <div style="max-height:300px;overflow-y:auto;margin-bottom:20px;padding-right:5px">
      ${activities.map((a, i) => `
        <div class="activity-row" style="padding:10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
          <div class="activity-text" style="color:var(--text1)">${escapeHtml(a.text)}</div>
          <div style="font-size:.85rem;color:${a.status === 'done' ? 'var(--green)' : 'var(--text3)'}">
            ${a.status === 'done' ? '<i class="fa fa-check-circle"></i> Completed' : '<i class="fa fa-circle"></i> Pending'}
          </div>
        </div>
      `)
      .join('')}
    </div>
  `;
  openModal('modal-plan-view');
}

// ── Reactions ───────────────────────────────────────────────────

function handleUpdatedMessage(msg) {
  const friendId = msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
  if (activeChatFriendId === friendId) {
    const row = document.getElementById(`msg-${msg.id}`);
    if (row) {
      const wasShown = row.classList.contains('show-status');
      const newRow = buildMessageRow(msg);
      if (wasShown) {
        newRow.classList.add('show-status');
      }
      
      // Update cache
      const msgs = chatMessagesCache[friendId] || [];
      const idx = msgs.findIndex(m => m.id === msg.id);
      if (idx !== -1) {
        msgs[idx] = msg;
      } else {
        msgs.push(msg);
      }
      
      // Add smooth fade animation on status change
      const statusTextEl = newRow.querySelector('.msg-status-text');
      if (statusTextEl) {
        statusTextEl.style.animation = 'statusFadeIn 0.5s ease-out';
      }
      
      row.parentNode.replaceChild(newRow, row);
    }
  }
}

let activeReactionPickerMsgId = null;

window.showReactionPicker = function(msgId, btnElement) {
  closeReactionPicker();
  
  activeReactionPickerMsgId = msgId;
  const picker = document.createElement('div');
  picker.className = 'msg-reaction-picker';
  picker.id = 'active-reaction-picker';
  
  const emojis = ['👍', '❤️', '😂', '🔥', '🎉', '👀'];
  emojis.forEach(emoji => {
    const el = document.createElement('div');
    el.className = 'reaction-emoji';
    el.textContent = emoji;
    el.onclick = (e) => {
      e.stopPropagation();
      toggleReaction(msgId, emoji);
      closeReactionPicker();
    };
    picker.appendChild(el);
  });

  const row = document.getElementById(`msg-${msgId}`);
  if (row) {
    const bubbleRow = row.querySelector('.msg-bubble-row');
    if (bubbleRow) bubbleRow.appendChild(picker);
    else row.appendChild(picker);
  }
};

window.closeReactionPicker = function() {
  const existing = document.getElementById('active-reaction-picker');
  if (existing) {
    existing.remove();
  }
  activeReactionPickerMsgId = null;
};

document.addEventListener('click', (e) => {
  if (activeReactionPickerMsgId) {
    const picker = document.getElementById('active-reaction-picker');
    if (picker && !picker.contains(e.target) && !e.target.closest('.emoji-trigger')) {
      closeReactionPicker();
    }
  }
  
  // Close active more menu
  const moreMenu = document.getElementById('active-more-menu');
  if (moreMenu && !moreMenu.contains(e.target) && !e.target.closest('.action-bar-btn')) {
    closeMoreMessageActions();
  }

  // Close any active mobile action bars and status texts
  if (!e.target.closest('.msg-bubble') && !e.target.closest('.msg-actions-bar') && !e.target.closest('.shared-card')) {
    document.querySelectorAll('.msg-actions-bar.active').forEach(bar => {
      bar.classList.remove('active');
    });
    document.querySelectorAll('.msg-row.show-status').forEach(row => {
      row.classList.remove('show-status');
    });
  }
});

window.toggleReaction = async function(msgId, emoji) {
  try {
    const { data: msgData, error: fetchErr } = await db.from('messages').select('reactions').eq('id', msgId).single();
    if (fetchErr) throw fetchErr;

    let reactions = msgData.reactions || {};
    let users = reactions[emoji] || [];

    if (users.includes(currentUserId)) {
      users = users.filter(id => id !== currentUserId);
    } else {
      users.push(currentUserId);
    }

    if (users.length === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = users;
    }

    const { data: updatedMsg, error } = await db.from('messages')
      .update({ reactions })
      .eq('id', msgId)
      .select().single();
      
    if (error) throw error;
    
    handleUpdatedMessage(updatedMsg);
  } catch (err) {
    console.error('Error toggling reaction:', err);
    toast('Could not update reaction', 'error');
  }
};

// ── Additional Message Actions & Mobile Utilities ─────────────────

function handleDeletedMessage(msgId) {
  const row = document.getElementById(`msg-${msgId}`);
  if (row) {
    row.remove();
  }
}

window.toggleMobileActions = function(event, msgId) {
  // If clicked a button or link inside the bubble (like View Plan), ignore it
  if (event.target.closest('button') || event.target.closest('a')) {
    return;
  }
  event.stopPropagation();
  
  const row = document.getElementById(`msg-${msgId}`);
  if (!row) return;
  
  // Toggle status visibility
  row.classList.toggle('show-status');
  
  const bar = row.querySelector('.msg-actions-bar');
  if (!bar) return;
  
  // Close all other active action bars
  document.querySelectorAll('.msg-actions-bar.active').forEach(b => {
    if (b !== bar) b.classList.remove('active');
  });
  
  bar.classList.toggle('active');
};

window.copyMessageText = async function(msgId) {
  try {
    const row = document.getElementById(`msg-${msgId}`);
    if (row) {
      const bubble = row.querySelector('.msg-bubble');
      if (bubble) {
        await navigator.clipboard.writeText(bubble.textContent);
        toast('Message copied to clipboard');
      }
    }
  } catch (err) {
    console.error('Failed to copy text:', err);
  }
};

window.showMoreMessageActions = function(msgId, btnElement) {
  closeMoreMessageActions();
  
  const picker = document.createElement('div');
  picker.className = 'msg-more-menu';
  picker.id = 'active-more-menu';
  
  const row = document.getElementById(`msg-${msgId}`);
  if (!row) return;
  const isSent = row.classList.contains('sent');
  
  const options = [
    {
      text: 'Copy Text',
      icon: 'fa-copy',
      action: () => copyMessageText(msgId)
    }
  ];
  
  if (isSent) {
    options.push({
      text: 'Delete Message',
      icon: 'fa-trash-can text-danger',
      action: () => deleteMessage(msgId)
    });
  }
  
  options.forEach(opt => {
    const item = document.createElement('div');
    item.className = 'msg-more-item';
    item.innerHTML = `<i class="fa-regular ${opt.icon}"></i> <span>${opt.text}</span>`;
    item.onclick = (e) => {
      e.stopPropagation();
      opt.action();
      closeMoreMessageActions();
    };
    picker.appendChild(item);
  });
  
  const bubbleRow = row.querySelector('.msg-bubble-row');
  if (bubbleRow) {
    bubbleRow.appendChild(picker);
  }
};

window.closeMoreMessageActions = function() {
  const existing = document.getElementById('active-more-menu');
  if (existing) {
    existing.remove();
  }
};

window.deleteMessage = async function(msgId) {
  try {
    const { error } = await db.from('messages').delete().eq('id', msgId);
    if (error) throw error;
    
    const row = document.getElementById(`msg-${msgId}`);
    if (row) {
      row.remove();
      toast('Message deleted');
    }
  } catch (err) {
    console.error('Error deleting message:', err);
    toast('Could not delete message', 'error');
  }
};
