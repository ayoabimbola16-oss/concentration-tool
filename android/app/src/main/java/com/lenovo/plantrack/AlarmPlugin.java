package com.lenovo.plantrack;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

@CapacitorPlugin(
    name = "AlarmPlugin",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class AlarmPlugin extends Plugin {
    private static final String TAG = "AlarmPlugin";
    public static final String PREFS_NAME = "PlanTrackAlarms";
    public static final String KEY_SUPABASE_URL = "supabaseUrl";
    public static final String KEY_SUPABASE_ANON = "supabaseAnon";
    public static final String KEY_ACCESS_TOKEN = "accessToken";
    public static final String KEY_USER_ID = "userId";
    public static final String KEY_ALARMS_JSON = "alarmsJson";
    public static final String KEY_PENDING_UPDATES = "pendingUpdates";

    // ─── syncAlarms ──────────────────────────────────────────────────────────
    @PluginMethod
    public void syncAlarms(PluginCall call) {
        JSArray alarms = call.getArray("alarms");
        String supabaseUrl = call.getString("supabaseUrl");
        String supabaseAnon = call.getString("supabaseAnon");
        String accessToken = call.getString("accessToken");
        String userId = call.getString("userId");

        if (alarms == null) {
            call.reject("Alarms array is required");
            return;
        }

        try {
            Context context = getContext();
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = prefs.edit();

            // Store Supabase settings for background synchronization
            editor.putString(KEY_SUPABASE_URL, supabaseUrl);
            editor.putString(KEY_SUPABASE_ANON, supabaseAnon);
            editor.putString(KEY_ACCESS_TOKEN, accessToken);
            editor.putString(KEY_USER_ID, userId);
            editor.putString(KEY_ALARMS_JSON, alarms.toString());
            editor.apply();

            rescheduleAllAlarms(context, alarms);

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to sync alarms", e);
            call.reject(e.getMessage());
        }
    }

    // ─── cancelAlarm ─────────────────────────────────────────────────────────
    /**
     * Cancel a single alarm by its ID. Called from JS when user deletes or
     * disables an alarm — prevents phantom rings on Android.
     */
    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        String id = call.getString("id");
        if (id == null || id.isEmpty()) {
            call.reject("Alarm id is required");
            return;
        }

        try {
            Context context = getContext();
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (alarmManager != null) {
                cancelSingleIntent(context, alarmManager, id);
                // Also cancel any snooze variant
                cancelSingleIntent(context, alarmManager, id + "-snooze");
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel alarm " + id, e);
            call.reject(e.getMessage());
        }
    }

    private static void cancelSingleIntent(Context context, AlarmManager alarmManager, String id) {
        int requestCode = generateUniqueIntId(id);
        Intent intent = new Intent(context, AlarmReceiver.class);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
        );
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent);
            pendingIntent.cancel();
            Log.d(TAG, "Cancelled alarm intent for id: " + id);
        }
    }

    // ─── Exact Alarm Permission ───────────────────────────────────────────────
    @PluginMethod
    public void checkExactAlarmPermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarmManager = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            ret.put("granted", alarmManager != null && alarmManager.canScheduleExactAlarms());
        } else {
            ret.put("granted", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestExactAlarmPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(Uri.fromParts("package", getContext().getPackageName(), null));
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    // ─── Notification Permission (Android 13+ / API 33+) ─────────────────────
    @PluginMethod
    public void checkNotificationPermission(PluginCall call) {
        JSObject ret = new JSObject();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // API 33+: notification permission is runtime-grantable
            boolean granted = ContextCompat.checkSelfPermission(
                    getContext(), Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;
            ret.put("granted", granted);
        } else {
            // Below API 33: notifications are always allowed
            ret.put("granted", true);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            boolean alreadyGranted = ContextCompat.checkSelfPermission(
                    getContext(), Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED;

            if (alreadyGranted) {
                JSObject ret = new JSObject();
                ret.put("granted", true);
                call.resolve(ret);
                return;
            }
            // Use Capacitor's permission request mechanism
            requestPermissionForAlias("notifications", call, "notificationPermissionCallback");
        } else {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        }
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(
                getContext(), Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    // ─── Pending Background Updates ───────────────────────────────────────────
    @PluginMethod
    public void getPendingUpdates(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String pendingStr = prefs.getString(KEY_PENDING_UPDATES, "[]");

        try {
            JSArray arr = new JSArray(pendingStr);
            // Clear pending updates after reading
            prefs.edit().putString(KEY_PENDING_UPDATES, "[]").apply();

            JSObject ret = new JSObject();
            ret.put("updates", arr);
            call.resolve(ret);
        } catch (JSONException e) {
            call.reject("Failed to parse pending updates: " + e.getMessage());
        }
    }

    // ─── Static helpers (called by BootReceiver & AlarmForegroundService) ─────
    public static void rescheduleAllAlarms(Context context, JSArray alarmsArray) {
        cancelAllScheduledIntents(context);

        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        // Check exact alarm permission on API 31+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (!alarmManager.canScheduleExactAlarms()) {
                Log.w(TAG, "Cannot schedule exact alarms: permission not granted yet");
                return;
            }
        }

        long now = System.currentTimeMillis();

        for (int i = 0; i < alarmsArray.length(); i++) {
            try {
                JSONObject alarmObj = alarmsArray.getJSONObject(i);
                boolean isActive = alarmObj.optBoolean("is_active", false);
                if (!isActive) continue;

                String id = alarmObj.getString("id");
                String time = alarmObj.getString("time"); // HH:MM
                String date = alarmObj.optString("date", ""); // YYYY-MM-DD
                String repeat = alarmObj.optString("repeat", "none");
                String label = alarmObj.optString("label", "Alarm");
                String sound = alarmObj.optString("sound", "beep");

                long nextTriggerMs = calculateNextTriggerMs(time, date, repeat);
                if (nextTriggerMs <= now) continue;

                // Schedule an exact AlarmClock intent (shows alarm clock icon in status bar)
                Intent intent = new Intent(context, AlarmReceiver.class);
                intent.putExtra("id", id);
                intent.putExtra("label", label);
                intent.putExtra("sound", sound);
                intent.putExtra("repeat", repeat);
                intent.putExtra("time", time);
                intent.putExtra("date", date);

                int requestCode = generateUniqueIntId(id);
                PendingIntent pendingIntent = PendingIntent.getBroadcast(
                        context,
                        requestCode,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                );

                AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(nextTriggerMs, pendingIntent);
                alarmManager.setAlarmClock(info, pendingIntent);
                Log.d(TAG, "Scheduled alarm " + id + " (" + label + ") at " + nextTriggerMs);

            } catch (Exception e) {
                Log.e(TAG, "Failed to schedule alarm at index " + i, e);
            }
        }
    }

    private static void cancelAllScheduledIntents(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String alarmsStr = prefs.getString(KEY_ALARMS_JSON, "[]");
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        try {
            JSONArray arr = new JSONArray(alarmsStr);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject alarmObj = arr.getJSONObject(i);
                String id = alarmObj.getString("id");
                cancelSingleIntent(context, alarmManager, id);
                cancelSingleIntent(context, alarmManager, id + "-snooze");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to cancel all scheduled intents", e);
        }
    }

    public static long calculateNextTriggerMs(String time, String date, String repeat) {
        String[] parts = time.split(":");
        int hour = Integer.parseInt(parts[0]);
        int minute = Integer.parseInt(parts[1]);

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);

        long now = System.currentTimeMillis();

        if (repeat == null || repeat.equals("none")) {
            if (date != null && !date.isEmpty()) {
                String[] dparts = date.split("-");
                cal.set(Calendar.YEAR, Integer.parseInt(dparts[0]));
                cal.set(Calendar.MONTH, Integer.parseInt(dparts[1]) - 1);
                cal.set(Calendar.DAY_OF_MONTH, Integer.parseInt(dparts[2]));
            } else {
                if (cal.getTimeInMillis() <= now) {
                    cal.add(Calendar.DAY_OF_MONTH, 1);
                }
            }
        } else {
            // Find the next matching day for repeating alarms
            if (cal.getTimeInMillis() <= now) {
                cal.add(Calendar.DAY_OF_MONTH, 1);
            }

            if (repeat.equals("weekdays")) {
                while (cal.get(Calendar.DAY_OF_WEEK) == Calendar.SATURDAY
                        || cal.get(Calendar.DAY_OF_WEEK) == Calendar.SUNDAY) {
                    cal.add(Calendar.DAY_OF_MONTH, 1);
                }
            } else if (repeat.equals("weekends")) {
                while (cal.get(Calendar.DAY_OF_WEEK) != Calendar.SATURDAY
                        && cal.get(Calendar.DAY_OF_WEEK) != Calendar.SUNDAY) {
                    cal.add(Calendar.DAY_OF_MONTH, 1);
                }
            } else if (repeat.equals("weekly")) {
                if (date != null && !date.isEmpty()) {
                    String[] dparts = date.split("-");
                    Calendar targetCal = Calendar.getInstance();
                    targetCal.set(Integer.parseInt(dparts[0]), Integer.parseInt(dparts[1]) - 1, Integer.parseInt(dparts[2]));
                    int targetDayOfWeek = targetCal.get(Calendar.DAY_OF_WEEK);
                    while (cal.get(Calendar.DAY_OF_WEEK) != targetDayOfWeek) {
                        cal.add(Calendar.DAY_OF_MONTH, 1);
                    }
                }
            }
            // For "daily" repeat, no additional day adjustment needed
        }

        return cal.getTimeInMillis();
    }

    public static int generateUniqueIntId(String uuidStr) {
        int hash = 0;
        for (int i = 0; i < uuidStr.length(); i++) {
            hash = ((hash << 5) - hash) + uuidStr.charAt(i);
            hash |= 0;
        }
        return Math.abs(hash) % 1000000;
    }
}
