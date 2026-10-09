package expo.modules.grokremote

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/** Public release networking is separate from pinned Desktop traffic and sends no credentials. */
object RemoteUpdater {
  private const val REPOSITORY = "wangyingxuan383-ai/grok-build-desktop"
  private val hosts = setOf("github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com")
  private val network = OkHttpClient.Builder().followRedirects(false).connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS).callTimeout(15, TimeUnit.MINUTES).build()
  @Volatile private var call: Call? = null
  @Volatile private var cancelled = false
  @Volatile private var state: Map<String, Any> = mapOf("phase" to "idle", "received" to 0, "revision" to 0.0)
  @Volatile private var revision = 0L
  /** Every state carries an increasing revision so a late snapshot can never overwrite newer progress. */
  @Synchronized fun status(): Map<String, Any> = state.toMap()
  /** After a restart, a verified download (APK + its record) is offered again instead of downloading twice. */
  @Synchronized fun restore(context: Context): Map<String, Any> {
    if (state["phase"] != "idle") return status()
    val file = target(context); val record = File(file.path + ".json")
    if (!file.isFile || !record.isFile) return status()
    try {
      val saved = org.json.JSONObject(record.readText())
      val version = saved.getString("version"); val sha256 = saved.getString("sha256")
      if (digest(file) == sha256) { revision++; state = mapOf("phase" to "ready", "received" to file.length(), "total" to file.length(), "version" to version, "sha256" to sha256, "revision" to revision.toDouble()) }
    } catch (_: Exception) {}
    return status()
  }
  fun cancel() { cancelled = true; call?.cancel() }
  fun release(): String {
    val request = Request.Builder().url("https://api.github.com/repos/$REPOSITORY/releases/latest")
      .header("Accept", "application/vnd.github+json").header("User-Agent", "Grok-Remote").build()
    network.newBuilder().callTimeout(20, TimeUnit.SECONDS).build().newCall(request).execute().use { response ->
      check(response.isSuccessful) { "更新检查失败（HTTP ${response.code}），请稍后重试" }
      val body = response.body ?: error("更新服务返回空响应")
      val bytes = body.byteStream().use { input ->
        val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
        while (output.size() <= 2 * 1024 * 1024) {
          val count = input.read(buffer); if (count < 0) break; output.write(buffer, 0, count)
        }
        output.toByteArray()
      }
      check(bytes.size <= 2 * 1024 * 1024) { "更新响应过大" }
      return bytes.toString(Charsets.UTF_8)
    }
  }
  @Synchronized private fun stamp(next: Map<String, Any>): Map<String, Any> { revision++; val stamped = next + ("revision" to revision.toDouble()); state = stamped; return stamped }
  private fun update(next: Map<String, Any>, emit: (Map<String, Any>) -> Unit) { emit(stamp(next)) }
  private fun target(context: Context) = File(context.cacheDir, "grok-updates/update.apk")
  private fun digest(file: File): String {
    val hash = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val n = input.read(buffer); if (n < 0) break; hash.update(buffer, 0, n) } }
    return hash.digest().joinToString("") { "%02x".format(it) }
  }
  @Suppress("DEPRECATION") private fun validate(context: Context, file: File, version: String) {
    val pm = context.packageManager
    val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    val archive = pm.getPackageArchiveInfo(file.path, flags) ?: error("下载文件不是有效 APK")
    val installed = pm.getPackageInfo(context.packageName, flags)
    check(archive.packageName == context.packageName && archive.versionName == version) { "APK 包名或版本不匹配" }
    val nextCode = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
    val currentCode = if (Build.VERSION.SDK_INT >= 28) installed.longVersionCode else installed.versionCode.toLong()
    check(nextCode > currentCode) { "此 APK 不是可升级的新版本" }
    val next = if (Build.VERSION.SDK_INT >= 28) archive.signingInfo?.apkContentsSigners else archive.signatures
    val current = if (Build.VERSION.SDK_INT >= 28) installed.signingInfo?.apkContentsSigners else installed.signatures
    check(!next.isNullOrEmpty() && !current.isNullOrEmpty() && next.toSet() == current.toSet()) { "APK 签名与当前应用不一致，拒绝安装" }
  }
  fun download(context: Context, url: String, sha256: String, size: Long, version: String, emit: (Map<String, Any>) -> Unit): Map<String, Any> {
    val first = Uri.parse(url)
    require(first.scheme == "https" && first.host == "github.com" && first.port == -1 && first.userInfo == null && first.query == null && first.fragment == null &&
      first.path?.startsWith("/$REPOSITORY/releases/download/") == true && first.lastPathSegment == "Grok-Remote-v$version.apk") { "APK 下载地址无效" }
    require(sha256.matches(Regex("[0-9a-f]{64}")) && size in 1..300L * 1024 * 1024) { "APK 校验信息无效" }
    synchronized(this) {
      if (state["phase"] == "downloading") return status()
      cancelled = false
      update(mapOf("phase" to "downloading", "received" to 0, "total" to size, "version" to version), emit)
    }
    val file = target(context); val partial = File(file.parentFile, "update.partial")
    try {
      check(file.parentFile!!.mkdirs() || file.parentFile!!.isDirectory) { "无法创建更新缓存" }
      var next = url; var completed = false
      for (hop in 0..5) {
        check(!cancelled) { "已取消下载" }
        val destination = Uri.parse(next)
        check(destination.scheme == "https" && destination.host in hosts && destination.userInfo == null && destination.port == -1) { "拒绝不受信任的下载跳转" }
        val active = network.newCall(Request.Builder().url(next).header("User-Agent", "Grok-Remote").build()); call = active
        active.execute().use { response ->
          if (response.code in listOf(301, 302, 303, 307, 308)) {
            val location = response.header("Location") ?: error("下载跳转无地址")
            next = response.request.url.resolve(location)?.toString() ?: error("下载跳转无效")
          } else {
            check(response.isSuccessful) { "下载失败（HTTP ${response.code}）" }
            val body = response.body ?: error("下载内容为空")
            check(body.contentLength() == -1L || body.contentLength() == size) { "APK 大小与发布信息不一致" }
            var received = 0L; var lastPercent = -1L
            body.byteStream().use { input -> partial.outputStream().use { output ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                check(!cancelled) { "已取消下载" }
                val count = input.read(buffer); if (count < 0) break
                received += count; check(received <= size) { "APK 下载大小异常" }; output.write(buffer, 0, count)
                val percent = received * 100 / size
                if (percent != lastPercent) { lastPercent = percent; update(mapOf("phase" to "downloading", "received" to received, "total" to size, "version" to version), emit) }
              }
            } }
            check(received == size && digest(partial) == sha256) { "APK 完整性校验失败，请重新下载" }
            validate(context, partial, version)
            check(!cancelled) { "已取消下载" }
            check(!file.exists() || file.delete()) { "无法清理旧更新" }
            check(partial.renameTo(file)) { "无法保存已校验更新" }
            try { File(target(context).path + ".json").writeText(org.json.JSONObject(mapOf("version" to version, "sha256" to sha256)).toString()) } catch (_: Exception) {}
            update(mapOf("phase" to "ready", "received" to size, "total" to size, "version" to version, "sha256" to sha256), emit)
            completed = true
          }
        }
        if (completed) break
      }
      check(completed) { "下载跳转次数过多" }
    } catch (error: Exception) {
      partial.delete()
      update(mapOf("phase" to "error", "received" to 0, "error" to (error.message ?: "更新下载失败")), emit)
    } finally { call = null }
    return status()
  }
  fun install(context: Context): String {
    val ready = status(); check(ready["phase"] == "ready") { "请先下载更新" }
    val file = target(context)
    if (!file.isFile || digest(file) != ready["sha256"]) {
      // The system may clear app cache: move to a recoverable state that offers a fresh download.
      file.delete(); File(file.path + ".json").delete()
      stamp(mapOf("phase" to "error", "received" to 0, "version" to (ready["version"] ?: ""), "error" to "已下载的更新文件已被系统清理或改变，请重新下载", "redownload" to true))
      error("已下载的更新文件已被系统清理或改变，请重新下载")
    }
    validate(context, file, ready["version"] as String)
    if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
      context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      return "permission"
    }
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.grokupdates", file)
    context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION))
    return "installer"
  }
}
