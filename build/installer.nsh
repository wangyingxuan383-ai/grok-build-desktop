!macro customUnInstall
  DetailPrint "正在移除 Grok Build Desktop 的 Windows 定时任务注册…"
  nsExec::ExecToLog '"$INSTDIR\Grok Build Desktop.exe" --scheduler-uninstall'
!macroend
