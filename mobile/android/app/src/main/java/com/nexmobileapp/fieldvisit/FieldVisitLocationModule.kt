package com.nexmobileapp.fieldvisit

import android.content.Intent
import android.os.Build
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

  @ReactMethod
  fun isTracking(visitId: Double, promise: Promise) {
    promise.resolve(FieldVisitLocationService.isTrackingVisit(reactApplicationContext, visitId.toLong()))
  }
}
