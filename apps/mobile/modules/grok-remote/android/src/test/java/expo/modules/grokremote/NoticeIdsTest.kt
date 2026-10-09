package expo.modules.grokremote

import org.junit.Assert.*
import org.junit.Test

class NoticeIdsTest {
 @Test fun eachEventIsClaimedOnceAcrossSources() {
  var saved=emptyList<String>()
  val event=listOf("turn:1","turn:1")
  assertEquals(listOf("turn:1"),NoticeIds.fresh(saved,event))
  saved=NoticeIds.merge(saved,event)
  assertTrue(NoticeIds.fresh(saved,event).isEmpty())
  assertEquals(listOf("approval:2"),NoticeIds.fresh(saved,listOf("turn:1","approval:2")))
 }
 @Test fun boundingKeepsNewerIdentityOrder() {
  val values=(1..400).map{"event:$it"}
  val saved=NoticeIds.merge(emptyList(),values)
  assertEquals(300,saved.size);assertEquals("event:101",saved.first());assertEquals("event:400",saved.last())
  assertEquals(saved,NoticeIds.merge(saved,values.takeLast(100)))
 }
 @Test fun blankIdsNeverBecomeEvents() {
  assertEquals(emptyList<String>(),NoticeIds.fresh(emptyList(),listOf(""," ")))
 }
}
