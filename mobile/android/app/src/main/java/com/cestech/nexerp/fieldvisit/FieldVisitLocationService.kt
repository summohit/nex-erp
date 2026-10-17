package com.cestech.nexerp.fieldvisit

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.cestech.nexerp.MainActivity
import com.cestech.nexerp.R
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Keeps recording a field visit's GPS route while the app is backgrounded or
 * the screen is locked. A plain JS `setInterval` (the previous approach) is
 * suspended by the OS the moment the app leaves the foreground, which is the
 * common case for a real site-to-site visit — this foreground service is
 * what survives that.
 *
 * Points are buffered in SharedPreferences rather than pushed to JS via an
 * event, because the JS runtime itself can be suspended or torn down in deep
 * background; the buffer must outlive it. The RN side drains the buffer with
 * `getBufferedPoints()` whenever the app is next foregrounded.
 */
class FieldVisitLocationService : Service() {

  companion object {
    private const val CHANNEL_ID = "field_visit_tracking"
    private const val NOTIFICATION_ID = 4821
    private const val PREFS_NAME = "field_visit_tracking"
    private const val KEY_POINTS = "points"
    private const val KEY_VISIT_ID = "visit_id"
    private const val KEY_API_URL = "api_url"
    private const val KEY_TOKEN = "token"
    private const val KEY_REQUEST_ID = "request_id"
    /** How often recorded points go to the server, so finance can watch the journey live. */
    private const val UPLOAD_EVERY_MS = 90_000L
    /** Keep a fix that moved this far, or one this old, whichever comes first. */
    private const val MIN_MOVE_M = 15f
    private const val HEARTBEAT_MS = 120_000L
    private val bufferLock = Any()
    const val ACTION_STOP = "com.cestech.nexerp.fieldvisit.STOP"
    const val EXTRA_VISIT_ID = "visitId"

    private fun prefs(context: Context): SharedPreferences =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun bufferedPoints(context: Context): JSONArray {
      val raw = prefs(context).getString(KEY_POINTS, "[]") ?: "[]"
      return try { JSONArray(raw) } catch (e: Exception) { JSONArray() }
    }

    fun clearBufferedPoints(context: Context) {
      synchronized(bufferLock) { prefs(context).edit().putString(KEY_POINTS, "[]").apply() }
    }

    /**
     * Where and as whom to send points (set by the app at Start journey and
     * whenever it refreshes its login). Without it the service only buffers,
     * as before, and the app sends the points at End journey.
     */
    fun setUploadConfig(context: Context, apiUrl: String, token: String, requestId: Long) {
      prefs(context).edit()
        .putString(KEY_API_URL, apiUrl.trimEnd('/'))
        .putString(KEY_TOKEN, token)
        .putLong(KEY_REQUEST_ID, requestId)
        .apply()
    }

    fun activeVisitId(context: Context): Long =
      prefs(context).getLong(KEY_VISIT_ID, -1L)

    fun isTrackingVisit(context: Context, visitId: Long): Boolean =
      visitId >= 0 && activeVisitId(context) == visitId
  }

  private lateinit var fusedClient: FusedLocationProviderClient
  private var locationCallback: LocationCallback? = null
  private var uploadThread: HandlerThread? = null
  private var uploadHandler: Handler? = null
  private val uploadTick = object : Runnable {
    override fun run() {
      uploadPending()
      uploadHandler?.postDelayed(this, UPLOAD_EVERY_MS)
    }
  }

  override fun onCreate() {
    super.onCreate()
    fusedClient = LocationServices.getFusedLocationProviderClient(this)
    createNotificationChannel()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopTracking()
      stopSelf()
      return START_NOT_STICKY
    }

    val visitId = intent?.getLongExtra(EXTRA_VISIT_ID, -1L) ?: -1L
    if (visitId < 0) {
      // Nothing to track — likely a stray restart intent from the OS with no
      // extras attached. Don't leave a foreground notification with no purpose.
      stopSelf()
      return START_NOT_STICKY
    }
    startTracking(visitId)
    // START_STICKY: if the OS kills this process under memory pressure, it
    // restarts the service (intent extras dropped) — startTracking() bails
    // out above when that happens since there's no visitId to resume with.
    // Real recovery in that case happens on next app foreground via
    // fetchActiveVisit() re-arming tracking from the server's visit record.
    return START_STICKY
  }

  private fun startTracking(visitId: Long) {
    prefs(this).edit().putLong(KEY_VISIT_ID, visitId).apply()

    val notification = buildNotification()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }

    // Matches the JS-side polling cadence it replaces (30s), with a 15m move
    // threshold so parking at a site doesn't pad the route with noise.
    // play-services-location is pinned to 20.0.0 (see app/build.gradle), which
    // predates the LocationRequest.Builder fluent API — this is the old form.
    @Suppress("DEPRECATION")
    val request = LocationRequest.create().apply {
      priority = LocationRequest.PRIORITY_HIGH_ACCURACY
      interval = 30_000L
      fastestInterval = 20_000L
      // No displacement filter here: appendPoint() keeps a fix when it moved
      // 15 m or when 2 minutes have passed, so a phone standing still still
      // reports in and the live map does not show it as gone quiet.
      smallestDisplacement = 0f
    }

    val callback = object : LocationCallback() {
      override fun onLocationResult(result: LocationResult) {
        result.lastLocation?.let { appendPoint(it) }
      }
    }
    locationCallback = callback

    if (uploadThread == null) {
      val t = HandlerThread("fv-route-upload").also { it.start() }
      uploadThread = t
      uploadHandler = Handler(t.looper).also { it.postDelayed(uploadTick, UPLOAD_EVERY_MS) }
    }

    try {
      fusedClient.requestLocationUpdates(request, callback, mainLooper)
    } catch (e: SecurityException) {
      // Location permission was revoked mid-visit (e.g. from system settings)
      // — stop cleanly rather than let the service crash-loop.
      stopSelf()
    }
  }

  private var lastKept: Location? = null
  private var lastKeptAt = 0L

  private fun appendPoint(location: Location) {
    val now = System.currentTimeMillis()
    val prev = lastKept
    if (prev != null && prev.distanceTo(location) < MIN_MOVE_M && now - lastKeptAt < HEARTBEAT_MS) return
    lastKept = location
    lastKeptAt = now
    synchronized(bufferLock) {
      val points = bufferedPoints(this)
      val point = JSONArray()
      point.put(location.latitude)
      point.put(location.longitude)
      point.put(System.currentTimeMillis())
      points.put(point)
      prefs(this).edit().putString(KEY_POINTS, points.toString()).apply()
    }
  }

  /**
   * Send what is buffered to POST {api}/travel-allowance/journey/points and
   * drop exactly those points on success. Any failure (offline, an expired
   * login) leaves them buffered for the next tick or for the app at End
   * journey; the server ignores points it already has.
   */
  private fun uploadPending() {
    val p = prefs(this)
    val api = p.getString(KEY_API_URL, null) ?: return
    val token = p.getString(KEY_TOKEN, null) ?: return
    val requestId = p.getLong(KEY_REQUEST_ID, -1L)
    val batch = synchronized(bufferLock) { bufferedPoints(this) }
    val count = batch.length()
    if (count == 0) return
    var conn: HttpURLConnection? = null
    try {
      val body = JSONObject().apply {
        put("points", batch)
        if (requestId >= 0) put("requestId", requestId)
      }
      conn = (URL("$api/travel-allowance/journey/points").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 15_000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Authorization", "Bearer $token")
      }
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      if (conn.responseCode in 200..299) {
        synchronized(bufferLock) {
          val now = bufferedPoints(this)
          val rest = JSONArray()
          for (i in count until now.length()) rest.put(now.get(i))
          p.edit().putString(KEY_POINTS, rest.toString()).apply()
        }
      }
    } catch (e: Exception) {
      // Keep the points; try again next tick.
    } finally {
      conn?.disconnect()
    }
  }

  private fun stopTracking() {
    locationCallback?.let { fusedClient.removeLocationUpdates(it) }
    locationCallback = null
    uploadHandler?.removeCallbacks(uploadTick)
    uploadThread?.quitSafely()
    uploadThread = null
    uploadHandler = null
    prefs(this).edit().remove(KEY_VISIT_ID).remove(KEY_TOKEN).remove(KEY_REQUEST_ID).apply()
  }

  override fun onDestroy() {
    stopTracking()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Field Visit Tracking",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Shown while a field visit's GPS route is being recorded"
        setShowBadge(false)
      }
      getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }
  }

  private fun buildNotification(): Notification {
    val activityIntent = Intent(this, MainActivity::class.java).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val pendingIntent = PendingIntent.getActivity(this, 0, activityIntent, pendingFlags)

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Field visit in progress")
      .setContentText("Your route is recorded and shared with finance until End journey")
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .build()
  }
}
