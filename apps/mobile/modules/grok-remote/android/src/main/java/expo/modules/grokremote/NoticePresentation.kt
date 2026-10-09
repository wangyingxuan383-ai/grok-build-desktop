package expo.modules.grokremote

/** Only the computer polled by the visible app delegates presentation to JavaScript. */
object NoticePresentation {
 fun deferToForeground(active:Boolean, visibleComputer:String, eventComputer:String):Boolean =
  active && visibleComputer.isNotBlank() && visibleComputer == eventComputer
}
