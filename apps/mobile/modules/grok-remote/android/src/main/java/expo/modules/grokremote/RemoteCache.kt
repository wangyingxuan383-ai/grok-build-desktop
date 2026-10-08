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
  for(file in files){if(size<=200L*1024*1024)break;if(file==keep||pins.contains(file.canonicalPath))continue;val bytes=file.length();if(file.delete())size-=bytes}
 }
}
