// ================================================================
//  sw.js  —  PlanTrack System Service Worker
//  Strategy: Network-first for app files (always fresh),
//             cache fallback for offline, auto-reload on update.
// ================================================================

const APP_VERSION = 'plantrack-v13';
const DATA_CACHE  = 'plantrack-data-v13';

// Core app files — always try network first, cache as fallback
const APP_FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './offline.js',
  './manifest.json',
  './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
];

// Static 3rd-party files — cache-first (they never change)
const STATIC_FILES = [
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ── INSTALL: pre-cache everything ───────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_VERSION)
      .then(cache => Promise.allSettled(
        [...APP_FILES, ...STATIC_FILES].map(u => cache.add(u).catch(() => {}))
      ))
      .then(() => self.skipWaiting()) // activate immediately
  );
});

// ── ACTIVATE: delete old caches, claim all clients ──────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== APP_VERSION && k !== DATA_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
      .then(() => cleanupOldFiredMarkers())
      .then(() => {
        // Tell ALL open tabs a new version is live → app.js reloads them
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clients => {
            clients.forEach(client => {
              client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION });
            });
          });
      })
  );
});

// ── FETCH: network-first for app files, cache-first for static ──
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;

  const url      = event.request.url;
  const isStatic = STATIC_FILES.some(f => url.startsWith(f));

  if (isStatic) {
    // Cache-first for 3rd party CDN assets
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res && res.status === 200)
            caches.open(APP_VERSION).then(c => c.put(event.request, res.clone()));
          return res;
        });
      })
    );
    return;
  }

  // Network-first for all own app files — always fresh from server
  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(APP_VERSION).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => {
        // Offline fallback
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.destination === 'document')
            return caches.match('./index.html');
        });
      })
  );
});

// ── MESSAGES from app.js ─────────────────────────────────────────
self.addEventListener('message', async event => {
  const { type, data } = event.data || {};
  if (type === 'SAVE_ALARMS') { await saveData('alarms', data); await scheduleNextAlarms(data); }
  if (type === 'SAVE_PLANS')  await saveData('plans',  data);
  if (type === 'CHECK_NOW')   await checkAlarms();
  if (type === 'FIRE_NOTIF')  await showNotif(`⏰ ${data.label}`, `Your alarm is ringing! Time: ${fmt12(data.time)}`, `alarm-${data.id}`, true);
  if (type === 'SKIP_WAITING') self.skipWaiting();
});

async function scheduleNextAlarms(alarms) {
  if (!('showTrigger' in self.registration)) return;
  for (const alarm of alarms) {
    if (!alarm.is_active) continue;
    const nextDate = getNextAlarmDate(alarm);
    if (nextDate > Date.now()) {
      await scheduleNotification(
        `⏰ ${alarm.label}`,
        `Your alarm is ringing! Time: ${fmt12(alarm.time)}`,
        `alarm-${alarm.id}`,
        nextDate.getTime()
      );
    }
  }
}

function getNextAlarmDate(alarm) {
  const [h, m] = alarm.time.split(':').map(Number);
  let d = new Date();
  d.setHours(h, m, 0, 0);
  const now = new Date();
  if (alarm.repeat === 'none' && alarm.date) {
    const fixedDate = new Date(alarm.date + 'T00:00:00');
    d.setFullYear(fixedDate.getFullYear(), fixedDate.getMonth(), fixedDate.getDate());
    if (d < now) return new Date(0);
  } else {
    while (d < now || !shouldRingOnDay(alarm, d)) d.setDate(d.getDate() + 1);
  }
  return d;
}

function shouldRingOnDay(alarm, date) {
  const day = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][date.getDay()];
  const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
  const weekends = ['saturday','sunday'];
  switch (alarm.repeat) {
    case 'daily':    return true;
    case 'weekdays': return weekdays.includes(day);
    case 'weekends': return weekends.includes(day);
    case 'weekly':   return alarm.date ? new Date(alarm.date+'T00:00:00').getDay() === date.getDay() : true;
    default:         return true;
  }
}

self.addEventListener('periodicsync', event => {
  if (event.tag === 'alarm-check') event.waitUntil(checkAlarms());
  if (event.tag === 'plan-check')  event.waitUntil(checkPlanReminder());
});

self.addEventListener('push', event => {
  let d = { title:'⏰ PlanTrack', body:'You have a reminder!', tag:'plantrack' };
  try { d = { ...d, ...event.data.json() }; } catch(e) {}
  event.waitUntil(showNotif(d.title, d.body, d.tag, true));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { action, notification } = event;
  const alarmId = notification.tag ? notification.tag.replace('alarm-', '') : null;
  if (action === 'dismiss') { if (alarmId) event.waitUntil(markAlarmHandled(alarmId)); return; }
  if (action === 'snooze')  { event.waitUntil(handleSnooze(alarmId, notification.title)); return; }
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      if (list.length) return list[0].focus();
      return clients.openWindow('./index.html');
    })
  );
});

async function handleSnooze(alarmId, title) {
  const snoozeTime = Date.now() + (10 * 60 * 1000);
  const label = title.replace('⏰ ', '');
  await scheduleNotification(`⏰ [Snoozed] ${label}`, `Snoozed alarm is ringing!`, `alarm-${alarmId}-snooze`, snoozeTime);
  const cl = await self.clients.matchAll();
  cl.forEach(c => c.postMessage({ type: 'ALARM_SNOOZED', alarmId, snoozeTime }));
}

async function markAlarmHandled(alarmId) {
  const todayStr = new Date().toISOString().split('T')[0];
  await saveData(`fired-${alarmId}-${todayStr}`, true);
  const cl = await self.clients.matchAll();
  cl.forEach(c => c.postMessage({ type: 'ALARM_DISMISSED', alarmId }));
}

async function checkAlarms() {
  const alarms = await loadData('alarms');
  if (!alarms || !alarms.length) return;
  const now      = new Date();
  const hhmm     = p2(now.getHours())+':'+p2(now.getMinutes());
  const day      = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];
  const todayStr = now.toISOString().split('T')[0];
  const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
  const weekends = ['saturday','sunday'];
  for (const alarm of alarms) {
    if (!alarm.is_active || alarm.time !== hhmm) continue;
    let ring = false;
    switch (alarm.repeat) {
      case 'none':     ring = !alarm.date || alarm.date === todayStr; break;
      case 'daily':    ring = true; break;
      case 'weekdays': ring = weekdays.includes(day); break;
      case 'weekends': ring = weekends.includes(day); break;
      case 'weekly':   ring = true; break;
    }
    if (!ring) continue;
    const fireKey = `fired-${alarm.id}-${todayStr}-${hhmm}`;
    if (await loadData(fireKey)) continue;
    const cl        = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const isVisible = cl.some(c => c.visibilityState === 'visible' && c.focused);
    if (isVisible) { await saveData(fireKey, true); continue; }
    await saveData(fireKey, true);
    await showNotif(`⏰ ${alarm.label}`, `Your alarm is ringing! Time: ${fmt12(alarm.time)}`, `alarm-${alarm.id}`, true);
  }
}

async function checkPlanReminder() {
  const now = new Date();
  if (now.getHours() !== 8 || now.getMinutes() > 1) return;
  const todayStr = now.toISOString().split('T')[0];
  const firedKey = `plan-reminder-${todayStr}`;
  if (await loadData(firedKey)) return;
  const plans = await loadData('plans');
  if (!plans?.length) return;
  let total = 0; let names = [];
  for (const plan of plans) {
    if (plan.end_date < todayStr) continue;
    const inc = (plan.activities||[]).filter(a=>a.status!=='done');
    if (inc.length) { total += inc.length; names.push(`${plan.title} (${inc.length} left)`); }
  }
  if (!total) return;
  const body = names.length<=3 ? `Pending: ${names.join(', ')}` : `You have ${total} activities pending across ${names.length} plans.`;
  await showNotif('📋 Daily Activity Reminder', body, 'daily-plan-reminder', false);
  await saveData(firedKey, true);
}

async function showNotif(title, body, tag, requireInteraction) {
  return self.registration.showNotification(title, {
    body, tag, requireInteraction,
    icon:    './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    badge:   './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    renotify: requireInteraction,
    vibrate: requireInteraction ? [500,200,500,200,500,200,500] : [200,100,200],
    actions: [
      { action:'snooze',  title:'Snooze (10m)', icon:'./WhatsApp Image 2026-04-07 at 20.53.13.jpeg' },
      { action:'dismiss', title:'Dismiss',      icon:'./WhatsApp Image 2026-04-07 at 20.53.13.jpeg' },
      { action:'open',    title:'Open App' }
    ]
  });
}

async function scheduleNotification(title, body, tag, timestamp) {
  const opts = {
    body, tag,
    icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    badge: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    requireInteraction: true, renotify: true,
    vibrate: [500,200,500,200,500,200,500],
    actions: [{ action:'snooze', title:'Snooze (10m)' }, { action:'dismiss', title:'Dismiss' }]
  };
  if ('showTrigger' in self.registration) {
    opts.showTrigger = new TimestampTrigger(timestamp);
    return self.registration.showNotification(title, opts);
  }
  if (timestamp - Date.now() <= 0) return self.registration.showNotification(title, opts);
  return Promise.resolve();
}

async function cleanupOldFiredMarkers() {
  const cache = await caches.open(DATA_CACHE);
  const keys  = await cache.keys();
  for (const req of keys) {
    if (req.url.includes('fired-')) await cache.delete(req);
  }
}

async function saveData(key, value) {
  const cache = await caches.open(DATA_CACHE);
  await cache.put(
    new Request(`/plantrack-data/${key}`),
    new Response(JSON.stringify(value), { headers:{ 'Content-Type':'application/json' } })
  );
}

async function loadData(key) {
  try {
    const cache = await caches.open(DATA_CACHE);
    const res   = await cache.match(new Request(`/plantrack-data/${key}`));
    if (!res) return null;
    return await res.json();
  } catch(e) { return null; }
}

function p2(n) { return String(n).padStart(2,'0'); }
function fmt12(t) {
  if (!t) return '';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${p2(m)} ${h>=12?'PM':'AM'}`;
}
