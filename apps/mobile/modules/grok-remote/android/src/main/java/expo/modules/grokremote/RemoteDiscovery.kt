package expo.modules.grokremote
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.Promise
import java.util.concurrent.atomic.AtomicBoolean
object RemoteDiscovery {
 @Suppress("DEPRECATION")
 fun discover(context:Context,promise:Promise){
  val manager=context.getSystemService(Context.NSD_SERVICE) as NsdManager
  val results=mutableListOf<Map<String,String>>()
  val queue=java.util.ArrayDeque<NsdServiceInfo>()
  val finished=AtomicBoolean(false)
  val resolving=AtomicBoolean(false)
  val handler=Handler(Looper.getMainLooper())
  lateinit var listener:NsdManager.DiscoveryListener
  lateinit var next:()->Unit
  fun finish(){if(!finished.compareAndSet(false,true))return;try{manager.stopServiceDiscovery(listener)}catch(_:Exception){};synchronized(results){promise.resolve(results.toList())}}
  next={if(!finished.get()&&resolving.compareAndSet(false,true)){val info=synchronized(queue){queue.poll()};if(info==null){resolving.set(false)}else try{manager.resolveService(info,object:NsdManager.ResolveListener{
   override fun onResolveFailed(info:NsdServiceInfo,error:Int){resolving.set(false);next()}
   override fun onServiceResolved(info:NsdServiceInfo){
    if(!finished.get()){
     val address=info.host?.hostAddress
     val fingerprint=info.attributes["fingerprint"]?.toString(Charsets.UTF_8)
     if(address!=null&&fingerprint!=null&&fingerprint.matches(Regex("[a-f0-9]{64}"))){
      val host=if(address.contains(':')) "[$address]" else address
      val url="https://$host:${info.port}"
      synchronized(results){if(results.none{it["host"]==url})results.add(mapOf("host" to url,"fingerprint" to fingerprint,"name" to info.serviceName))}
     }
    }
    resolving.set(false);next()
   }
  })}catch(_:Exception){resolving.set(false);next()}}}
  listener=object:NsdManager.DiscoveryListener{
   override fun onDiscoveryStarted(type:String){}
   override fun onDiscoveryStopped(type:String){}
   override fun onStartDiscoveryFailed(type:String,error:Int){finish()}
   override fun onStopDiscoveryFailed(type:String,error:Int){}
   override fun onServiceLost(info:NsdServiceInfo){}
   override fun onServiceFound(info:NsdServiceInfo){if(finished.get())return;synchronized(queue){queue.add(info)};next()}
  }
  handler.post{try{manager.discoverServices("_grokremote._tcp.",NsdManager.PROTOCOL_DNS_SD,listener);handler.postDelayed({finish()},4500)}catch(error:Exception){if(finished.compareAndSet(false,true))promise.reject("ERR_REMOTE_DISCOVERY","局域网发现不可用，仍可扫码或输入当前地址",error)}}
 }
}
