// ================================================================
//  alarm-service.js  —  Unified Cross-Platform Alarm Manager v2
//  Supports: Android (Capacitor + native AlarmManager) and Web PWA
//  (Service Worker + Notifications API + TimestampTrigger).
//
//  All app.js code calls window.AlarmService.* — this file is the
//  single adapter between the UI layer and platform specifics.
// ================================================================

window.AlarmService = (() => {
  // ── Internal state ───────────────────────────────────────────────
  // Cache of the SW's reported background capability so we don't have
  // to message the SW on every isBackgroundSupported() call.
  let _capabilityCache = null;
  let _capabilityPending = null; // Promise while request is in flight

  // ── Platform detection ───────────────────────────────────────────
  function isAndroid() {
    return !!(window.Capacitor && window.Capacitor.getPlatform() === 'android');
  }

  // ── SW messaging helper ──────────────────────────────────────────
  function getServiceWorker() {
    return navigator.serviceWorker && navigator.serviceWorker.controller;
  }

  function postToSW(message) {
    const sw = getServiceWorker();
    if (sw) sw.postMessage(message);
  }

  /**
   * Ask the Service Worker for its background capability and return it
   * as a Promise. Caches the result so subsequent calls are instant.
   */
  function requestSWCapability() {
    if (_capabilityCache) return Promise.resolve(_capabilityCache);
    if (_capabilityPending) return _capabilityPending;

    _capabilityPending = new Promise((resolve) => {
      // Set up one-time listener for the SW reply
      const handler = (event) => {
        if (event.data && event.data.type === 'BACKGROUND_CAPABILITY') {
          navigator.serviceWorker.removeEventListener('message', handler);
          _capabilityCache = event.data.capability;
          _capabilityPending = null;
          resolve(_capabilityCache);
        }
      };

      if (navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener('message', handler);
        postToSW({ type: 'GET_BACKGROUND_CAPABILITY' });

        // Safety timeout: if SW doesn't reply in 2s, assume no support
        setTimeout(() => {
          navigator.serviceWorker.removeEventListener('message', handler);
          if (!_capabilityCache) {
            const fallback = { supportsExactBackground: false, supportsNotifications: false, fullBackgroundSupport: false };
            _capabilityCache = fallback;
            _capabilityPending = null;
            resolve(fallback);
          }
        }, 2000);
      } else {
        const fallback = { supportsExactBackground: false, supportsNotifications: false, fullBackgroundSupport: false };
        resolve(fallback);
      }
    });

    return _capabilityPending;
  }

  // ── Public API ───────────────────────────────────────────────────
  return {
    isAndroid,

    // ── Background Support Query ─────────────────────────────────
    /**
     * Returns true if alarms will fire even when the browser/app is closed.
     * Android: always true (AlarmManager is system-level).
     * Web: true only if TimestampTrigger is supported (Chrome on Android/desktop).
     */
    async isBackgroundSupported() {
      if (isAndroid()) return true;
      try {
        const cap = await requestSWCapability();
        return !!(cap && cap.fullBackgroundSupport);
      } catch (e) {
        return false;
      }
    },

    // ── Permission Checks ────────────────────────────────────────
    /**
     * Checks all required permissions.
     * Android: exact alarm permission (API 31+) + notification permission (API 33+).
     * Web: Notifications API permission.
     */
    async checkPermission() {
      if (isAndroid()) {
        const AlarmPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AlarmPlugin;
        if (AlarmPlugin) {
          try {
            const [exactRes, notifRes] = await Promise.all([
              AlarmPlugin.checkExactAlarmPermission(),
              AlarmPlugin.checkNotificationPermission(),
            ]);
            // Both must be granted for alarms to work reliably
            return !!(exactRes && exactRes.granted && notifRes && notifRes.granted);
          } catch (e) {
            console.warn('[AlarmService] Permission check failed:', e);
            return true; // assume granted if check fails (don't block user)
          }
        }
        return true;
      }
      // Web: check Notification permission
      return 'Notification' in window && Notification.permission === 'granted';
    },

    /**
     * Requests all required permissions, prompting the user as needed.
     */
    async requestPermission() {
      if (isAndroid()) {
        const AlarmPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AlarmPlugin;
        if (AlarmPlugin) {
          // Check and request notification permission first (Android 13+)
          try {
            const notifRes = await AlarmPlugin.checkNotificationPermission();
            if (notifRes && !notifRes.granted) {
              await AlarmPlugin.requestNotificationPermission();
            }
          } catch (e) {
            console.warn('[AlarmService] Notification permission request failed:', e);
          }
          // Then request exact alarm permission (Android 12+)
          try {
            const exactRes = await AlarmPlugin.checkExactAlarmPermission();
            if (exactRes && !exactRes.granted) {
              await AlarmPlugin.requestExactAlarmPermission();
            }
          } catch (e) {
            console.warn('[AlarmService] Exact alarm permission request failed:', e);
          }
        }
      } else {
        // Web: request Notification permission
        if ('Notification' in window && Notification.permission !== 'denied') {
          await Notification.requestPermission();
        }
      }
    },

    // ── Sync Alarms ──────────────────────────────────────────────
    /**
     * Synchronize the alarm list to the native scheduler or service worker.
     * Called every time alarms are loaded from Supabase.
     * @param {Array} alarms — The full list of alarm objects from Supabase
     */
    async sync(alarms) {
      const count = alarms ? alarms.length : 0;
      console.log(`[AlarmService] Synchronizing ${count} alarm(s)...`);

      if (isAndroid()) {
        const AlarmPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AlarmPlugin;
        if (!AlarmPlugin) {
          console.error('[AlarmService] Native AlarmPlugin is missing! Alarms will not ring.');
          return;
        }

        // Read current Supabase session to pass access token for background DB sync
        let accessToken = null;
        try {
          if (window.db && window.db.auth) {
            const { data } = await window.db.auth.getSession();
            if (data && data.session) {
              accessToken = data.session.access_token;
            }
          }
        } catch (e) {
          console.warn('[AlarmService] Failed to read Supabase access token:', e);
        }

        try {
          await AlarmPlugin.syncAlarms({
            alarms: alarms || [],
            supabaseUrl: window.SUPABASE_URL || '',
            supabaseAnon: window.SUPABASE_ANON || '',
            accessToken: accessToken || '',
            userId: window.currentUserId || '',
          });
          console.log('[AlarmService] ✓ Android AlarmManager sync complete.');
        } catch (e) {
          console.error('[AlarmService] Android sync failed:', e);
        }

      } else {
        // Web PWA: push alarms to Service Worker for scheduling
        if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SAVE_ALARMS',
            data: alarms || [],
          });
          // Also register periodic sync for more reliable wakeup
          navigator.serviceWorker.controller.postMessage({ type: 'SCHEDULE_PERIODIC_CHECK' });
          console.log('[AlarmService] ✓ Web Service Worker alarm sync complete.');
        } else if (window.pushAlarmsToSW) {
          // Legacy fallback via offline.js helper
          window.pushAlarmsToSW(alarms || []);
        } else {
          console.warn('[AlarmService] No service worker available for Web alarm scheduling.');
        }
      }
    },

    // ── Cancel Single Alarm ──────────────────────────────────────
    /**
     * Cancel a specific alarm by ID. Call this when:
     * - The user deletes an alarm
     * - The user toggles an alarm OFF
     *
     * This prevents phantom rings on Android where AlarmManager
     * PendingIntents survive even after the alarm is removed from DB.
     *
     * @param {string} alarmId — The alarm UUID
     */
    async cancelAlarm(alarmId) {
      if (!alarmId) return;

      if (isAndroid()) {
        const AlarmPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AlarmPlugin;
        if (AlarmPlugin) {
          try {
            await AlarmPlugin.cancelAlarm({ id: alarmId });
            console.log(`[AlarmService] ✓ Cancelled Android alarm: ${alarmId}`);
          } catch (e) {
            console.error(`[AlarmService] Failed to cancel Android alarm ${alarmId}:`, e);
          }
        }
      } else {
        // Web: ask SW to close any scheduled/showing notifications
        postToSW({ type: 'CANCEL_ALARM_NOTIFS', data: { alarmId } });
        console.log(`[AlarmService] ✓ Cancelled Web alarm notifications: ${alarmId}`);
      }
    },

    // ── Get Pending Background Updates ──────────────────────────
    /**
     * On Android: reads any DB updates that the ForegroundService queued
     * while the app was closed (e.g., one-time alarm turned off after firing,
     * or snooze alarm inserted). Returns an array of pending update objects.
     *
     * On Web: no-op — SW handles state internally.
     */
    async getPendingUpdates() {
      if (isAndroid()) {
        const AlarmPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AlarmPlugin;
        if (AlarmPlugin) {
          try {
            const res = await AlarmPlugin.getPendingUpdates();
            return res && res.updates ? res.updates : [];
          } catch (e) {
            console.error('[AlarmService] Failed to read native pending updates:', e);
          }
        }
      }
      return [];
    },

    // ── Warning Banner Helper ────────────────────────────────────
    /**
     * Show or hide the alarm-platform-warning banner.
     * Automatically called with the correct value by app.js after loadAlarms().
     * @param {boolean} show
     */
    showBackgroundWarning(show) {
      const banner = document.getElementById('alarm-platform-warning');
      if (banner) banner.style.display = show ? 'flex' : 'none';
    },

    // ── Invalidate capability cache (call after permission change) ─
    clearCapabilityCache() {
      _capabilityCache = null;
      _capabilityPending = null;
    },
  };
})();
