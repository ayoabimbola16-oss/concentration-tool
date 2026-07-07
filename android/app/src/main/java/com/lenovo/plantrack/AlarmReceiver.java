package com.lenovo.plantrack;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

public class AlarmReceiver extends BroadcastReceiver {
    private static final String TAG = "AlarmReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.d(TAG, "onReceive action: " + action);

        if (action != null && (action.equals("ACTION_DISMISS") || action.equals("ACTION_SNOOZE"))) {
            // Forward notification actions directly to the service
            Intent serviceIntent = new Intent(context, AlarmForegroundService.class);
            serviceIntent.setAction(action);
            serviceIntent.putExtra("id", intent.getStringExtra("id"));
            serviceIntent.putExtra("label", intent.getStringExtra("label"));
            serviceIntent.putExtra("sound", intent.getStringExtra("sound"));
            serviceIntent.putExtra("repeat", intent.getStringExtra("repeat"));
            serviceIntent.putExtra("time", intent.getStringExtra("time"));
            serviceIntent.putExtra("date", intent.getStringExtra("date"));

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } else {
            // This is the alarm trigger from AlarmManager
            String id = intent.getStringExtra("id");
            String label = intent.getStringExtra("label");
            String sound = intent.getStringExtra("sound");
            String repeat = intent.getStringExtra("repeat");
            String time = intent.getStringExtra("time");
            String date = intent.getStringExtra("date");

            Log.d(TAG, "Alarm triggered! Id: " + id + ", Label: " + label);

            Intent serviceIntent = new Intent(context, AlarmForegroundService.class);
            serviceIntent.setAction("ACTION_RING");
            serviceIntent.putExtra("id", id);
            serviceIntent.putExtra("label", label);
            serviceIntent.putExtra("sound", sound);
            serviceIntent.putExtra("repeat", repeat);
            serviceIntent.putExtra("time", time);
            serviceIntent.putExtra("date", date);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        }
    }
}
