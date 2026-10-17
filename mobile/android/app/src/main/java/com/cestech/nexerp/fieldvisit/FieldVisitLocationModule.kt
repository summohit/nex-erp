package com.cestech.nexerp.fieldvisit

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * JS-facing bridge for FieldVisitLocationService. Method names mirror what
 * mobile/src/native/fieldVisitLocation.ts expects on both platforms, so the
 * JS store code stays platform-agnostic.
 */
class FieldVisitLocationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "FieldVisitLocation"

  @ReactMethod
  fun startTracking(visitId: Double, promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent = Intent(ctx, FieldVisitLocationService::class.java).apply {
        putExtra(FieldVisitLocationService.EXTRA_VISIT_ID, visitId.toLong())
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("start_failed", e.message, e)
    }
  }

  @ReactMethod
  fun stopTracking(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val intent = Intent(ctx, FieldVisitLocationService::class.java).apply {
        action = FieldVisitLocationService.ACTION_STOP
      }
      ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("stop_failed", e.message, e)
    }
  }

  @ReactMethod
  fun getBufferedPoints(promise: Promise) {
    try {
      val points = FieldVisitLocationService.bufferedPoints(reactApplicationContext)
      val result = Arguments.createArray()
      for (i in 0 until points.length()) {
        val p = points.getJSONArray(i)
        val entry = Arguments.createArray()
        entry.pushDouble(p.getDouble(0))
        entry.pushDouble(p.getDouble(1))
        entry.pushDouble(p.getDouble(2))
        result.pushArray(entry)
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("read_failed", e.message, e)
    }
  }

  @ReactMethod
  fun clearBufferedPoints(promise: Promise) {
    FieldVisitLocationService.clearBufferedPoints(reactApplicationContext)
    promise.resolve(true)
  }

  /** Lets the recorder send points itself while the journey runs (see the service). */
  @ReactMethod
  fun setUploadConfig(apiUrl: String, token: String, requestId: Double, promise: Promise) {
    FieldVisitLocationService.setUploadConfig(reactApplicationContext, apiUrl, token, requestId.toLong())
    promise.resolve(true)
  }

  /**
   * Whether Android lets MIRA run without battery restrictions. When it does
   * not, phones (OnePlus, Xiaomi, Oppo especially) can stop the route
   * recorder mid-journey. Needs no permission to ask.
   */
  @ReactMethod
  fun isBatteryUnrestricted(promise: Promise) {
    try {
      val pm = reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(pm.isIgnoringBatteryOptimizations(reactApplicationContext.packageName))
    } catch (e: Exception) {
      promise.resolve(true)
    }
  }

  /**
   * MIRA's own system settings page, where the person picks Battery →
   * Unrestricted. (The one-tap ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
   * needs a permission Google Play restricts, so it is not used.)
   */
  @ReactMethod
  fun openAppSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${reactApplicationContext.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      reactApplicationContext.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("open_failed", e.message, e)
    }
  }

  @ReactMethod
  fun isTracking(visitId: Double, promise: Promise) {
    promise.resolve(FieldVisitLocationService.isTrackingVisit(reactApplicationContext, visitId.toLong()))
  }
}
