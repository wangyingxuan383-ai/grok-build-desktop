package expo.modules.grokremote

import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.WindowManager
import java.util.Calendar

/**
 * Health facts the settings screen shows as they really are (system permission, channels,
 * battery optimisation, background mode, quiet hours) plus the shared "already notified"
 * set that keeps the foreground app, the follow service and push from repeating one event.
 */
object RemoteHealth {
  @Volatile var foreground = false
  @Volatile var foregroundComputer = ""
  private const val POLICY = "grok-notice-policy"
  private const val MONITOR = "grok-remote-monitor"
  private val lock = Any()

  /** Background follow mode: "always", "wifi" (Wi-Fi/Ethernet only) or "screen" (screen on only). */
  fun allowed(context: Context, mode: String): Boolean = when (mode) {
    "wifi" -> {
      val manager = context.getSystemService(ConnectivityManager::class.java)
      val caps = manager?.getNetworkCapabilities(manager.activeNetwork)
      caps != null && (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET))
    }
    "screen" -> context.getSystemService(PowerManager::class.java)?.isInteractive != false
    else -> true
  }

  fun setMode(context: Context, mode: String) {
    context.getSharedPreferences(MONITOR, Context.MODE_PRIVATE).edit().putString("mode", if (mode in listOf("always", "wifi", "screen")) mode else "always").apply()
  }

  fun setQuietHours(context: Context, enabled: Boolean, start: Int, end: Int, allowAttention: Boolean) {
    context.getSharedPreferences(POLICY, Context.MODE_PRIVATE).edit()
      .putBoolean("quiet:enabled", enabled).putInt("quiet:start", start.coerceIn(0, 1439)).putInt("quiet:end", end.coerceIn(0, 1439))
      .putBoolean("quiet:attention", allowAttention).apply()
  }

  /** True while quiet hours silence this category; approvals can be exempt. */
  fun quiet(context: Context, category: String): Boolean {
    val preferences = context.getSharedPreferences(POLICY, Context.MODE_PRIVATE)
    if (!preferences.getBoolean("quiet:enabled", false)) return false
    if (category == "attention" && preferences.getBoolean("quiet:attention", true)) return false
    val start = preferences.getInt("quiet:start", 23 * 60)
    val end = preferences.getInt("quiet:end", 7 * 60)
    val calendar = Calendar.getInstance()
    val now = calendar.get(Calendar.HOUR_OF_DAY) * 60 + calendar.get(Calendar.MINUTE)
    return if (start == end) false else if (start < end) now in start until end else now >= start || now < end
  }

  fun seen(context: Context, computer: String): List<String> {
    val preferences=context.getSharedPreferences(MONITOR, Context.MODE_PRIVATE)
    return try {
      val raw=preferences.getString("seen-ordered:$computer",null) ?: return preferences.getStringSet("seen:$computer",emptySet())!!.toList()
      val array=org.json.JSONArray(raw);(0 until array.length()).map{array.getString(it)}
    } catch(_:Exception) { emptyList() }
  }

  fun markSeen(context: Context, computer: String, ids: List<String>) {
    synchronized(lock) {
      val preferences = context.getSharedPreferences(MONITOR, Context.MODE_PRIVATE)
      val seen = NoticeIds.merge(seen(context,computer),ids)
      preferences.edit().putString("seen-ordered:$computer",org.json.JSONArray(seen).toString()).remove("seen:$computer").apply()
    }
  }

  /** Atomically claim IDs so foreground, SSE and FCM cannot announce the same event twice. */
  fun claim(context: Context, computer: String, ids: List<String>): List<String> = synchronized(lock) {
    val fresh = NoticeIds.fresh(seen(context, computer),ids)
    markSeen(context, computer, ids)
    fresh
  }

  fun baseline(context: Context, computer: String, ids: List<String>): Boolean = synchronized(lock) {
    val preferences = context.getSharedPreferences(MONITOR, Context.MODE_PRIVATE)
    if (preferences.getBoolean("baseline:$computer", false) || seen(context, computer).isNotEmpty()) {
      preferences.edit().putBoolean("baseline:$computer", true).apply()
      false
    } else {
      markSeen(context, computer, ids)
      preferences.edit().putBoolean("baseline:$computer", true).apply()
      true
    }
  }

  fun notificationHealth(context: Context): Map<String, Any> {
    RemoteNotices.channels(context)
    val manager = context.getSystemService(NotificationManager::class.java)
    val channels = if (Build.VERSION.SDK_INT >= 26) listOf("grok-attention", "grok-completed", "grok-failed", "grok-follow").map { id ->
      val channel = manager.getNotificationChannel(id)
      mapOf("id" to id, "name" to (channel?.name?.toString() ?: id), "enabled" to (channel != null && channel.importance != NotificationManager.IMPORTANCE_NONE))
    } else emptyList()
    val power = context.getSystemService(PowerManager::class.java)
    return mapOf(
      "enabled" to manager.areNotificationsEnabled(),
      "channels" to channels,
      "batteryExempt" to (power?.isIgnoringBatteryOptimizations(context.packageName) == true),
      "mode" to (context.getSharedPreferences(MONITOR, Context.MODE_PRIVATE).getString("mode", "always") ?: "always"),
    )
  }

  fun openNotificationSettings(context: Context, channel: String) {
    val intent = if (Build.VERSION.SDK_INT >= 26 && channel.isNotBlank())
      Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).putExtra(Settings.EXTRA_CHANNEL_ID, channel)
    else Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
    context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  /** Asks the system to exempt the app; falls back to the list when the direct request is refused. */
  fun requestBatteryExemption(context: Context) {
    try {
      context.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + context.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
      context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
  }

  /** Posts one local notification without contacting the computer or any model. */
  fun testNotice(context: Context, computer: String) {
    val notice: Notification = RemoteNotices.notification(context, "测试通知", "通知可以正常显示。这条通知不来自电脑，也没有调用模型。", "", computer)
    context.getSystemService(NotificationManager::class.java).notify(49002, notice)
  }

  /** Hides app content from screenshots and the recent-apps preview. */
  fun configurePrivacy(context: Context, activity: Activity?, locked: Boolean, secure: Boolean) {
    context.getSharedPreferences(POLICY, Context.MODE_PRIVATE).edit().putBoolean("privacy:lock", locked).putBoolean("privacy:secure", secure).apply()
    secureWindow(activity, secure || (!foreground && locked))
  }

  fun protectPreview(context: Context, activity: Activity?, background: Boolean) {
    val prefs = context.getSharedPreferences(POLICY, Context.MODE_PRIVATE)
    secureWindow(activity, prefs.getBoolean("privacy:secure", false) || (background && prefs.getBoolean("privacy:lock", false)))
  }

  fun privateNotifications(context: Context) = context.getSharedPreferences(POLICY, Context.MODE_PRIVATE).getBoolean("privacy:lock", false)

  fun secureWindow(activity: Activity?, enabled: Boolean) {
    activity?.runOnUiThread {
      if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}
