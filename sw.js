// ================================================================
//  sw.js  —  PlanTrack System Service Worker
// ================================================================

const CACHE_NAME = 'plantrack-v5';
const DATA_CACHE = 'plantrack-data-v5';

const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './offline.js',
  './manifest.json',
  './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(FILES_TO_CACHE.map(u => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== DATA_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      }).catch(() => {
        if (event.request.destination === 'document') return caches.match('./index.html');
      });
    })
  );
});

self.addEventListener('message', async event => {
  const { type, data } = event.data || {};
  if (type === 'SAVE_ALARMS') await saveData('alarms', data);
  if (type === 'SAVE_PLANS')  await saveData('plans',  data);
  if (type === 'CHECK_NOW')   await checkAlarms();
});

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
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      if (list.length) return list[0].focus();
      return clients.openWindow('./index.html');
    })
  );
});

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
    if (!alarm.is_active) continue;
    if (alarm.time !== hhmm) continue;
    let ring = false;
    switch (alarm.repeat) {
      case 'none':     ring = !alarm.date || alarm.date === todayStr; break;
      case 'daily':    ring = true; break;
      case 'weekdays': ring = weekdays.includes(day); break;
      case 'weekends': ring = weekends.includes(day); break;
      case 'weekly':   ring = true; break;
    }
    if (ring) {
      const fireKey = `fired-${alarm.id}-${todayStr}-${hhmm}`;
      const already = await loadData(fireKey);
      if (already) continue;

      // Bug Fix: Check if app is open and focused in the foreground
      const clientsList = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
      const isVisible   = clientsList.some(c => c.visibilityState === 'visible' && c.focused);
      
      if (isVisible) {
        // App is open! Let app.js handle the ringing. Just mark as fired.
        await saveData(fireKey, true);
        continue;
      }

      await saveData(fireKey, true);
      await showNotif(`⏰ ${alarm.label}`, `Your alarm is ringing! Time: ${fmt12(alarm.time)}`, `alarm-${alarm.id}`, true);
    }
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
    body, icon:'./WhatsApp Image 2026-04-07 at 20.53.13.jpeg', badge:'./WhatsApp Image 2026-04-07 at 20.53.13.jpeg', tag,
    requireInteraction, renotify: requireInteraction,
    vibrate: requireInteraction ? [500,200,500,200,500,200,500] : [200,100,200],
    actions: [{ action:'dismiss', title:'Dismiss' }, { action:'open', title:'Open App' }]
  });
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
