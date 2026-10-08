package expo.modules.grokremote

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.net.SocketTimeoutException
import java.net.ConnectException
import javax.net.ssl.SSLHandshakeException
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.io.File
import java.io.FileOutputStream
import android.content.Intent
import androidx.core.content.ContextCompat

/** Trust only the Desktop identity scanned at pairing, including across IP changes. */
class GrokRemoteModule : Module() {
  private val executor = Executors.newFixedThreadPool(4)
  private val downloads = Executors.newFixedThreadPool(2)
  private var eventCall: Call? = null
  private var activeStreamId = ""
  private var clientKey = ""
  private var pinnedClient: OkHttpClient? = null
  private val tls12Hosts = mutableSetOf<String>()
  override fun definition() = ModuleDefinition {
    Name("GrokRemote")
    Events("remoteEvent", "mobileUpdate")
    AsyncFunction("publicRelease") { promise: Promise -> executor.execute { try { promise.resolve(RemoteUpdater.release()) } catch (error: Exception) { promise.reject("ERR_UPDATE", error.message, error) } } }
    AsyncFunction("mobileUpdateStatus") { RemoteUpdater.status() }
    AsyncFunction("cancelMobileUpdate") { RemoteUpdater.cancel() }
    AsyncFunction("downloadMobileUpdate") { url: String, sha256: String, size: Double, version: String, promise: Promise -> downloads.execute { try {
      val context = appContext.reactContext ?: error("应用不可用")
      promise.resolve(RemoteUpdater.download(context, url, sha256, size.toLong(), version) { sendEvent("mobileUpdate", it) })
    } catch (error: Exception) { promise.reject("ERR_UPDATE", error.message, error) } } }
    AsyncFunction("installMobileUpdate") { promise: Promise -> executor.execute { try {
      val context = appContext.reactContext ?: error("应用不可用")
      promise.resolve(RemoteUpdater.install(context))
    } catch (error: Exception) { promise.reject("ERR_UPDATE", error.message, error) } } }
    AsyncFunction("pushToken") {options:Map<String,String>,promise:Promise -> executor.execute{val context=appContext.reactContext;if(context==null)promise.reject("ERR_REMOTE_PUSH","应用不可用",null)else RemotePush.token(context,options,promise)} }
    AsyncFunction("sharedItems") {promise:Promise -> executor.execute{try{val context=appContext.reactContext?:throw IllegalStateException("应用不可用");val intent=appContext.currentActivity?.intent;val result=mutableListOf<Map<String,Any>>();var text="";if(intent!=null&&intent.action in listOf(Intent.ACTION_SEND,Intent.ACTION_SEND_MULTIPLE)){
      text=intent.getStringExtra(Intent.EXTRA_TEXT)?:"";val uris=mutableListOf<android.net.Uri>();@Suppress("DEPRECATION") val single=intent.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM);if(single!=null)uris.add(single);@Suppress("DEPRECATION") val multiple=intent.getParcelableArrayListExtra<android.net.Uri>(Intent.EXTRA_STREAM);if(multiple!=null)uris.addAll(multiple)
      for(uri in uris.distinct().take(12)){var name="附件";context.contentResolver.query(uri,arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),null,null,null)?.use{cursor->if(cursor.moveToFirst())name=cursor.getString(0)};name=name.replace(Regex("[\\\\/:*?\"<>|]"),"_").take(120);val target=File(context.cacheDir,java.util.UUID.randomUUID().toString()+"-"+name);var total=0L;context.contentResolver.openInputStream(uri)?.use{input->FileOutputStream(target).use{output->val buffer=ByteArray(65536);while(true){val count=input.read(buffer);if(count<0)break;total+=count;require(total<=50L*1024*1024){"分享文件超过 50 MB，请使用电脑处理"};output.write(buffer,0,count)}}}?:throw IllegalStateException("分享文件不可读取");result.add(mapOf("uri" to  android.net.Uri.fromFile(target).toString(),"name" to  name,"size" to  total,"mimeType" to (context.contentResolver.getType(uri)?:"application/octet-stream")))};intent.action=Intent.ACTION_MAIN;intent.removeExtra(Intent.EXTRA_STREAM);intent.removeExtra(Intent.EXTRA_TEXT)
    };promise.resolve(mapOf("text" to  text.take(65536),"files" to  result))}catch(error:Exception){promise.reject("ERR_REMOTE_SHARE",error.message,error)}} }
    AsyncFunction("discover") {promise:Promise -> val context=appContext.reactContext?:throw IllegalStateException("应用不可用");RemoteDiscovery.discover(context,promise)}
    View(RemotePreviewView::class) { Prop("source") { view:RemotePreviewView,source:Map<String,String> -> view.source(source) } }
    AsyncFunction("download") { host:String,fingerprint:String,token:String,path:String,destination:String,promise:Promise ->
      downloads.execute { try { val context=appContext.reactContext?:throw IllegalStateException("应用不可用");val target=File(android.net.Uri.parse(destination).path?:"").canonicalFile;require(target.path.startsWith(context.cacheDir.canonicalPath+File.separator)){"下载仅可保存到应用缓存"};target.parentFile?.mkdirs();val request=buildRequest(host,fingerprint,token,path,"GET","");client(host,fingerprint).newCall(request).execute().use{response->require(response.isSuccessful){"文件下载失败 (${response.code})"};val body=response.body?:throw IllegalStateException("文件无内容");require(body.contentLength()<=50L*1024*1024){"文件超过下载上限"};var total=0L;body.byteStream().use{input->FileOutputStream(target).use{output->val buffer=ByteArray(65536);while(true){val count=input.read(buffer);if(count<0)break;total+=count;require(total<=50L*1024*1024){"文件超过下载上限"};output.write(buffer,0,count)}}}};RemoteCache.prune(context,target);promise.resolve(android.net.Uri.fromFile(target).toString())}catch(error:Exception){promise.reject("ERR_REMOTE_DOWNLOAD",error.message,error)} }
    }
    AsyncFunction("setMonitoring") {host:String,fingerprint:String,token:String,name:String,enabled:Boolean ->
      val context=appContext.reactContext?:throw IllegalStateException("应用不可用");val intent=Intent(context,RemoteMonitor::class.java);if(enabled){intent.putExtra("host",host).putExtra("pin",fingerprint).putExtra("token",token).putExtra("name",name);ContextCompat.startForegroundService(context,intent)}else context.stopService(intent)
    }
    AsyncFunction("monitoringStatus") { RemoteMonitor.following }
    AsyncFunction("noticePolicy") {computer:String,completed:Boolean,failed:Boolean,attention:Boolean,muted:List<String> -> val context=appContext.reactContext?:throw IllegalStateException("应用不可用");context.getSharedPreferences("grok-notice-policy",android.content.Context.MODE_PRIVATE).edit().putBoolean("$computer:completed",completed).putBoolean("$computer:failed",failed).putBoolean("$computer:attention",attention).putStringSet("$computer:muted",muted.take(1000).toSet()).apply()}
    AsyncFunction("cachePin") {path:String,active:Boolean -> val context=appContext.reactContext?:throw IllegalStateException("应用不可用");RemoteCache.pin(context,path,active)}
    AsyncFunction("cacheUsage") { clear:Boolean -> val context=appContext.reactContext?:throw IllegalStateException("应用不可用");val files=context.cacheDir.listFiles()?.filter{it.isFile&&(it.name.startsWith("grok-thumb-")||it.name.startsWith("grok-download-")||it.name.startsWith("grok-full-"))}?:emptyList();val bytes=files.sumOf{it.length()};if(clear)files.forEach{it.delete()};bytes.toDouble() }
    AsyncFunction("normalizeImage") {uri:String,name:String,promise:Promise -> downloads.execute{try{val context=appContext.reactContext?:throw IllegalStateException("应用不可用");val source=File(android.net.Uri.parse(uri).path?:"").canonicalFile;require(source.path.startsWith(context.cacheDir.canonicalPath+File.separator)||source.path.startsWith(context.filesDir.canonicalPath+File.separator));val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true};android.graphics.BitmapFactory.decodeFile(source.path,bounds);require(bounds.outWidth>0&&bounds.outHeight>0){"系统无法解码此图片，请选择 PNG / JPEG / WebP"};var sample=1;while(bounds.outWidth/sample>4096||bounds.outHeight/sample>4096)sample*=2;val options=android.graphics.BitmapFactory.Options().apply{inSampleSize=sample};val bitmap=if(android.os.Build.VERSION.SDK_INT>=28)android.graphics.ImageDecoder.decodeBitmap(android.graphics.ImageDecoder.createSource(source)){decoder,_,_->decoder.allocator=android.graphics.ImageDecoder.ALLOCATOR_SOFTWARE;decoder.setTargetSampleSize(sample)}else android.graphics.BitmapFactory.decodeFile(source.path,options)?:throw IllegalStateException("图片转换失败");val target=File(context.cacheDir,"grok-share-"+java.util.UUID.randomUUID()+".jpg");FileOutputStream(target).use{bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,92,it)};bitmap.recycle();promise.resolve(mapOf("uri" to android.net.Uri.fromFile(target).toString(),"name" to name.substringBeforeLast('.',name)+".jpg","size" to target.length().toDouble(),"mimeType" to "image/jpeg"))}catch(error:Exception){promise.reject("ERR_REMOTE_IMAGE",error.message,error)}} }
    AsyncFunction("pdfPages") {path:String,start:Int,promise:Promise -> executor.execute{try{val context=appContext.reactContext?:throw IllegalStateException("应用不可用");val file=File(android.net.Uri.parse(path).path?:"").canonicalFile;require(file.path.startsWith(context.cacheDir.canonicalPath+File.separator));android.graphics.pdf.PdfRenderer(android.os.ParcelFileDescriptor.open(file,android.os.ParcelFileDescriptor.MODE_READ_ONLY)).use{renderer->val pages=mutableListOf<Map<String,Any>>();for(index in start.coerceAtLeast(0) until (start+3).coerceAtMost(renderer.pageCount)){renderer.openPage(index).use{page->val width=1400;val height=(page.height.toDouble()/page.width*width).toInt();val bitmap=android.graphics.Bitmap.createBitmap(width,height,android.graphics.Bitmap.Config.ARGB_8888);bitmap.eraseColor(android.graphics.Color.WHITE);page.render(bitmap,null,null,android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);val target=File(context.cacheDir,file.name+"-page-$index.png");FileOutputStream(target).use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle();pages.add(mapOf("index" to index,"uri" to android.net.Uri.fromFile(target).toString(),"width" to width,"height" to height))}};promise.resolve(mapOf("total" to renderer.pageCount,"pages" to pages))}}catch(error:Exception){promise.reject("ERR_REMOTE_PDF",error.message,error)}} }
    AsyncFunction("saveDownload") {path:String,name:String,mimeType:String,promise:Promise -> executor.execute{try{val context=appContext.reactContext?:throw IllegalStateException("应用不可用");val source=File(android.net.Uri.parse(path).path?:"").canonicalFile;require(source.path.startsWith(context.cacheDir.canonicalPath+File.separator));require(android.os.Build.VERSION.SDK_INT>=29){"此系统请使用分享入口保存文件"};val values=android.content.ContentValues().apply{put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,name);put(android.provider.MediaStore.MediaColumns.MIME_TYPE,mimeType);put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,if(mimeType.startsWith("image/"))"Pictures/Grok Remote" else "Download/Grok Remote");put(android.provider.MediaStore.MediaColumns.IS_PENDING,1)};val collection=if(mimeType.startsWith("image/"))android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI else android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI;val uri=context.contentResolver.insert(collection,values)?:throw IllegalStateException("系统未提供保存位置");try{context.contentResolver.openOutputStream(uri)?.use{output->source.inputStream().use{it.copyTo(output)}}?:throw IllegalStateException("无法保存");values.clear();values.put(android.provider.MediaStore.MediaColumns.IS_PENDING,0);context.contentResolver.update(uri,values,null,null);promise.resolve(uri.toString())}catch(error:Exception){context.contentResolver.delete(uri,null,null);throw error}}catch(error:Exception){promise.reject("ERR_REMOTE_SAVE",error.message,error)}} }
    AsyncFunction("notify") {title:String,detail:String,sessionId:String,computer:String -> val context=appContext.reactContext?:throw IllegalStateException("应用不可用");if(!RemoteMonitor.following)RemoteNotices.show(context,title,detail,sessionId,computer)}
    AsyncFunction("request") { host: String, fingerprint: String, token: String, path: String, method: String, body: String, promise: Promise ->
      executor.execute { try {
        val request = buildRequest(host, fingerprint, token, path, method, body)
        val result = try { executeRequest(client(host, fingerprint), request) } catch (error: SSLHandshakeException) {
          if (method != "GET" || path != "/v1/info" || !mayTryTls12(error)) throw error
          val fallback = PinnedHttps.create(host, fingerprint, true)
          val response = executeRequest(fallback, request)
          synchronized(this) { tls12Hosts.add("$host:$fingerprint"); pinnedClient = fallback; clientKey = "$host:$fingerprint" }
          response
        }
        promise.resolve(result)
      } catch (error: Exception) {
        val failure = connectionFailure(error, host)
        promise.reject(failure.first, failure.second, error)
      } }
    }
    AsyncFunction("startEvents") { host: String, fingerprint: String, token: String, path: String, streamId: String ->
      eventCall?.cancel()
      val request = buildRequest(host, fingerprint, token, path, "GET", "")
      val call = client(host, fingerprint).newBuilder().readTimeout(45, TimeUnit.SECONDS).callTimeout(0, TimeUnit.SECONDS).build().newCall(request)
      eventCall = call
      activeStreamId = streamId
      executor.execute {
        try {
          call.execute().use { response ->
            if (!response.isSuccessful) throw IllegalStateException(if (response.code == 401) "设备已撤销，请重新配对" else "连接失败 (${response.code})")
            val source = response.body?.source() ?: throw IllegalStateException("事件连接没有响应")
            while (!call.isCanceled()) {
              val line = source.readUtf8Line() ?: break
              if (line.length > 65536) throw IllegalStateException("事件数据过大")
              if (line.startsWith("data: ")) sendEvent("remoteEvent", mapOf("streamId" to streamId, "kind" to "data", "text" to line.substring(6)))
            }
          }
          if (!call.isCanceled()) sendEvent("remoteEvent", mapOf("streamId" to streamId, "kind" to "error", "text" to "电脑连接已断开"))
        } catch (error: Exception) {
          if (!call.isCanceled()) { val failure=connectionFailure(error,host);sendEvent("remoteEvent", mapOf("streamId" to streamId, "kind" to "error", "text" to failure.second, "code" to failure.first)) }
        }
      }
    }
    AsyncFunction("stopEvents") { streamId: String -> if (activeStreamId == streamId) { eventCall?.cancel(); eventCall = null; activeStreamId = "" } }
    OnDestroy { eventCall?.cancel(); executor.shutdownNow(); downloads.shutdownNow() }
  }
  @Synchronized private fun client(host: String, pin: String): OkHttpClient {
    val key = "$host:$pin"
    if (clientKey == key && pinnedClient != null) return pinnedClient!!
    val next = PinnedHttps.create(host, pin, tls12Hosts.contains(key))
    pinnedClient = next; clientKey = key; return next
  }
  private fun buildRequest(host: String, pin: String, token: String, path: String, method: String, body: String): Request {
    client(host, pin)
    require(path.startsWith("/v1/") && !path.contains("\\") && !path.contains("..")) { "接口路径无效" }
    require(method == "GET" || method == "POST") { "接口方法无效" }
    val request = Request.Builder().url(host.trimEnd('/') + path).header("Accept", "application/json")
    if (token.isNotBlank()) request.header("Authorization", "Bearer $token")
    if (method == "POST") request.post(body.toRequestBody("application/json; charset=utf-8".toMediaType()))
    return request.build()
  }
  private fun executeRequest(client:OkHttpClient,request:Request):Map<String,Any> = client.newCall(request).execute().use { response ->
    val source=response.body ?: throw IllegalStateException("电脑返回空响应")
    if(source.contentLength()>4*1024*1024)throw IllegalStateException("响应过大，请减少历史范围")
    val text=source.string();if(text.length>4*1024*1024)throw IllegalStateException("响应过大，请减少历史范围")
    mapOf("status" to response.code,"text" to text)
  }
  private fun mayTryTls12(error:Exception):Boolean { val chain=generateSequence<Throwable>(error){it.cause}.take(8).joinToString(" "){it.message?:""};return !chain.contains("电脑身份")&&!chain.contains("证书")&&(chain.contains("closed",true)||chain.contains("protocol",true)||chain.contains("handshake_failure",true)) }
  private fun connectionFailure(error:Exception,host:String):Pair<String,String> {
    val causes=generateSequence<Throwable>(error){it.cause}.take(8).toList();val detail=causes.joinToString(" · "){it.message?:it.javaClass.simpleName}
    return when {
      detail.contains("电脑身份") -> "ERR_REMOTE_IDENTITY" to "电脑证书身份已变化。请在电脑刷新二维码后重新配对。"
      causes.any{it is java.security.cert.CertificateExpiredException||it is java.security.cert.CertificateNotYetValidException} -> "ERR_REMOTE_CERT_TIME" to "电脑证书时间无效，请检查手机和电脑的系统时间。"
      causes.any{it is SocketTimeoutException||it is ConnectException} -> "ERR_REMOTE_CONNECT" to "无法连接电脑 $host。请选择同一 Wi-Fi 的 WLAN 地址，并检查电脑手机连接开关和 Windows 网络访问许可。"
      causes.any{it is SSLHandshakeException} -> "ERR_REMOTE_TLS" to "已尝试连接 $host，但加密握手中断。请使用电脑当前二维码重试，并查看电脑“连接诊断”。"
      else -> "ERR_REMOTE_NETWORK" to "电脑连接失败：${detail.take(500)}"
    }
  }
}
