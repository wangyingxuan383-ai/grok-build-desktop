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
  builder.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title.take(100)).setContentText(detail.take(150)).setContentIntent(pending).setOngoing(ongoing).setAutoCancel(!ongoing).setVisibility(Notification.VISIBILITY_PRIVATE)
  if(ongoing){val stop=Intent(context,RemoteMonitor::class.java).setAction("stop");val stopPending=PendingIntent.getService(context,19,stop,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE);builder.addAction(Notification.Action.Builder(android.R.drawable.ic_media_pause,"停止跟进",stopPending).build())}
  return builder.build()
 }
 fun show(context:Context,title:String,detail:String,session:String,computer:String){val preferences=context.getSharedPreferences("grok-notice-policy",Context.MODE_PRIVATE);val category=if(title.contains("失败"))"failed" else if(title.contains("回应")||title.contains("撤销"))"attention" else "completed";if(!preferences.getBoolean("$computer:$category",true)||preferences.getStringSet("$computer:muted",emptySet())!!.contains(session))return;context.getSystemService(NotificationManager::class.java).notify((computer+session+title).hashCode(),notification(context,title,detail,session,computer))}
}

/** Explicit, visible LAN/VPN monitoring. Does not keep the agent or phone awake. */
class RemoteMonitor:Service(){
 companion object { @Volatile var following=false }
 private val executor=Executors.newSingleThreadExecutor();@Volatile private var running=false;@Volatile private var generation=0;private var call:Call?=null
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
  if(intent?.action=="stop"){stopSelf();return START_NOT_STICKY}
  val host=intent?.getStringExtra("host")?:return START_NOT_STICKY;val pin=intent.getStringExtra("pin")?:return START_NOT_STICKY;val token=intent.getStringExtra("token")?:return START_NOT_STICKY;val name=intent.getStringExtra("name")?:"电脑"
  call?.cancel();val current=++generation;running=true;following=true;startForeground(49001,RemoteNotices.notification(this,"正在跟进 $name","任务继续在电脑执行；可随时停止跟进。","",pin,true))
  executor.execute{
   val client=PinnedHttps.create(host,pin,false).newBuilder().readTimeout(45,TimeUnit.SECONDS).callTimeout(0,TimeUnit.SECONDS).build();var cursor=0L;var epoch="";var backoff=1000L
   val preferences=getSharedPreferences("grok-remote-monitor",Context.MODE_PRIVATE);val seen=preferences.getStringSet("seen:$pin",emptySet())!!.toMutableSet();var baseline=seen.isNotEmpty();var lastInbox=0L
   while(running&&current==generation&&!Thread.currentThread().isInterrupted){try{
    val request=Request.Builder().url(host.trimEnd('/')+"/v1/events?cursor=$cursor&epoch=$epoch").header("Authorization","Bearer $token").build();val stream=client.newCall(request);call=stream
    stream.execute().use{response->if(response.code==401){RemoteNotices.show(this,"电脑访问已撤销","打开应用重新配对。","",pin);running=false;return@use};if(!response.isSuccessful)throw IllegalStateException("无法同步")
     val source=response.body?.source()?:throw IllegalStateException("无响应");backoff=1000
     while(running&&current==generation&&!stream.isCanceled()){val line=source.readUtf8Line()?:break;if(!line.startsWith("data: "))continue;val event=JSONObject(line.substring(6));cursor=event.optLong("cursor",cursor);epoch=event.optString("epoch",epoch);val type=event.optString("type");val session=event.optString("sessionId")
      if(System.currentTimeMillis()-lastInbox>14000){lastInbox=System.currentTimeMillis();try{
       val inboxRequest=Request.Builder().url(host.trimEnd('/')+"/v1/workbench?kind=notifications").header("Authorization","Bearer $token").build()
       client.newCall(inboxRequest).execute().use{r->if(r.isSuccessful){val items=JSONObject(r.body?.string()?:"{}").optJSONArray("items");if(items!=null)for(i in 0 until items.length()){val item=items.getJSONObject(i);val id=item.optString("id");if(id.isNotBlank()&&seen.add(id)&&baseline){val kind=item.optString("kind");val title=if(kind=="confirmation")"任务需要回应"else if(kind=="failure")"任务执行失败"else"任务结果已更新";RemoteNotices.show(this,title,"打开应用查看对应任务。",item.optString("sessionId"),pin)}};baseline=true;while(seen.size>200)seen.remove(seen.first());preferences.edit().putStringSet("seen:$pin",seen.toSet()).apply()}}
      }catch(_:Exception){}}
      if(session.isNotBlank()&&type in listOf("permission","question","plan","computer-permission","computer-risk")){
       val title=when(type){"turn-completed"->"任务执行已结束";"error"->"任务执行失败";else->"任务需要回应"}
       if(type=="plan"){val probe=Request.Builder().url(host.trimEnd('/')+"/v1/sessions/"+Uri.encode(session)).header("Authorization","Bearer $token").build();val hasPending=client.newCall(probe).execute().use{r->val pending=JSONObject(r.body?.string()?:"{}").optJSONArray("pending");pending!=null&&pending.length()>0};if(!hasPending)continue}
       RemoteNotices.show(this,title,"打开 Grok Remote 查看结果与实际状态。",session,pin)
      }
     }
    }
   }catch(_:Exception){if(running)try{Thread.sleep(backoff);backoff=(backoff*2).coerceAtMost(30000)}catch(_:InterruptedException){break}}}
   if(current==generation)stopSelf()
  };return START_NOT_STICKY
 }
 override fun onDestroy(){running=false;following=false;call?.cancel();executor.shutdownNow();if(Build.VERSION.SDK_INT>=24)stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()}
}
