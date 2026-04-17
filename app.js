// ═══════════════════════════════════════════════════════════════
//  app.js  —  PlanTrack Concentration Tool
//  Fixed: login bug, profile page, alarm off indicator, mobile
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── Wait for Supabase to load ────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);

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
  return audioCtx;
}

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
    // Step 1: find email from username
    const { data: profile, error: profileError } = await db
      .from('profiles')
      .select('email')
      .eq('username', username)
      .maybeSingle();

    if (profileError) {
      showAuthMsg('Error looking up username. Please try again.');
      return;
    }
    if (!profile) {
      showAuthMsg('Username not found. Please check and try again.');
      return;
    }

    // Step 2: sign in with email + password
    const { data, error } = await db.auth.signInWithPassword({
      email: profile.email,
      password: password,
    });

    if (error) {
      showAuthMsg(error.message || 'Incorrect password. Please try again.');
      return;
    }

    if (!data || !data.user) {
      showAuthMsg('Login failed. Please try again.');
      return;
    }

    closeAuthMsg();
    await initApp(data.user);

  } catch (err) {
    showAuthMsg('An error occurred. Please check your internet connection.');
  }
}

async function register() {
  const username = document.getElementById('r-user').value.trim();
  const email    = document.getElementById('r-email').value.trim();
  const password = document.getElementById('r-pass').value;

  if (!username) { showAuthMsg('Please enter a username.'); return; }
  if (!email)    { showAuthMsg('Please enter your email.'); return; }
  if (!password) { showAuthMsg('Please enter a password.'); return; }
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
      await db.from('profiles').insert({ id: data.user.id, username, email });
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
  const { data: profile } = await db.from('profiles').select('*').eq('id', user.id).single();
  currentUserProfile = profile;

  const displayName = profile?.username || user.email;
  const dispEl = document.getElementById('disp-user');
  if (dispEl) dispEl.textContent = displayName;

  // Set profile avatar initial
  renderAvatar();

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';

  await loadUserSounds();
  showSection('alarms');
  startAlarmChecker();
  startAlarmCountdown();
  buildSoundGrid();
  if (window.initSocial) window.initSocial();
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

  const loaders = {
    alarms:    loadAlarms,
    timetable: loadTimetables,
    files:     loadFolders,
    plans:     loadPlans,
    profile:   loadProfile,
    social:    () => { if(window.loadFriends) loadFriends(); if(window.loadSharedWithMe) loadSharedWithMe(); },
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
  const [alarms, timetables, folders, plans] = await Promise.all([
    db.from('alarms').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
    db.from('timetables').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
    db.from('folders').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
    db.from('plans').select('*', {count:'exact',head:true}).eq('user_id', currentUserId),
  ]);

  const setEl = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val||0; };
  setEl('stat-alarms',     alarms.count);
  setEl('stat-timetables', timetables.count);
  setEl('stat-folders',    folders.count);
  setEl('stat-plans',      plans.count);
}

function openEditProfileModal() {
  const inp = document.getElementById('edit-username-input');
  if (inp) inp.value = currentUserProfile?.username || '';
  openModal('modal-edit-profile');
}

async function saveProfile() {
  const val = document.getElementById('edit-username-input').value.trim();
  if (!val) { toast('Username cannot be empty', 'error'); return; }
  const { error } = await db.from('profiles').update({ username: val }).eq('id', currentUserId);
  if (error) { toast('Error: ' + error.message, 'error'); return; }
  currentUserProfile.username = val;
  toast('Profile updated!', 'success');
  closeModal('modal-edit-profile');
  document.getElementById('disp-user').textContent = val;
  loadProfile();
}

async function uploadAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { toast('Please select an image', 'error'); return; }
  if (file.size > 5 * 1024 * 1024) { toast('Image too large. Maximum 5MB.', 'error'); return; }

  toast('Uploading picture...', 'info');

  // ── Step 1: Try to upload to Supabase Storage ──
  const path = `${currentUserId}/avatar_${Date.now()}`;
  const { error: upErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: true });

  if (upErr) {
    // Storage upload failed — fall back to local base64 storage
    console.warn('Storage upload failed, using local fallback:', upErr.message);
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const localKey = `avatar_${currentUserId}`;
      try {
        localStorage.setItem(localKey, dataUrl);
        if (currentUserProfile) currentUserProfile.avatar_url = null; // clear so local is used
        renderAvatar();
        toast('Profile picture saved locally!', 'success');
      } catch (storageErr) {
        toast('Image too large to store locally. Try a smaller image.', 'error');
      }
    };
    reader.readAsDataURL(file);
    event.target.value = '';
    return;
  }

  // ── Step 2: Get public URL ──
  const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const publicUrl = urlData?.publicUrl;

  if (!publicUrl) {
    toast('Could not get image URL. Try again.', 'error');
    event.target.value = '';
    return;
  }

  // ── Step 3: Try to save URL to profiles table ──
  const { error: dbErr } = await db.from('profiles').update({ avatar_url: publicUrl }).eq('id', currentUserId);

  if (dbErr) {
    // DB column missing or update failed — save to localStorage as fallback
    console.warn('DB avatar save failed (column may be missing):', dbErr.message);
    const localKey = `avatar_${currentUserId}`;
    localStorage.setItem(localKey, publicUrl);
    if (currentUserProfile) currentUserProfile.avatar_url = null; // ensure local key is used
    renderAvatar();
    toast('Profile picture saved!', 'success');
  } else {
    // Full success — save in memory and clear local cache
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
  if (file.size > 15 * 1024 * 1024) {
    toast('File too large. Maximum size is 15MB.', 'error');
    event.target.value = ''; return;
  }
  toast('Uploading your music...', 'info');
  const path = `${currentUserId}/sounds/${Date.now()}_${file.name}`;
  const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: true });
  if (uploadErr) { toast('Upload failed: '+uploadErr.message, 'error'); return; }
  const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  const { error: dbErr } = await db.from('user_sounds').insert({
    user_id: currentUserId,
    name: file.name.replace(/\.[^/.]+$/, ''),
    path, url: urlData.publicUrl, size: file.size,
  });
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
    .eq('user_id',currentUserId).eq('is_active',true).eq('time',hhmm);
  if (!data?.length) return;
  for (const alarm of data) {
    if (ringActive) break;
    const ringEl = document.getElementById('alarm-ring');
    if (ringEl && ringEl.style.display === 'flex') break;
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

function dismissAlarm() {
  const activeId = ringAlarmId;
  const repeat   = ringAlarmRepeat;
  
  ringActive = false; 
  ringAlarmId = null; 
  ringAlarmRepeat = 'none';
  
  stopSound();
  document.getElementById('alarm-ring').style.display = 'none';
  
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type:'CLEAR_ALARMS' });
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

async function snoozeAlarm() {
  const activeId = ringAlarmId;
  const label = document.getElementById('ring-label').textContent;
  
  if (!activeId) { dismissAlarm(); return; }
  
  const now = new Date();
  now.setMinutes(now.getMinutes() + 10);
  const tm = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  
  const payload = { 
    user_id: currentUserId, 
    time: tm, 
    date: now.toISOString().split('T')[0], 
    label: `[Snoozed] ${label}`, 
    repeat: 'none', 
    sound: selectedSound || 'beep', 
    is_active: true 
  };
  
  await db.from('alarms').insert(payload);
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
        <button class="icon-btn del" onclick="confirmDelete('file','${f.id}','${escHtml(f.name)}')" title="Delete" type="button"><i class="fa fa-trash"></i></button>
      </div>`;
    grid.appendChild(card);
  });
}

async function handleUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length || !currentFolderId) return;
  for (const file of files) {
    const path = `${currentUserId}/${currentFolderId}/${Date.now()}_${file.name}`;
    const { error: uploadErr } = await db.storage.from(STORAGE_BUCKET).upload(path, file, { upsert:true });
    if (uploadErr) { toast('Upload failed: '+uploadErr.message,'error'); continue; }
    const { data: urlData } = db.storage.from(STORAGE_BUCKET).getPublicUrl(path);
    await db.from('files').insert({ user_id:currentUserId, folder_id:currentFolderId, name:file.name, path, url:urlData.publicUrl, size:file.size, mime:file.type });
    toast(`Uploaded: ${file.name}`,'success');
  }
  event.target.value = ''; loadFiles(currentFolderId);
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
  try {
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) await initApp(session.user);
  } catch(e) {
    console.error('Session check failed:', e);
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user && !currentUser) {
      await initApp(session.user);
    }
    if (event === 'SIGNED_OUT') {
      currentUser = null;
      document.getElementById('app').style.display = 'none';
      document.getElementById('auth-screen').style.display = 'flex';
    }
  });

  const pStartEl = document.getElementById('p-start');
  if (pStartEl) pStartEl.value = today();
})();
