// ================================================================
//  sw.js  —  PlanTrack System Service Worker v14
//  Background alarm strategy:
//    1. TimestampTrigger — schedules exact notifications (Chrome/Android)
//    2. checkAlarms() fallback — fires when SW is woken by any event
//    3. In-app reminder messages sent to open clients at 15/10 min marks
// ================================================================

const APP_VERSION = 'plantrack-v22';
const DATA_CACHE  = 'plantrack-data-v22';

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

const STATIC_FILES = [
  'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
];

// ── INSTALL ──────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_VERSION)
      .then(cache => Promise.allSettled(
        [...APP_FILES, ...STATIC_FILES].map(u => cache.add(u).catch(() => {}))
      ))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────
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
      .then(() =>
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
          .then(clients => clients.forEach(c =>
            c.postMessage({ type: 'SW_UPDATED', version: APP_VERSION })
          ))
      )
  );
});

// ── FETCH ────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;

  const url      = event.request.url;
  const isStatic = STATIC_FILES.some(f => url.startsWith(f));

  if (isStatic) {
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

  event.respondWith(
    fetch(event.request)
      .then(res => {
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(APP_VERSION).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.destination === 'document')
            return caches.match('./index.html');
        })
      )
  );
});

// ── MESSAGES from app.js ─────────────────────────────────────────
self.addEventListener('message', async event => {
  const { type, data } = event.data || {};

  switch (type) {
    case 'SAVE_ALARMS':
      await saveData('alarms', data);
      await scheduleAllAlarmNotifications(data);
      break;

    case 'SAVE_PLANS':
      await saveData('plans', data);
      break;

    case 'CHECK_NOW':
      await checkAlarms();
      break;

    case 'FIRE_NOTIF':
      await showAlarmNotif(data.label, fmt12(data.time), `alarm-${data.id}`, true);
      break;

    case 'CANCEL_ALARM_NOTIFS':
      // Cancel all scheduled/showing notifications for this alarm
      if (data && data.alarmId) await cancelAlarmNotifications(data.alarmId);
      break;

    case 'SNOOZE_ALARM':
      if (data && data.alarmId && data.snoozeMs) {
        const label = data.label || 'Alarm';
        await scheduleOne(
          `alarm-${data.alarmId}-snooze`,
          `⏰ [Snoozed] ${label}`,
          `Your snoozed alarm is ringing!`,
          data.snoozeMs,
          true
        );
      }
      break;

    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});

// ================================================================
//  ALARM SCHEDULING — The heart of background alarm support
// ================================================================

/**
 * Schedule THREE notifications per active alarm:
 *   1. 15-minute reminder
 *   2. 10-minute reminder
 *   3. Alarm time (exact)
 *
 * Uses TimestampTrigger when available (Chrome on Android).
 * Falls back to storing the alarm and relying on checkAlarms().
 */
async function scheduleAllAlarmNotifications(alarms) {
  if (!alarms || !alarms.length) return;

  const supportsTimestampTrigger = 'showTrigger' in Notification.prototype ||
                                   'showTrigger' in self.registration;

  for (const alarm of alarms) {
    // Always cancel existing notifications first to avoid duplicates
    await cancelAlarmNotifications(alarm.id);

    if (!alarm.is_active) continue;

    const nextMs = getNextAlarmMs(alarm);
    if (!nextMs || nextMs <= Date.now()) continue;

    const minsUntil = (nextMs - Date.now()) / 60000;

    // ── Exact alarm notification ─────────────────────────────────
    if (supportsTimestampTrigger) {
      await scheduleOne(
        `alarm-${alarm.id}`,
        `⏰ ${alarm.label}`,
        `Your alarm is ringing! Tap to open PlanTrack.`,
        nextMs,
        true   // requireInteraction
      );
    }
    // (If no TimestampTrigger, checkAlarms() fallback handles it)

    // ── 15-minute reminder ───────────────────────────────────────
    const remind15Ms = nextMs - 15 * 60 * 1000;
    if (remind15Ms > Date.now() && minsUntil > 15) {
      if (supportsTimestampTrigger) {
        await scheduleOne(
          `remind15-${alarm.id}`,
          `🔔 Alarm in 15 minutes`,
          `"${alarm.label}" is coming up at ${fmt12(alarm.time)}`,
          remind15Ms,
          false
        );
      }
      // Store reminder trigger time for fallback check
      await saveData(`r15-time-${alarm.id}`, remind15Ms);
    }

    // ── 10-minute reminder ───────────────────────────────────────
    const remind10Ms = nextMs - 10 * 60 * 1000;
    if (remind10Ms > Date.now() && minsUntil > 10) {
      if (supportsTimestampTrigger) {
        await scheduleOne(
          `remind10-${alarm.id}`,
          `🔔 Alarm in 10 minutes`,
          `"${alarm.label}" is coming up at ${fmt12(alarm.time)}`,
          remind10Ms,
          false
        );
      }
      await saveData(`r10-time-${alarm.id}`, remind10Ms);
    }

    // Store alarm's scheduled time for fallback
    await saveData(`next-alarm-ms-${alarm.id}`, nextMs);
  }
}

/**
 * Schedule a single notification. Uses TimestampTrigger if supported,
 * falls back to showNotification() immediately if timestamp has passed.
 */
async function scheduleOne(tag, title, body, timestampMs, requireInteraction) {
  const opts = {
    body,
    tag,
    icon:    './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    badge:   './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    requireInteraction,
    renotify: true,
    vibrate: requireInteraction
      ? [500, 200, 500, 200, 500, 200, 500]
      : [200, 100, 200],
    data: { tag, timestampMs },
  };

  // Only add snooze/dismiss actions to actual alarm notifications (not reminders)
  if (requireInteraction) {
    opts.actions = [
      { action: 'snooze',  title: '⏰ Snooze 10m' },
      { action: 'dismiss', title: '✕ Dismiss'     },
    ];
  } else {
    opts.actions = [
      { action: 'open', title: 'Open App' },
    ];
  }

  try {
    if ('showTrigger' in self.registration && timestampMs > Date.now()) {
      opts.showTrigger = new TimestampTrigger(timestampMs);
    }
    await self.registration.showNotification(title, opts);
  } catch (e) {
    // TimestampTrigger failed silently — fallback: show immediately if overdue
    if (timestampMs <= Date.now() + 5000) {
      delete opts.showTrigger;
      await self.registration.showNotification(title, opts).catch(() => {});
    }
  }
}

/**
 * Cancel (close) all notifications belonging to an alarm.
 */
async function cancelAlarmNotifications(alarmId) {
  try {
    const notifications = await self.registration.getNotifications();
    const tags = [
      `alarm-${alarmId}`,
      `alarm-${alarmId}-snooze`,
      `remind15-${alarmId}`,
      `remind10-${alarmId}`,
    ];
    notifications
      .filter(n => tags.includes(n.tag))
      .forEach(n => n.close());
  } catch (e) {}
}

// ── PERIODIC SYNC (Chrome Android with permission) ────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'alarm-check') event.waitUntil(checkAlarms());
  if (event.tag === 'plan-check')  event.waitUntil(checkPlanReminder());
});

// ── PUSH (server-sent, future use) ───────────────────────────────
self.addEventListener('push', event => {
  let d = { title: '⏰ PlanTrack', body: 'You have a reminder!', tag: 'plantrack' };
  try { d = { ...d, ...event.data.json() }; } catch (e) {}
  event.waitUntil(showAlarmNotif(d.title, d.body, d.tag, true));
});

// ── NOTIFICATION CLICK ────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { action, notification } = event;
  const tag     = notification.tag || '';
  const alarmId = tag.replace(/^(alarm-|remind15-|remind10-)/, '').replace(/-snooze$/, '');
  const label   = notification.title.replace(/^[⏰🔔]\s*/, '').replace(/^\[Snoozed\]\s*/, '');

  if (action === 'dismiss') {
    event.waitUntil(handleDismiss(alarmId, tag));
    return;
  }

  if (action === 'snooze') {
    event.waitUntil(handleSnooze(alarmId, label));
    return;
  }

  // Default: open / focus the app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => {
        if (list.length) return list[0].focus();
        return self.clients.openWindow('./index.html');
      })
  );
});

async function handleDismiss(alarmId, tag) {
  await markAlarmFired(alarmId);
  await cancelAlarmNotifications(alarmId);
  // Tell any open app windows
  const cl = await self.clients.matchAll({ type: 'window' });
  cl.forEach(c => c.postMessage({ type: 'ALARM_DISMISSED', alarmId }));
}

async function handleSnooze(alarmId, label) {
  const snoozeMs = Date.now() + 10 * 60 * 1000;
  await cancelAlarmNotifications(alarmId);
  await scheduleOne(
    `alarm-${alarmId}-snooze`,
    `⏰ [Snoozed] ${label}`,
    `Your snoozed alarm is ringing!`,
    snoozeMs,
    true
  );
  const cl = await self.clients.matchAll({ type: 'window' });
  cl.forEach(c => c.postMessage({ type: 'ALARM_SNOOZED', alarmId, snoozeMs }));
}

// ================================================================
//  FALLBACK ALARM CHECKER
//  Runs when the SW is awoken by any event (fetch, message, sync…)
//  This is the safety net when TimestampTrigger is unavailable.
// ================================================================
async function checkAlarms() {
  const alarms = await loadData('alarms');
  if (!alarms || !alarms.length) return;

  const now      = new Date();
  const hhmm     = p2(now.getHours()) + ':' + p2(now.getMinutes());
  const day      = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];
  const todayStr = now.toISOString().split('T')[0];
  const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
  const weekends = ['saturday','sunday'];

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

  for (const alarm of alarms) {
    if (!alarm.is_active) continue;

    // ── Check exact alarm time ────────────────────────────────────
    if (alarm.time === hhmm) {
      let ring = false;
      switch (alarm.repeat) {
        case 'none':     ring = !alarm.date || alarm.date === todayStr; break;
        case 'daily':    ring = true; break;
        case 'weekdays': ring = weekdays.includes(day); break;
        case 'weekends': ring = weekends.includes(day); break;
        case 'weekly':   ring = alarm.date
          ? new Date(alarm.date + 'T00:00:00').getDay() === now.getDay()
          : true;
          break;
      }

      if (ring) {
        const fireKey = `fired-${alarm.id}-${todayStr}-${hhmm}`;
        if (await loadData(fireKey)) continue;
        await saveData(fireKey, true);

        const isVisible = clients.some(c => c.visibilityState === 'visible');
        if (isVisible) {
          // App is open — tell it to ring in-app (avoids double notification)
          clients.forEach(c => c.postMessage({ type: 'RING_ALARM_INAPP', alarm }));
        } else {
          // App closed — fire system notification
          await showAlarmNotif(`⏰ ${alarm.label}`, `Your alarm is ringing! Time: ${fmt12(alarm.time)}`, `alarm-${alarm.id}`, true);
        }
      }
    }

    // ── Check 15-minute reminder ──────────────────────────────────
    const r15Ms = await loadData(`r15-time-${alarm.id}`);
    if (r15Ms) {
      const diff15 = Math.abs(Date.now() - r15Ms);
      if (diff15 < 60000) { // within this minute
        const r15Key = `r15-fired-${alarm.id}-${todayStr}`;
        if (!(await loadData(r15Key))) {
          await saveData(r15Key, true);
          const isVisible = clients.some(c => c.visibilityState === 'visible');
          if (isVisible) {
            clients.forEach(c => c.postMessage({ type: 'SHOW_REMINDER', alarm, minutesBefore: 15 }));
          } else {
            await showReminderNotif(alarm, 15);
          }
        }
      }
    }

    // ── Check 10-minute reminder ──────────────────────────────────
    const r10Ms = await loadData(`r10-time-${alarm.id}`);
    if (r10Ms) {
      const diff10 = Math.abs(Date.now() - r10Ms);
      if (diff10 < 60000) {
        const r10Key = `r10-fired-${alarm.id}-${todayStr}`;
        if (!(await loadData(r10Key))) {
          await saveData(r10Key, true);
          const isVisible = clients.some(c => c.visibilityState === 'visible');
          if (isVisible) {
            clients.forEach(c => c.postMessage({ type: 'SHOW_REMINDER', alarm, minutesBefore: 10 }));
          } else {
            await showReminderNotif(alarm, 10);
          }
        }
      }
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
  let total = 0, names = [];
  for (const plan of plans) {
    if (plan.end_date < todayStr) continue;
    const inc = (plan.activities || []).filter(a => a.status !== 'done');
    if (inc.length) { total += inc.length; names.push(`${plan.title} (${inc.length} left)`); }
  }
  if (!total) return;
  const body = names.length <= 3
    ? `Pending: ${names.join(', ')}`
    : `You have ${total} activities pending across ${names.length} plans.`;
  await self.registration.showNotification('📋 Daily Activity Reminder', {
    body, tag: 'daily-plan-reminder',
    icon: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    badge: './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    vibrate: [200, 100, 200],
  });
  await saveData(firedKey, true);
}

// ================================================================
//  NOTIFICATION HELPERS
// ================================================================
async function showAlarmNotif(title, body, tag, requireInteraction) {
  return self.registration.showNotification(title, {
    body, tag, requireInteraction,
    icon:    './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    badge:   './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
    renotify: true,
    vibrate: requireInteraction
      ? [500, 200, 500, 200, 500, 200, 500]
      : [200, 100, 200],
    actions: requireInteraction
      ? [
          { action: 'snooze',  title: '⏰ Snooze 10m' },
          { action: 'dismiss', title: '✕ Dismiss'     },
        ]
      : [{ action: 'open', title: 'Open App' }],
  });
}

async function showReminderNotif(alarm, minutesBefore) {
  return self.registration.showNotification(
    `🔔 Alarm in ${minutesBefore} minutes`,
    {
      body:    `"${alarm.label}" rings at ${fmt12(alarm.time)}`,
      tag:     `remind${minutesBefore}-${alarm.id}`,
      icon:    './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
      badge:   './WhatsApp Image 2026-04-07 at 20.53.13.jpeg',
      vibrate: [200, 100, 200],
      requireInteraction: false,
      actions: [{ action: 'open', title: 'Open App' }],
    }
  );
}

// ================================================================
//  UTILITY FUNCTIONS
// ================================================================

/**
 * Returns the next timestamp (ms) at which this alarm should fire,
 * or null if the alarm has already passed and won't repeat.
 */
function getNextAlarmMs(alarm) {
  const now = new Date();
  const [h, m] = alarm.time.split(':').map(Number);

  if (alarm.repeat === 'none') {
    // One-time alarm: use the specified date (or today)
    const base = alarm.date
      ? new Date(alarm.date + 'T00:00:00')
      : new Date();
    base.setHours(h, m, 0, 0);
    return base > now ? base.getTime() : null;
  }

  // Repeating: find the next matching day
  const weekdays = ['monday','tuesday','wednesday','thursday','friday'];
  const weekends  = ['saturday','sunday'];
  const dayNames  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];

  let candidate = new Date();
  candidate.setHours(h, m, 0, 0);

  // If this minute has already passed today, start checking from tomorrow
  if (candidate <= now) candidate.setDate(candidate.getDate() + 1);

  for (let i = 0; i < 8; i++) {
    const dayName = dayNames[candidate.getDay()];
    let matches = false;
    switch (alarm.repeat) {
      case 'daily':    matches = true; break;
      case 'weekdays': matches = weekdays.includes(dayName); break;
      case 'weekends': matches = weekends.includes(dayName); break;
      case 'weekly':
        matches = alarm.date
          ? new Date(alarm.date + 'T00:00:00').getDay() === candidate.getDay()
          : true;
        break;
    }
    if (matches) return candidate.getTime();
    candidate.setDate(candidate.getDate() + 1);
  }
  return null;
}

async function markAlarmFired(alarmId) {
  const todayStr = new Date().toISOString().split('T')[0];
  const now = new Date();
  const hhmm = p2(now.getHours()) + ':' + p2(now.getMinutes());
  await saveData(`fired-${alarmId}-${todayStr}-${hhmm}`, true);
}

async function cleanupOldFiredMarkers() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const keys  = await cache.keys();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoff = yesterday.toISOString().split('T')[0];
    for (const req of keys) {
      if (req.url.includes('fired-') || req.url.includes('r15-fired-') || req.url.includes('r10-fired-')) {
        // Delete fired markers older than today
        if (!req.url.includes(new Date().toISOString().split('T')[0])) {
          await cache.delete(req);
        }
      }
    }
  } catch (e) {}
}

async function saveData(key, value) {
  const cache = await caches.open(DATA_CACHE);
  await cache.put(
    new Request(`/plantrack-data/${key}`),
    new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
  );
}

async function loadData(key) {
  try {
    const cache = await caches.open(DATA_CACHE);
    const res   = await cache.match(new Request(`/plantrack-data/${key}`));
    if (!res) return null;
    return await res.json();
  } catch (e) { return null; }
}

function p2(n) { return String(n).padStart(2, '0'); }

function fmt12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${p2(m)} ${h >= 12 ? 'PM' : 'AM'}`;
}
