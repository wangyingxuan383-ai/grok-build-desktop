package expo.modules.grokremote

/** Ordered bounded identity memory; duplicate reads do not reorder history. */
object NoticeIds {
 fun merge(saved:List<String>,incoming:List<String>,limit:Int=300):List<String> =
  (saved+incoming).filter{it.isNotBlank()}.distinct().takeLast(limit)
 fun fresh(saved:List<String>,incoming:List<String>):List<String> {
  val known=saved.toHashSet()
  return incoming.filter{it.isNotBlank()&&known.add(it)}
 }
}
