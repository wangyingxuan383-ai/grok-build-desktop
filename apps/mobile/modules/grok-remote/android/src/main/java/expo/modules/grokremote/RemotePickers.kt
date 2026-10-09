package expo.modules.grokremote

import android.app.Activity
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import expo.modules.kotlin.Promise
import java.util.Calendar
import java.util.Locale

object RemotePickers {
  fun date(activity: Activity?, value: String, promise: Promise) {
    if (activity == null) { promise.reject("ERR_DATE","应用不可用",null); return }
    activity.runOnUiThread {
      val parts = value.split('-').mapNotNull { it.toIntOrNull() }; val now = Calendar.getInstance()
      val dialog = DatePickerDialog(activity, { _, y, m, d -> promise.resolve(String.format(Locale.ROOT,"%04d-%02d-%02d",y,m+1,d)) }, parts.getOrNull(0)?:now.get(Calendar.YEAR), (parts.getOrNull(1)?:now.get(Calendar.MONTH)+1)-1, parts.getOrNull(2)?:now.get(Calendar.DAY_OF_MONTH))
      dialog.setOnCancelListener { promise.resolve(null) }; dialog.show()
    }
  }
  fun time(activity: Activity?, value: String, promise: Promise) {
    if (activity == null) { promise.reject("ERR_TIME","应用不可用",null); return }
    activity.runOnUiThread {
      val parts=value.split(':').mapNotNull{it.toIntOrNull()}
      val dialog=TimePickerDialog(activity,{_,h,m->promise.resolve(String.format(Locale.ROOT,"%02d:%02d",h,m))},parts.getOrNull(0)?:9,parts.getOrNull(1)?:0,true)
      dialog.setOnCancelListener { promise.resolve(null) }; dialog.show()
    }
  }
}
