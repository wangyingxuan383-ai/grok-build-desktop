package expo.modules.grokremote

import android.content.Context
import java.io.File
import java.util.concurrent.ConcurrentHashMap

/** Rebuildable previews only. Never evicts share materials, drafts or receipts. */
object RemoteCache {
 private val pins = ConcurrentHashMap.newKeySet<String>()
 fun pin(context:Context,path:String,active:Boolean) {
  val file=File(android.net.Uri.parse(path).path?:"").canonicalFile
  require(file.path.startsWith(context.cacheDir.canonicalPath+File.separator))
  if(active)pins.add(file.path) else pins.remove(file.path)
 }
 @Synchronized fun prune(context:Context,keep:File?=null) {
  val files=context.cacheDir.listFiles()?.filter{it.isFile&&(it.name.startsWith("grok-thumb-")||it.name.startsWith("grok-download-")||it.name.startsWith("grok-full-"))}?.sortedBy{it.lastModified()}?:return
  var size=files.sumOf{it.length()}
  for(file in files){if(size<=200L*1024*1024)break;if(file.name.endsWith(".json")||file==keep||pins.contains(file.canonicalPath.removeSuffix(".part")))continue;val sidecar=File(file.path+".json");val bytes=file.length()+sidecar.length();if(file.delete()){sidecar.delete();size-=bytes}}
 }
 fun files(context:Context)=context.cacheDir.listFiles()?.filter{it.isFile&&(it.name.startsWith("grok-thumb-")||it.name.startsWith("grok-download-")||it.name.startsWith("grok-full-"))}?:emptyList()
 @Synchronized fun usage(context:Context,clear:Boolean):Long {
  val files=files(context);val bytes=files.sumOf{it.length()}
  if(clear)for(file in files){val primary=File(file.path.removeSuffix(".json").removeSuffix(".part"));if(!pins.contains(primary.canonicalPath))file.delete()}
  return bytes
 }
 fun summary(context:Context):Map<String,Any> {
  val files=files(context)
  return mapOf("thumbnails" to files.filter{it.name.startsWith("grok-thumb-")}.sumOf{it.length()}.toDouble(),
   "originals" to files.filter{it.name.startsWith("grok-full-")}.sumOf{it.length()}.toDouble(),
   "previews" to files.filter{it.name.startsWith("grok-download-")}.sumOf{it.length()}.toDouble(),
   "updates" to (File(context.cacheDir,"grok-updates").listFiles()?.sumOf{it.length()}?:0L).toDouble(),
   "largest" to files.filter{!it.name.endsWith(".json")&&!it.name.endsWith(".part")}.sortedByDescending{it.length()}.take(8).map{file->
     val meta=try{org.json.JSONObject(File(file.path+".json").readText())}catch(_:Exception){null}
     mapOf("name" to (meta?.optString("name")?.takeIf{it.isNotBlank()}?:"缓存文件"),"size" to file.length().toDouble())})
 }
}
