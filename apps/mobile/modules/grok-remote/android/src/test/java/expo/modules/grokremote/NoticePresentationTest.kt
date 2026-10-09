package expo.modules.grokremote

import org.junit.Assert.*
import org.junit.Test

class NoticePresentationTest {
 @Test fun otherComputerStillNotifiesWhileAppIsOpen() {
  assertFalse(NoticePresentation.deferToForeground(true,"computer-a","computer-b"))
 }
 @Test fun currentComputerUsesOneForegroundPresenter() {
  assertTrue(NoticePresentation.deferToForeground(true,"computer-a","computer-a"))
  assertFalse(NoticePresentation.deferToForeground(false,"computer-a","computer-a"))
  assertFalse(NoticePresentation.deferToForeground(true,"","computer-a"))
 }
}
