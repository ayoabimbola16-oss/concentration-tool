package com.lenovo.plantrack;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;
import com.getcapacitor.JSArray;

public class BootReceiver extends BroadcastReceiver {
    private static final String TAG = "BootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        // Handle boot events from standard Android and OEM variants (HTC, etc.)
        boolean isBoot = Intent.ACTION_BOOT_COMPLETED.equals(action)
                || "com.htc.intent.action.QUICKBOOT_POWERON".equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action);

        if (isBoot) {
            Log.d(TAG, "Device booted (action: " + action + "). Rescheduling active alarms...");

            try {
                SharedPreferences prefs = context.getSharedPreferences(AlarmPlugin.PREFS_NAME, Context.MODE_PRIVATE);
                String alarmsJson = prefs.getString(AlarmPlugin.KEY_ALARMS_JSON, null);

                if (alarmsJson != null && !alarmsJson.isEmpty() && !alarmsJson.equals("[]")) {
                    JSArray arr = new JSArray(alarmsJson);
                    AlarmPlugin.rescheduleAllAlarms(context, arr);
                    Log.d(TAG, "Successfully rescheduled " + arr.length() + " alarm(s) after boot.");
                } else {
                    Log.d(TAG, "No alarms found in cache to reschedule.");
                }
            } catch (Exception e) {
                Log.e(TAG, "Failed to reschedule alarms on boot", e);
            }
        }
    }
}
