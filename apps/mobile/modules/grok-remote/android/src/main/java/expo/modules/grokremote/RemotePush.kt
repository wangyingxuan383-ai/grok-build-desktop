package expo.modules.grokremote
import android.content.Context
import expo.modules.kotlin.Promise
import java.lang.reflect.Proxy
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Public Firebase options supplied at runtime; no user/cloud keys in the APK. */
object RemotePush {
 private val deadlines=Executors.newSingleThreadScheduledExecutor()
 fun token(context:Context,options:Map<String,String>,promise:Promise){
  val settled=AtomicBoolean(false);val deadline=deadlines.schedule({if(settled.compareAndSet(false,true))promise.reject("ERR_REMOTE_PUSH","推送注册超时，本地持续跟进仍可使用",null)},25,TimeUnit.SECONDS)
  try {
   RemoteNotices.channels(context)
   val appClass=Class.forName("com.google.firebase.FirebaseApp")
   val optionsClass=Class.forName("com.google.firebase.FirebaseOptions")
   val builderClass=Class.forName("com.google.firebase.FirebaseOptions\$Builder")
   val builder=builderClass.getConstructor().newInstance()
   for((method,key)in listOf("setProjectId" to "projectId","setApplicationId" to "appId","setApiKey" to "apiKey","setGcmSenderId" to "senderId")){val value=options[key]?:throw IllegalStateException("电脑推送配置不完整");builderClass.getMethod(method,String::class.java).invoke(builder,value)}
   val built=builderClass.getMethod("build").invoke(builder)
   val app=try{appClass.getMethod("getInstance").invoke(null)}catch(_:Exception){appClass.getMethod("initializeApp",Context::class.java,optionsClass).invoke(null,context,built)}
   val active=appClass.getMethod("getOptions").invoke(app)
   require(optionsClass.getMethod("getProjectId").invoke(active)==options["projectId"]){"手机已使用另一推送项目；多个电脑需使用同一推送项目，本地连接不受影响"}
   val messaging=Class.forName("com.google.firebase.messaging.FirebaseMessaging").getMethod("getInstance").invoke(null)
   val task=messaging.javaClass.getMethod("getToken").invoke(messaging)
   val listenerClass=Class.forName("com.google.android.gms.tasks.OnCompleteListener")
   val taskClass=Class.forName("com.google.android.gms.tasks.Task")
   val listener=Proxy.newProxyInstance(listenerClass.classLoader,arrayOf(listenerClass)){_,method,args->if(method.name=="onComplete"&&settled.compareAndSet(false,true)){deadline.cancel(false);val result=args!![0];if(taskClass.getMethod("isSuccessful").invoke(result)==true)promise.resolve(taskClass.getMethod("getResult").invoke(result).toString())else promise.reject("ERR_REMOTE_PUSH","推送服务不可用，检查 Google Play 服务与网络；仍可使用本地持续跟进",null)};null}
   taskClass.getMethod("addOnCompleteListener",listenerClass).invoke(task,listener)
  }catch(error:Exception){deadline.cancel(false);if(settled.compareAndSet(false,true))promise.reject("ERR_REMOTE_PUSH",error.cause?.message?:error.message,error)}
 }
}
