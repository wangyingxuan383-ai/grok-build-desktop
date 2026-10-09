package expo.modules.grokremote

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** Data-only pushes use the same event ledger and notification policy as LAN monitoring. */
class RemoteMessagingService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val computer = data["computer"] ?: return
    val id = data["noticeId"] ?: return
    val kind = data["kind"] ?: return
    if (id.isBlank() || id.length > 512 || !computer.matches(Regex("[a-fA-F0-9]{64}"))) return
    // A push cannot invent a paired identity or bypass a per-computer policy.
    if (!getSharedPreferences("grok-notice-policy", MODE_PRIVATE).contains("$computer:completed")) return
    RemoteNotices.event(this, id, kind, data["sessionId"] ?: "", computer)
  }
}
