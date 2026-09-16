package com.cestech.nexerp

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.cestech.nexerp.fieldvisit.FieldVisitLocationPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(FieldVisitLocationPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    createShiftReminderChannel()
  }

  /**
   * The channel shift reminders arrive on.
   *
   * Android 8+ silently DROPS a notification whose channel does not exist, and
   * the manifest's default_notification_channel_id only names one — it does not
   * create it. Without this, every push from the server would vanish with no
   * error anywhere, which is the worst possible failure for something a person
   * is relying on to get to work on time.
   *
   * Its own channel rather than the default so someone can silence task chatter
   * in Android's settings without silencing the thing that tells them their
   * shift is starting. IMPORTANCE_HIGH so it makes a sound on a locked phone.
   */
  private fun createShiftReminderChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      SHIFT_REMINDER_CHANNEL_ID,
      "Shift reminders",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "Reminders to clock in and clock out around your shift."
      enableVibration(true)
    }
    val manager = getSystemService(NotificationManager::class.java)
    manager?.createNotificationChannel(channel)
  }

  companion object {
    /** Must match AndroidManifest's default channel and PushService's channelId. */
    const val SHIFT_REMINDER_CHANNEL_ID = "shift-reminders"
  }
}
