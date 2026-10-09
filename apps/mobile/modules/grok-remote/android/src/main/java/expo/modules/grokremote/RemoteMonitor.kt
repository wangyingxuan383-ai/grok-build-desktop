package expo.modules.grokremote

import android.app.Service
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import okhttp3.Request
import okhttp3.Call
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object RemoteNotices {
 fun channels(context:Context) { if(Build.VERSION.SDK_INT>=26){val manager=context.getSystemService(NotificationManager::class.java);manager.createNotificationChannel(NotificationChannel("grok-follow","持续跟进",NotificationManager.IMPORTANCE_LOW));for((id,name) in listOf("grok-completed" to "任务完成","grok-failed" to "任务失败","grok-attention" to "需要回应")){manager.createNotificationChannel(NotificationChannel(id,name,NotificationManager.IMPORTANCE_DEFAULT))}} }
 fun notification(context:Context,title:String,detail:String,session:String,computer:String,ongoing:Boolean=false):Notification {
  channels(context);val launch=context.packageManager.getLaunchIntentForPackage(context.packageName)!!
  launch.action=Intent.ACTION_VIEW;launch.data=Uri.parse("grokremote://conversation?computer="+Uri.encode(computer)+"&focus=inbox&session="+Uri.encode(session));launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  val pending=PendingIntent.getActivity(context,(computer+session).hashCode(),launch,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  val builder=if(Build.VERSION.SDK_INT>=26)Notification.Builder(context,if(ongoing)"grok-follow" else if(title.contains("失败"))"grok-failed" else if(title.contains("回应")||title.contains("撤销"))"grok-attention" else "grok-completed") else Notification.Builder(context)
  val privateContent=RemoteHealth.privateNotifications(context)
  builder.setSmallIcon(R.drawable.grok_notice).setContentTitle(if(privateContent)if(ongoing)"Grok Remote 持续跟进" else "Grok Remote 有新动态" else title.take(100)).setContentText(if(privateContent)"解锁应用查看详情。" else detail.take(150)).setContentIntent(pending).setOngoing(ongoing).setAutoCancel(!ongoing).setVisibility(Notification.VISIBILITY_PRIVATE)
  if(ongoing){val stop=Intent(context,RemoteMonitor::class.java).setAction("stop");val stopPending=PendingIntent.getService(context,19,stop,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE);builder.addAction(Notification.Action.Builder(android.R.drawable.ic_media_pause,"停止跟进",stopPending).build())}
  return builder.build()
 }
 fun event(context:Context,id:String,kind:String,session:String,computer:String) {
  if(NoticePresentation.deferToForeground(RemoteHealth.foreground,RemoteHealth.foregroundComputer,computer) || kind !in listOf("completion","failure","confirmation")) return
  if(RemoteHealth.claim(context,computer,listOf(id)).isEmpty()) return
  val title=when(kind){"confirmation"->"任务需要回应";"failure"->"任务执行失败";else->"任务已完成"}
  show(context,title,"打开应用查看对应任务。",session,computer)
 }

 fun show(context:Context,title:String,detail:String,session:String,computer:String){val preferences=context.getSharedPreferences("grok-notice-policy",Context.MODE_PRIVATE);val category=if(title.contains("失败"))"failed" else if(title.contains("回应")||title.contains("撤销"))"attention" else "completed";if(RemoteHealth.quiet(context,category))return;if(!preferences.getBoolean("$computer:$category",true)||preferences.getStringSet("$computer:muted",emptySet())!!.contains(session))return;context.getSystemService(NotificationManager::class.java).notify((computer+session+title).hashCode(),notification(context,title,detail,session,computer))}
}

/** Explicit LAN/VPN monitoring. It never wakes the computer or resends tasks. */
class RemoteMonitor : Service() {
 companion object {
  @Volatile var following=false
  @Volatile var phase="stopped"
  @Volatile var attempts=0
  @Volatile var lastSync=0L
  @Volatile var computer=""
  @Volatile var stopReason=""
 }
 private val executor=Executors.newSingleThreadExecutor()
 @Volatile private var running=false
 @Volatile private var generation=0
 @Volatile private var call:Call?=null
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
  if(intent?.action=="stop"){stopSelf();return START_NOT_STICKY}
  val host=intent?.getStringExtra("host")?:return START_NOT_STICKY
  val pin=intent.getStringExtra("pin")?:return START_NOT_STICKY
  val token=intent.getStringExtra("token")?:return START_NOT_STICKY
  val name=intent.getStringExtra("name")?:"电脑"
  call?.cancel();val current=++generation
  running=true;following=true;phase="connecting";attempts=0;stopReason="";computer=name
  startForeground(49001,RemoteNotices.notification(this,"正在跟进 $name","正在连接电脑…","",pin,true))
  executor.execute {
   try {
    val client=PinnedHttps.create(host,pin,false).newBuilder().readTimeout(25,TimeUnit.SECONDS).callTimeout(0,TimeUnit.SECONDS).build()
    val preferences=getSharedPreferences("grok-remote-monitor",Context.MODE_PRIVATE)
    var cursor=0L;var epoch="";var backoff=1000L;var lastInbox=0L
    fun active()=running&&current==generation&&!Thread.currentThread().isInterrupted
    fun readInbox() {
     if(!active())return
     lastInbox=System.currentTimeMillis()
     try {
      val request=Request.Builder().url(host.trimEnd('/')+"/v1/workbench?kind=notifications").header("Authorization","Bearer $token").build()
      client.newCall(request).execute().use { response ->
       if(!response.isSuccessful||!active())return@use
       val items=JSONObject(response.body?.string()?:"{}").optJSONArray("items")?:return@use
       val entries=(0 until items.length()).map{items.getJSONObject(it)}
       val initial=RemoteHealth.baseline(this,pin,entries.map{it.optString("id")})
       if(!initial) for(item in entries) {
        val id=item.optString("id")
        if(id.isNotBlank()&&!item.optBoolean("read",false))RemoteNotices.event(this,id,item.optString("kind"),item.optString("sessionId"),pin)
       }
      }
     } catch(_:Exception) { /* Next poll retries; no execution requests are made. */ }
    }
    while(active()) {
     try {
      val mode=preferences.getString("mode","always")?:"always"
      if(!RemoteHealth.allowed(this,mode)) {
       if(phase!="paused"){phase="paused";ongoing(name,pin,if(mode=="wifi")"已暂停：当前不是 Wi-Fi，连上后自动继续" else "已暂停：屏幕关闭时不跟进")}
       Thread.sleep(5000);continue
      }
      val request=Request.Builder().url(host.trimEnd('/')+"/v1/events?cursor=$cursor&epoch=$epoch").header("Authorization","Bearer $token").build()
      val stream=client.newCall(request);call=stream
      stream.execute().use { response ->
       if(!active())return@use
       if(response.code==401||response.code==403){RemoteNotices.show(this,"电脑访问已撤销","打开应用重新配对。","",pin);stopReason="电脑已撤销这部手机的访问";running=false;return@use}
       check(response.isSuccessful){"无法同步"}
       val source=response.body?.source()?:error("无响应")
       backoff=1000;phase="online";attempts=0;lastSync=System.currentTimeMillis()
       ongoing(name,pin,"已连接 · 任务继续在电脑执行，可随时停止跟进")
       readInbox()
       while(active()&&!stream.isCanceled()) {
        if(!RemoteHealth.allowed(this,preferences.getString("mode","always")?:"always")){stream.cancel();break}
        val line=source.readUtf8Line()?:break
        lastSync=System.currentTimeMillis()
        if(line.startsWith("data: ")){val event=JSONObject(line.substring(6));cursor=event.optLong("cursor",cursor);epoch=event.optString("epoch",epoch)}
        if(System.currentTimeMillis()-lastInbox>14000)readInbox()
       }
      }
     } catch(_:InterruptedException) { break }
     catch(_:Exception) {
      if(active()) {
       attempts++;phase="retrying";ongoing(name,pin,"连接中断，正在重连（第 $attempts 次）")
       try{Thread.sleep(backoff)}catch(_:InterruptedException){break}
       backoff=(backoff*2).coerceAtMost(30000)
      }
     }
    }
   } catch(_:Exception) { if(current==generation)stopReason="连接设置无效，请重新连接电脑" }
   finally { if(current==generation)stopSelf() }
  }
  return START_NOT_STICKY
 }
 private fun ongoing(name:String,pin:String,detail:String) {
  try{getSystemService(NotificationManager::class.java).notify(49001,RemoteNotices.notification(this,"正在跟进 $name",detail,"",pin,true))}catch(_:Exception){}
 }
 override fun onDestroy(){running=false;following=false;phase="stopped";call?.cancel();executor.shutdownNow();if(Build.VERSION.SDK_INT>=24)stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()}
}
