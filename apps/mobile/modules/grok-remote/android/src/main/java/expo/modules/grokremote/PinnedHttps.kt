package expo.modules.grokremote

import okhttp3.ConnectionSpec
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.TlsVersion
import java.net.Proxy
import java.net.URI
import java.security.MessageDigest
import java.security.Provider
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

object PinnedHttps {
  fun fingerprint(cert: X509Certificate): String = MessageDigest.getInstance("SHA-256").digest(cert.encoded).joinToString("") { "%02x".format(it) }
  fun create(host: String, pin: String, tls12Only: Boolean = false, provider: Provider? = null): OkHttpClient {
    require(pin.matches(Regex("[0-9a-f]{64}"))) { "电脑证书指纹无效" }
    val origin = URI(host)
    require(origin.scheme == "https" && origin.host != null && origin.userInfo == null && origin.query == null && origin.fragment == null && (origin.path.isNullOrEmpty() || origin.path == "/")) { "请输入有效的电脑 HTTPS 地址" }
    val trust = object : X509TrustManager {
      override fun getAcceptedIssuers() = emptyArray<X509Certificate>()
      override fun checkClientTrusted(chain: Array<X509Certificate>, auth: String) { throw CertificateException("不接受客户端证书") }
      override fun checkServerTrusted(chain: Array<X509Certificate>, auth: String) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("电脑证书不存在")
        leaf.checkValidity()
        if (fingerprint(leaf) != pin) throw CertificateException("电脑身份已变化，请在电脑重新配对")
      }
    }
    val context = (if (provider == null) SSLContext.getInstance("TLS") else SSLContext.getInstance("TLS", provider)).apply { init(null, arrayOf(trust), SecureRandom()) }
    val spec = if (tls12Only) ConnectionSpec.Builder(ConnectionSpec.MODERN_TLS).tlsVersions(TlsVersion.TLS_1_2).build() else ConnectionSpec.MODERN_TLS
    return OkHttpClient.Builder().sslSocketFactory(context.socketFactory, trust)
      .hostnameVerifier { _, session -> (session.peerCertificates.firstOrNull() as? X509Certificate)?.let { fingerprint(it) == pin } == true }
      .proxy(Proxy.NO_PROXY).protocols(listOf(Protocol.HTTP_1_1)).connectionSpecs(listOf(spec))
      .retryOnConnectionFailure(false).followRedirects(false).followSslRedirects(false)
      .connectTimeout(8, TimeUnit.SECONDS).readTimeout(20, TimeUnit.SECONDS).callTimeout(25, TimeUnit.SECONDS).build()
  }
}
