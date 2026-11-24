package expo.modules.grokremote

import android.app.Activity
import android.app.DatePickerDialog
import android.app.TimePickerDialog
import expo.modules.kotlin.Promise
import java.util.Calendar
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

object RemotePickers {
  fun date(activity: Activity?, value: String, promise: Promise) {
    if (activity == null || activity.isFinishing || activity.isDestroyed) { promise.reject("ERR_DATE","应用不可用",null); return }
    activity.runOnUiThread {
      if (activity.isFinishing || activity.isDestroyed) { promise.reject("ERR_DATE","应用不可用",null); return@runOnUiThread }
      val done = AtomicBoolean(false)
      try {
        val parts = value.split('-').mapNotNull { it.toIntOrNull() }; val now = Calendar.getInstance()
        val dialog = DatePickerDialog(activity, { _, y, m, d -> if (done.compareAndSet(false, true)) promise.resolve(String.format(Locale.ROOT,"%04d-%02d-%02d",y,m+1,d)) }, parts.getOrNull(0)?:now.get(Calendar.YEAR), (parts.getOrNull(1)?:now.get(Calendar.MONTH)+1)-1, parts.getOrNull(2)?:now.get(Calendar.DAY_OF_MONTH))
        dialog.setOnCancelListener { if (done.compareAndSet(false, true)) promise.resolve(null) }
        dialog.setOnDismissListener { if (done.compareAndSet(false, true)) promise.resolve(null) }
        dialog.show()
      } catch (error: Exception) { if (done.compareAndSet(false, true)) promise.reject("ERR_DATE", "日期选择器不可用", error) }
    }
  }
  fun time(activity: Activity?, value: String, promise: Promise) {
    if (activity == null || activity.isFinishing || activity.isDestroyed) { promise.reject("ERR_TIME","应用不可用",null); return }
    activity.runOnUiThread {
      if (activity.isFinishing || activity.isDestroyed) { promise.reject("ERR_TIME","应用不可用",null); return@runOnUiThread }
      val done = AtomicBoolean(false)
      try {
        val parts=value.split(':').mapNotNull{it.toIntOrNull()}
        val dialog=TimePickerDialog(activity,{_,h,m->if(done.compareAndSet(false,true))promise.resolve(String.format(Locale.ROOT,"%02d:%02d",h,m))},parts.getOrNull(0)?:9,parts.getOrNull(1)?:0,true)
        dialog.setOnCancelListener { if (done.compareAndSet(false, true)) promise.resolve(null) }
        dialog.setOnDismissListener { if (done.compareAndSet(false, true)) promise.resolve(null) }
        dialog.show()
      } catch (error: Exception) { if (done.compareAndSet(false, true)) promise.reject("ERR_TIME", "时间选择器不可用", error) }
    }
  }
}
