package expo.modules.grokremote
import org.junit.Test
import org.junit.Assert.*
import org.conscrypt.Conscrypt
import okhttp3.Request
import java.security.Security

/** Exercises the shipped factory against the actual Desktop with Android's BoringSSL provider family. */
class PinnedHttpsTest {
  private val host = System.getenv("GROK_TLS_PROBE_HOST") ?: ""
  private val pin = System.getenv("GROK_TLS_PROBE_PIN") ?: ""
  @Test fun pinnedDesktopHandshakeUsesTls12AndTls13() {
    if (host.isEmpty()) return
    val provider=Conscrypt.newProvider();Security.insertProviderAt(provider,1)
    for (only12 in listOf(false,true)) {
      val client=PinnedHttps.create(host,pin,only12,provider)
      client.newCall(Request.Builder().url("$host/v1/info").build()).execute().use { response ->
        assertEquals(200,response.code);assertTrue(response.body!!.string().contains("protocol"))
      }
      client.connectionPool.evictAll();client.dispatcher.executorService.shutdown()
    }
  }
  @Test fun wrongPinnedIdentityIsRejected() {
    if(host.isEmpty())return
    val client=PinnedHttps.create(host,"0".repeat(64),true,Conscrypt.newProvider())
    try {client.newCall(Request.Builder().url("$host/v1/info").build()).execute().close();fail("A different Desktop identity must not be accepted")}
    catch(expected:Exception){assertTrue(generateSequence<Throwable>(expected){it.cause}.any{it.message?.contains("电脑身份") == true})}
    finally{client.connectionPool.evictAll();client.dispatcher.executorService.shutdown()}
  }
}
