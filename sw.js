// ================================================================
//  sw.js  —  PlanTrack System Service Worker
//  PLACE THIS FILE in your PlanTrack System folder (same folder as index.html)
// ================================================================

const CACHE_NAME = 'PlanTrack System-v1';
const DATA_CACHE = 'PlanTrack System-data-v1';

const FILES_TO_CACHE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './offline.js',
  './manifest.json',
  './WhatsApp Image 2026-04-07 at 21.19.20.jpeg',
  './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ── INSTALL: cache everything ────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(FILES_TO_CACHE.map(u => cache.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clear old caches ───────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== DATA_CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH: serve from cache when offline ─────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return; // always online for DB

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

// ── MESSAGES from app.js ─────────────────────────────────────────
self.addEventListener('message', async event => {
  const { type, data } = event.data || {};
  if (type === 'SAVE_ALARMS') await saveData('alarms', data);
  if (type === 'SAVE_PLANS')  await saveData('plans',  data);
  if (type === 'CHECK_NOW')   await checkAlarms();
});

// ── PERIODIC SYNC (Chrome Android) ──────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'alarm-check') event.waitUntil(checkAlarms());
  if (event.tag === 'plan-check')  event.waitUntil(checkPlanReminder());
});

// ── PUSH NOTIFICATION ────────────────────────────────────────────
self.addEventListener('push', event => {
  let d = { title: '⏰ PlanTrack System', body: 'You have a reminder!', tag: 'PlanTrack System' };
  try { d = { ...d, ...event.data.json() }; } catch(e) {}
  event.waitUntil(showNotif(d.title, d.body, d.tag, true));
});

// ── NOTIFICATION CLICK ───────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length) return list[0].focus();
      return clients.openWindow('./index.html');
    })
  );
});

// ================================================================
//  ALARM CHECKER
// ================================================================
async function checkAlarms() {
  const alarms = await loadData('alarms');
  if (!alarms || !alarms.length) return;

  const now     = new Date();
  const hhmm    = p2(now.getHours()) + ':' + p2(now.getMinutes());
  const day     = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];
  const todayStr = now.toISOString().split('T')[0];
  const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
  const weekends  = ['saturday','sunday'];

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
      // Check we haven't already fired this alarm in this minute
      const fireKey = `fired-${alarm.id}-${todayStr}-${hhmm}`;
      const alreadyFired = await loadData(fireKey);
      if (alreadyFired) continue;
      await saveData(fireKey, true);

      await showNotif(
        `⏰ ${alarm.label}`,
        `Your alarm is ringing! Time: ${fmt12(alarm.time)}`,
        `alarm-${alarm.id}`,
        true  // requireInteraction
      );
    }
  }
}

// ================================================================
//  PLAN REMINDER — fires ONCE per day at 8:00 AM
// ================================================================
async function checkPlanReminder() {
  const now  = new Date();
  const hour = now.getHours();
  const min  = now.getMinutes();

  // Only fire between 8:00 and 8:01
  if (hour !== 8 || min > 1) return;

  const todayStr  = now.toISOString().split('T')[0];
  const firedKey  = `plan-reminder-sent-${todayStr}`;
  const sent      = await loadData(firedKey);
  if (sent) return; // already sent today — do nothing

  const plans = await loadData('plans');
  if (!plans || !plans.length) return;

  let totalIncomplete = 0;
  let planNames = [];

  for (const plan of plans) {
    if (plan.end_date < todayStr) continue; // plan expired
    const incomplete = (plan.activities || []).filter(a => a.status !== 'done');
    if (incomplete.length > 0) {
      totalIncomplete += incomplete.length;
      planNames.push(`${plan.title} (${incomplete.length} left)`);
    }
  }

  if (totalIncomplete === 0) return; // nothing to remind about

  const body = planNames.length <= 3
    ? `Pending: ${planNames.join(', ')}`
    : `You have ${totalIncomplete} activities pending across ${planNames.length} plans.`;

  await showNotif(
    `📋 Daily Activity Reminder`,
    body,
    'daily-plan-reminder',
    false // don't require interaction — just a gentle reminder
  );

  // Mark as sent for today — won't fire again until tomorrow
  await saveData(firedKey, true);
}

// ================================================================
//  HELPERS
// ================================================================
async function showNotif(title, body, tag, requireInteraction) {
  return self.registration.showNotification(title, {
    body,
    icon:  './WhatsApp Image 2026-04-07 at 21.19.20.jpeg',
    badge: './WhatsApp Image 2026-04-07 at 21.19.20.jpeg',
    tag,
    requireInteraction,
    vibrate: requireInteraction ? [300,100,300,100,300] : [200,100,200],
    actions: [
      { action: 'dismiss', title: 'Dismiss' },
      { action: 'open',    title: 'Open App' }
    ]
  });
}

async function saveData(key, value) {
  const cache = await caches.open(DATA_CACHE);
  await cache.put(
    new Request(`/PlanTrack System-data/${key}`),
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  );
}

async function loadData(key) {
  try {
    const cache = await caches.open(DATA_CACHE);
    const res   = await cache.match(new Request(`/PlanTrack System-data/${key}`));
    if (!res) return null;
    return await res.json();
  } catch(e) { return null; }
}

function p2(n) { return String(n).padStart(2, '0'); }

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${p2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
