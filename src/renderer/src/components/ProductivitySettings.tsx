import type { DesktopProductivitySettings } from "../../../shared/productivity";
import { DEFAULT_PRODUCTIVITY, productivitySettings } from "../../../shared/productivity";
import { APP_SHORTCUTS, shortcutFor, validateShortcutBindings } from "../../../shared/shortcuts";
import "../styles/productivity-settings.css";

export function ProductivitySettings({ value, onChange }: { value?: DesktopProductivitySettings; onChange(value: DesktopProductivitySettings): void }): React.JSX.Element {
  const current = productivitySettings(value);
  const update = (patch: Partial<DesktopProductivitySettings>) => onChange({ ...current, ...patch });
  let error = "";
  try { validateShortcutBindings(current); } catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  return <div className="productivity-settings">
    <fieldset className="conversation-reading-settings"><legend>窗口与后台</legend>
      <label>关闭窗口时<select value={current.closeAction} onChange={e => update({ closeAction: e.target.value as DesktopProductivitySettings["closeAction"] })}><option value="ask">首次询问并记住选择</option><option value="tray">隐藏到托盘，继续运行</option><option value="quit">退出应用</option></select></label>
      <label className="check"><input type="checkbox" checked={current.preventSleepWhileWorking} onChange={e => update({ preventSleepWhileWorking: e.target.checked })}/>有任务执行时阻止电脑自动睡眠</label>
      <small>不会保持屏幕常亮，也不会唤醒已经休眠的电脑。</small>
      <label>收件箱额度提醒<select value={current.quotaWarningPercent} onChange={e => update({ quotaWarningPercent: Number(e.target.value) })}><option value={0}>关闭</option><option value={80}>本期已用 80%</option><option value={90}>本期已用 90%</option><option value={95}>本期已用 95%</option></select><small>仅使用 CLI 已明确返回的当前周期数据；不会为提醒增加后台查询。</small></label>
      <label>暂时勿扰<select value={current.quietUntil && Date.parse(current.quietUntil) > Date.now() ? "on" : "off"} onChange={e => update({ quietUntil: e.target.value === "on" ? new Date(Date.now() + 60 * 60_000).toISOString() : undefined })}><option value="off">正常提醒</option><option value="on">暂停系统提醒 1 小时</option></select><small>收件箱继续记录，需要确认的请求仍保留。</small></label>
    </fieldset>
    <fieldset className="conversation-reading-settings"><legend>随手提问</legend>
      <p className="settings-note">托盘中随时可打开快速提问。全局快捷键默认留空，不抢占其他应用的按键。</p>
      <label>快速提问快捷键<input aria-label="快速提问快捷键" value={current.quickAskShortcut} placeholder="例如 Control+Shift+Space；留空禁用" onChange={e => update({ quickAskShortcut: e.target.value })}/></label>
      <label>截图提问快捷键<input aria-label="截图提问快捷键" value={current.screenshotShortcut} placeholder="例如 Control+Alt+S；留空禁用" onChange={e => update({ screenshotShortcut: e.target.value })}/><small>截图和剪贴板内容由你明确选择后添加，发送前可查看与移除。语音听写可在输入框中使用 Windows 的 Win+H。</small></label>
      <details><summary>应用内快捷键</summary>{APP_SHORTCUTS.map(item => <label key={item.command}>{item.label}<input aria-label={`${item.label}快捷键`} value={shortcutFor(item.command, current)} placeholder="留空禁用" onChange={e => update({ shortcuts: { ...current.shortcuts, [item.command]: e.target.value } })}/></label>)}<div className="button-row"><button type="button" onClick={() => update({ shortcuts: undefined, quickAskShortcut: DEFAULT_PRODUCTIVITY.quickAskShortcut, screenshotShortcut: DEFAULT_PRODUCTIVITY.screenshotShortcut })}>恢复默认快捷键</button></div></details>
      {error && <p role="alert" className="settings-note">{error}</p>}
    </fieldset>
  </div>;
}
