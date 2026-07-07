package com.lenovo.plantrack;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSArray;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

public class AlarmForegroundService extends Service {
    private static final String TAG = "AlarmForegroundService";
    private static final String CHANNEL_ID = "PlanTrackAlarmsChannel";
    private static final int NOTIFICATION_ID = 9999;

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private Handler handler;
    private Runnable timeoutRunnable;

    @Override
    public void onCreate() {
        super.onCreate();
        handler = new Handler(Looper.getMainLooper());
        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        Log.d(TAG, "onStartCommand action: " + action);

        if ("ACTION_RING".equals(action)) {
            handleRing(intent);
        } else if ("ACTION_DISMISS".equals(action)) {
            handleDismiss(intent);
        } else if ("ACTION_SNOOZE".equals(action)) {
            handleSnooze(intent);
        } else {
            stopSelf();
        }

        return START_STICKY;
    }

    private void handleRing(Intent intent) {
        String id = intent.getStringExtra("id");
        String label = intent.getStringExtra("label");
        if (label == null || label.isEmpty()) label = "Alarm";

        acquireWakeLock();
        createNotificationChannel();

        // Action intents for notification buttons
        Intent dismissIntent = new Intent(this, AlarmReceiver.class);
        dismissIntent.setAction("ACTION_DISMISS");
        dismissIntent.putExtra("id", id);
        dismissIntent.putExtra("label", label);
        dismissIntent.putExtra("sound", intent.getStringExtra("sound"));
        dismissIntent.putExtra("repeat", intent.getStringExtra("repeat"));
        dismissIntent.putExtra("time", intent.getStringExtra("time"));
        dismissIntent.putExtra("date", intent.getStringExtra("date"));

        PendingIntent dismissPending = PendingIntent.getBroadcast(
                this,
                AlarmPlugin.generateUniqueIntId(id) + 1,
                dismissIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Intent snoozeIntent = new Intent(this, AlarmReceiver.class);
        snoozeIntent.setAction("ACTION_SNOOZE");
        snoozeIntent.putExtra("id", id);
        snoozeIntent.putExtra("label", label);
        snoozeIntent.putExtra("sound", intent.getStringExtra("sound"));
        snoozeIntent.putExtra("repeat", intent.getStringExtra("repeat"));
        snoozeIntent.putExtra("time", intent.getStringExtra("time"));
        snoozeIntent.putExtra("date", intent.getStringExtra("date"));

        PendingIntent snoozePending = PendingIntent.getBroadcast(
                this,
                AlarmPlugin.generateUniqueIntId(id) + 2,
                snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Content intent to open MainActivity
        Intent contentIntent = new Intent(this, MainActivity.class);
        PendingIntent contentPending = PendingIntent.getActivity(
                this,
                AlarmPlugin.generateUniqueIntId(id) + 3,
                contentIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle("⏰ " + label)
                .setContentText("Your PlanTrack alarm is ringing!")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setContentIntent(contentPending)
                .setFullScreenIntent(contentPending, true)
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Dismiss", dismissPending)
                .addAction(android.R.drawable.ic_popup_sync, "Snooze (10m)", snoozePending)
                .setOngoing(true)
                .build();

        startForeground(NOTIFICATION_ID, notification);

        playSound();
        startVibrate();

        // 2 minutes auto-timeout
        if (timeoutRunnable != null) handler.removeCallbacks(timeoutRunnable);
        timeoutRunnable = () -> {
            Log.d(TAG, "Alarm timed out after 2 minutes. Auto-dismissing...");
            handleDismiss(intent);
        };
        handler.postDelayed(timeoutRunnable, 120000);
    }

    private void handleDismiss(Intent intent) {
        stopRing();

        String id = intent.getStringExtra("id");
        String repeat = intent.getStringExtra("repeat");

        if (id != null) {
            // Background thread to handle database sync and rescheduling repeating alarm
            new Thread(() -> {
                Context context = getApplicationContext();
                SharedPreferences prefs = context.getSharedPreferences(AlarmPlugin.PREFS_NAME, Context.MODE_PRIVATE);

                if ("none".equals(repeat)) {
                    // Turn off one-time alarm in database
                    Log.d(TAG, "One-time alarm dismissed. Disabling in database...");
                    performSupabaseUpdate(context, id, false, null);
                } else {
                    // Reschedule next cycle for repeating alarm
                    Log.d(TAG, "Repeating alarm dismissed. Rescheduling next occurrence...");
                    rescheduleNextRepeatingAlarm(context, id);
                }
            }).start();
        }

        stopSelf();
    }

    private void handleSnooze(Intent intent) {
        stopRing();

        String id = intent.getStringExtra("id");
        String label = intent.getStringExtra("label");
        String sound = intent.getStringExtra("sound");

        if (id != null) {
            new Thread(() -> {
                Context context = getApplicationContext();

                // Strip any existing [Snoozed] prefix to avoid double-prepend
                // e.g. "[Snoozed] [Snoozed] My Alarm" → "[Snoozed] My Alarm"
                String baseLabel = (label != null ? label : "Alarm")
                        .replaceAll("^(\\[Snoozed\\]\\s*)+", "");

                // Compute snooze time: 10 minutes from now
                Calendar cal = Calendar.getInstance();
                cal.add(Calendar.MINUTE, 10);
                long snoozeTimeMs = cal.getTimeInMillis();

                SimpleDateFormat timeFmt = new SimpleDateFormat("HH:mm", Locale.US);
                SimpleDateFormat dateFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                String snoozeTimeStr = timeFmt.format(cal.getTime());
                String snoozeDateStr = dateFmt.format(cal.getTime());

                // Schedule Exact Snooze in AlarmManager
                AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                if (alarmManager != null) {
                    Intent snoozeAlarmIntent = new Intent(context, AlarmReceiver.class);
                    snoozeAlarmIntent.putExtra("id", id + "-snooze");
                    snoozeAlarmIntent.putExtra("label", "[Snoozed] " + baseLabel);
                    snoozeAlarmIntent.putExtra("sound", sound);
                    snoozeAlarmIntent.putExtra("repeat", "none");
                    snoozeAlarmIntent.putExtra("time", snoozeTimeStr);
                    snoozeAlarmIntent.putExtra("date", snoozeDateStr);

                    int snoozeRequestCode = AlarmPlugin.generateUniqueIntId(id + "-snooze");
                    PendingIntent pendingIntent = PendingIntent.getBroadcast(
                            context,
                            snoozeRequestCode,
                            snoozeAlarmIntent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );

                    AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(snoozeTimeMs, pendingIntent);
                    alarmManager.setAlarmClock(info, pendingIntent);
                    Log.d(TAG, "Snooze alarm scheduled for " + snoozeTimeStr);
                }

                // Insert Snoozed Alarm into Supabase
                Log.d(TAG, "Creating snoozed alarm on database...");
                performSupabaseInsert(context, baseLabel, snoozeTimeStr, snoozeDateStr, sound);

            }).start();
        }

        stopSelf();
    }

    private void performSupabaseUpdate(Context context, String alarmId, boolean isActive, @Nullable String nextDateStr) {
        SharedPreferences prefs = context.getSharedPreferences(AlarmPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString(AlarmPlugin.KEY_SUPABASE_URL, null);
        String supabaseAnon = prefs.getString(AlarmPlugin.KEY_SUPABASE_ANON, null);
        String accessToken = prefs.getString(AlarmPlugin.KEY_ACCESS_TOKEN, null);

        boolean success = false;

        if (supabaseUrl != null && supabaseAnon != null && accessToken != null) {
            try {
                URL url = new URL(supabaseUrl + "/rest/v1/alarms?id=eq." + alarmId);
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("PATCH");
                conn.setRequestProperty("apikey", supabaseAnon);
                conn.setRequestProperty("Authorization", "Bearer " + accessToken);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Prefer", "return=minimal");
                conn.setDoOutput(true);

                JSONObject body = new JSONObject();
                body.put("is_active", isActive);
                if (nextDateStr != null) {
                    body.put("date", nextDateStr);
                }

                OutputStream os = conn.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();

                int code = conn.getResponseCode();
                Log.d(TAG, "Supabase update response code: " + code);
                if (code >= 200 && code < 300) {
                    success = true;
                }
            } catch (Exception e) {
                Log.e(TAG, "Supabase update request failed", e);
            }
        }

        if (!success) {
            // Queue update locally
            Log.d(TAG, "Offline or update failed. Queueing update local cache...");
            queueLocalUpdate(context, alarmId, "update", isActive, nextDateStr, null, null, null);
        }
    }

    private void performSupabaseInsert(Context context, String baseLabel, String timeStr, String dateStr, String sound) {
        SharedPreferences prefs = context.getSharedPreferences(AlarmPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String supabaseUrl = prefs.getString(AlarmPlugin.KEY_SUPABASE_URL, null);
        String supabaseAnon = prefs.getString(AlarmPlugin.KEY_SUPABASE_ANON, null);
        String accessToken = prefs.getString(AlarmPlugin.KEY_ACCESS_TOKEN, null);
        String userId = prefs.getString(AlarmPlugin.KEY_USER_ID, null);

        boolean success = false;

        if (supabaseUrl != null && supabaseAnon != null && accessToken != null && userId != null) {
            try {
                URL url = new URL(supabaseUrl + "/rest/v1/alarms");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("apikey", supabaseAnon);
                conn.setRequestProperty("Authorization", "Bearer " + accessToken);
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("Prefer", "return=minimal");
                conn.setDoOutput(true);

                JSONObject body = new JSONObject();
                body.put("user_id", userId);
                body.put("time", timeStr);
                body.put("date", dateStr);
                body.put("label", "[Snoozed] " + baseLabel);
                body.put("repeat", "none");
                body.put("sound", sound);
                body.put("is_active", true);

                OutputStream os = conn.getOutputStream();
                os.write(body.toString().getBytes("UTF-8"));
                os.close();

                int code = conn.getResponseCode();
                Log.d(TAG, "Supabase insert response code: " + code);
                if (code >= 200 && code < 300) {
                    success = true;
                }
            } catch (Exception e) {
                Log.e(TAG, "Supabase insert request failed", e);
            }
        }

        if (!success) {
            // Queue insert locally
            Log.d(TAG, "Offline or insert failed. Queueing insert local cache...");
            queueLocalUpdate(context, null, "insert", true, dateStr, timeStr, "[Snoozed] " + baseLabel, sound);
        }
    }

    private void queueLocalUpdate(Context context, String alarmId, String type, boolean isActive, String date, String time, String label, String sound) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(AlarmPlugin.PREFS_NAME, Context.MODE_PRIVATE);
            String pendingStr = prefs.getString(AlarmPlugin.KEY_PENDING_UPDATES, "[]");
            JSONArray arr = new JSONArray(pendingStr);

            JSONObject update = new JSONObject();
            update.put("type", type);
            update.put("alarmId", alarmId);
            update.put("is_active", isActive);
            update.put("date", date);
            update.put("time", time);
            update.put("label", label);
            update.put("sound", sound);

            arr.put(update);
            prefs.edit().putString(AlarmPlugin.KEY_PENDING_UPDATES, arr.toString()).apply();
        } catch (Exception e) {
            Log.e(TAG, "Failed to queue local update", e);
        }
    }

    private void rescheduleNextRepeatingAlarm(Context context, String alarmId) {
        SharedPreferences prefs = context.getSharedPreferences(AlarmPlugin.PREFS_NAME, Context.MODE_PRIVATE);
        String alarmsJson = prefs.getString(AlarmPlugin.KEY_ALARMS_JSON, "[]");
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) return;

        try {
            JSONArray arr = new JSONArray(alarmsJson);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject alarmObj = arr.getJSONObject(i);
                if (alarmId.equals(alarmObj.getString("id"))) {
                    String time = alarmObj.getString("time");
                    String date = alarmObj.optString("date", "");
                    String repeat = alarmObj.optString("repeat", "none");
                    String label = alarmObj.optString("label", "Alarm");
                    String sound = alarmObj.optString("sound", "beep");

                    // Compute the next cycle time
                    long triggerMs = AlarmPlugin.calculateNextTriggerMs(time, date, repeat);
                    SimpleDateFormat dbDateFmt = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                    String nextDateStr = dbDateFmt.format(new Date(triggerMs));

                    // Schedule next repeating instance in AlarmManager
                    Intent intent = new Intent(context, AlarmReceiver.class);
                    intent.putExtra("id", alarmId);
                    intent.putExtra("label", label);
                    intent.putExtra("sound", sound);
                    intent.putExtra("repeat", repeat);
                    intent.putExtra("time", time);
                    intent.putExtra("date", nextDateStr);

                    int requestCode = AlarmPlugin.generateUniqueIntId(alarmId);
                    PendingIntent pendingIntent = PendingIntent.getBroadcast(
                            context,
                            requestCode,
                            intent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );

                    AlarmManager.AlarmClockInfo info = new AlarmManager.AlarmClockInfo(triggerMs, pendingIntent);
                    alarmManager.setAlarmClock(info, pendingIntent);
                    Log.d(TAG, "Rescheduled repeating alarm " + alarmId + " for next instance at " + nextDateStr);

                    // Update date column in Supabase so it shows the next date
                    performSupabaseUpdate(context, alarmId, true, nextDateStr);
                    break;
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to reschedule repeating alarm", e);
        }
    }

    private void playSound() {
        try {
            // R.raw.alarm_sound
            int resId = getResources().getIdentifier("alarm_sound", "raw", getPackageName());
            if (resId != 0) {
                mediaPlayer = MediaPlayer.create(this, resId);
                mediaPlayer.setLooping(true);
                mediaPlayer.setAudioAttributes(
                        new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ALARM)
                                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                                .build()
                );
                mediaPlayer.start();
                Log.d(TAG, "Alarm sound started looping");
            } else {
                Log.w(TAG, "alarm_sound.wav not found in raw resources");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to play sound", e);
        }
    }

    private void startVibrate() {
        if (vibrator != null && vibrator.hasVibrator()) {
            long[] pattern = {0, 500, 500}; // vibrate 500ms, pause 500ms
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            } else {
                vibrator.vibrate(pattern, 0);
            }
            Log.d(TAG, "Alarm vibration started");
        }
    }

    private void stopRing() {
        if (timeoutRunnable != null) {
            handler.removeCallbacks(timeoutRunnable);
            timeoutRunnable = null;
        }

        try {
            if (mediaPlayer != null) {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
                mediaPlayer = null;
                Log.d(TAG, "Alarm sound stopped");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping media player", e);
        }

        try {
            if (vibrator != null) {
                vibrator.cancel();
                Log.d(TAG, "Alarm vibration cancelled");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping vibration", e);
        }

        releaseWakeLock();
    }

    private void acquireWakeLock() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "PlanTrack::AlarmForegroundServiceWakeLock");
            wakeLock.acquire(10 * 60 * 1000L); // 10 minutes max lock
            Log.d(TAG, "WakeLock acquired");
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
            Log.d(TAG, "WakeLock released");
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "PlanTrack Alarms",
                    // IMPORTANCE_MAX: heads-up notification that pops on screen, bypasses DND
                    NotificationManager.IMPORTANCE_MAX
            );
            channel.setDescription("Rings active exact alarms — PlanTrack");
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 500, 500, 500});
            // Allow alarm to ring over Do Not Disturb
            channel.setBypassDnd(true);
            // Show notification contents on lock screen
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                // Only create the channel if it doesn't exist yet
                // (cannot change importance of existing channels)
                if (manager.getNotificationChannel(CHANNEL_ID) == null) {
                    manager.createNotificationChannel(channel);
                    Log.d(TAG, "Notification channel created: " + CHANNEL_ID);
                }
            }
        }
    }

    @Override
    public void onDestroy() {
        stopRing();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
