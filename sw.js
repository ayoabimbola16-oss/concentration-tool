// ================================================================
//  sw.js  —  PlanTrack System Service Worker
// ================================================================

const CACHE_NAME = 'plantrack-v11';
const DATA_CACHE = 'plantrack-data-v11';

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
      .then(() => cleanupOldFiredMarkers())
  );
});

async function cleanupOldFiredMarkers() {
  const cache = await caches.open(DATA_CACHE);
  const keys  = await cache.keys();
  const now   = Date.now();
  for (const req of keys) {
    if (req.url.includes('fired-')) {
      // Check if old (e.g. from yesterday)
      // For simplicity, we just clear fired markers on activation
      await cache.delete(req);
    }
  }
}

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
  if (type === 'SAVE_ALARMS') {
    await saveData('alarms', data);
    await scheduleNextAlarms(data);
  }
  if (type === 'SAVE_PLANS')  await saveData('plans',  data);
  if (type === 'CHECK_NOW')   await checkAlarms();
  if (type === 'FIRE_NOTIF')  await showNotif(`⏰ ${data.label}`, `Your alarm is ringing! Time: ${fmt12(data.time)}`, `alarm-${data.id}`, true);
});

async function scheduleNextAlarms(alarms) {
  if (!('showTrigger' in self.registration)) return;
  
  // Clear existing triggers if possible (browser handles replacement by tag usually)
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

  const now      = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const dayName  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];

  if (alarm.repeat === 'none' && alarm.date) {
    const fixedDate = new Date(alarm.date + 'T00:00:00');
    d.setFullYear(fixedDate.getFullYear(), fixedDate.getMonth(), fixedDate.getDate());
    if (d < now) return new Date(0); // Expired
  } else {
    // Repeating alarms
    while (d < now || !shouldRingOnDay(alarm, d)) {
      d.setDate(d.getDate() + 1);
    }
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

  if (action === 'dismiss') {
    if (alarmId) event.waitUntil(markAlarmHandled(alarmId));
    return;
  }

  if (action === 'snooze') {
    event.waitUntil(handleSnooze(alarmId, notification.title));
    return;
  }

  // Default: Open App
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      if (list.length) return list[0].focus();
      return clients.openWindow('./index.html');
    })
  );
});

async function handleSnooze(alarmId, title) {
  const snoozeTime = Date.now() + (10 * 60 * 1000); // 10 minutes
  const label = title.replace('⏰ ', '');
  
  // Schedule a new notification for later
  await scheduleNotification(`⏰ [Snoozed] ${label}`, `Snoozed alarm is ringing!`, `alarm-${alarmId}-snooze`, snoozeTime);
  
  // Notify clients
  const clientsList = await self.clients.matchAll();
  clientsList.forEach(c => c.postMessage({ type: 'ALARM_SNOOZED', alarmId, snoozeTime }));
}

async function markAlarmHandled(alarmId) {
  const todayStr = new Date().toISOString().split('T')[0];
  const fireKey = `fired-${alarmId}-${todayStr}`;
  await saveData(fireKey, true);
  
  // Notify clients
  const clientsList = await self.clients.matchAll();
  clientsList.forEach(c => c.postMessage({ type: 'ALARM_DISMISSED', alarmId }));
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
    if (!alarm.is_active) continue;
    if (alarm.time !== hhmm) continue;
    
    // Check if within the same minute is enough, but to be sure:
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
  const options = {
    body,
    icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    badge: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    tag,
    requireInteraction,
    renotify: requireInteraction,
    vibrate: requireInteraction ? [500, 200, 500, 200, 500, 200, 500] : [200, 100, 200],
    actions: [
      { action: 'snooze', title: 'Snooze (10m)', icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg' },
      { action: 'dismiss', title: 'Dismiss', icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg' },
      { action: 'open', title: 'Open App' }
    ]
  };
  return self.registration.showNotification(title, options);
}

async function scheduleNotification(title, body, tag, timestamp) {
  const options = {
    body,
    icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    badge: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    tag,
    requireInteraction: true,
    renotify: true,
    vibrate: [500, 200, 500, 200, 500, 200, 500],
    actions: [
      { action: 'snooze', title: 'Snooze (10m)' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  // Try to use Notification Triggers if supported
  if ('showTrigger' in self.registration) {
    options.showTrigger = new TimestampTrigger(timestamp);
    return self.registration.showNotification(title, options);
  } else {
    // Fallback: If trigger not supported, we can't schedule precisely offline.
    // We'll rely on the existing periodicsync loop or immediate show if timestamp is now.
    const delay = timestamp - Date.now();
    if (delay <= 0) {
       return self.registration.showNotification(title, options);
    }
    // If delay > 0 and no triggers, we don't show anything now.
    // The background loop (checkAlarms) will handle it when the time comes.
  }
  return Promise.resolve();
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
