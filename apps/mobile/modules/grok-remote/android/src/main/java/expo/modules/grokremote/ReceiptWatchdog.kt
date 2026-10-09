package expo.modules.grokremote

import android.content.Context
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/** Runs independently of paused JS timers; checks one receipt and never resends the operation. */
object ReceiptWatchdog {
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private var pending: ScheduledFuture<*>? = null
  @Synchronized fun cancel() { pending?.cancel(true); pending = null }
  @Synchronized fun schedule(context: Context, host: String, pin: String, token: String, operation: String, session: String) {
    cancel()
    require(operation.matches(Regex("[a-zA-Z0-9_-]{1,160}")))
    pending = executor.schedule({
      if (!RemoteHealth.foreground) {
        val confirmed = try {
          val client = PinnedHttps.create(host,pin,false).newBuilder().callTimeout(10,TimeUnit.SECONDS).build()
          val request = Request.Builder().url(host.trimEnd('/')+"/v1/operations/"+operation).header("Authorization","Bearer $token").build()
          client.newCall(request).execute().use { response -> response.isSuccessful && JSONObject(response.body?.string()?:"{}").optString("state") in listOf("accepted","queued","running","completed","failed") }
        } catch (_: Exception) { false }
        if (!confirmed && !RemoteHealth.foreground) RemoteNotices.show(context,"消息可能未送达","电脑还没有确认收到。点开核对，不会自动重发。",session,pin)
      }
    },30,TimeUnit.SECONDS)
  }
}
