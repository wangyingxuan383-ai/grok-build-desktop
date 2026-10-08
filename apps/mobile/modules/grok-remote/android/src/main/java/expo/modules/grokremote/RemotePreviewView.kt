package expo.modules.grokremote
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import okhttp3.Request
import java.io.ByteArrayInputStream

/** Every page/resource is fetched through the existing pinned transport. No app bridge. */
class RemotePreviewView(context:Context,appContext:AppContext):ExpoView(context,appContext){
 private val web=WebView(context);private var host="";private var ticket="";private var token="";private var pin=""
 init {
  addView(web,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.MATCH_PARENT));web.settings.javaScriptEnabled=true;web.settings.domStorageEnabled=true;web.settings.allowFileAccess=false;web.settings.allowContentAccess=false;web.settings.mixedContentMode=0
  web.webViewClient=object:WebViewClient(){
   override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse {
    val prefix=host.trimEnd('/')+"/v1/preview/"+ticket+"/";val url=request.url.toString()
    if(!url.startsWith(prefix)||request.method!="GET")return WebResourceResponse("text/plain","UTF-8",403,"Blocked",emptyMap(),ByteArrayInputStream("此预览不提供应用接口或外部网络".toByteArray()))
    return try{val client=PinnedHttps.create(host,pin,false);client.newCall(Request.Builder().url(url).header("Authorization","Bearer $token").build()).execute().use{response->val body=response.body?:throw IllegalStateException("No response");val bytes=body.bytes();require(bytes.size<=20*1024*1024);val type=response.header("Content-Type")?:"text/plain";val headers=mutableMapOf<String,String>();response.header("Content-Security-Policy")?.let{headers["Content-Security-Policy"]=it};WebResourceResponse(type.substringBefore(';'),"UTF-8",response.code,response.message.ifBlank{"Response"},headers,ByteArrayInputStream(bytes))}}catch(_:Exception){WebResourceResponse("text/plain","UTF-8",502,"Unavailable",emptyMap(),ByteArrayInputStream("预览加载失败，请返回后重试。".toByteArray()))}
   }
   override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean {val url=request.url.toString();if(url.startsWith(host.trimEnd('/')+"/v1/preview/"+ticket+"/"))return false;if(request.isForMainFrame&&request.url.scheme in listOf("https","http"))try{context.startActivity(Intent(Intent.ACTION_VIEW,request.url).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}catch(_:Exception){};return true}
  }
 }
 fun source(value:Map<String,String>){host=value["host"]?:"";pin=value["fingerprint"]?:"";token=value["token"]?:"";ticket=value["ticket"]?:"";if(host.isNotBlank()&&pin.isNotBlank()&&token.isNotBlank()&&ticket.isNotBlank())web.loadUrl(host.trimEnd('/')+"/v1/preview/"+ticket+"/index.html")}
 override fun onDetachedFromWindow(){web.stopLoading();super.onDetachedFromWindow()}
}
