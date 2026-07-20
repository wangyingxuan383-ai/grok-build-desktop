import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import type { AppMenuCommand } from "../shared/types";
import { isAllowedExternalUrl } from "./security-policy";

export const PUBLIC_REPOSITORY_URLS = {
  repository: "https://github.com/wangyingxuan383-ai/grok-build-desktop",
  releases: "https://github.com/wangyingxuan383-ai/grok-build-desktop/releases",
  issues: "https://github.com/wangyingxuan383-ai/grok-build-desktop/issues",
  xaiDocs: "https://docs.x.ai/build/overview",
} as const;

export const CHINESE_MENU_LABELS = ["文件", "编辑", "会话", "视图", "功能", "帮助"] as const;

export function isAllowedApplicationMenuUrl(url: string): boolean {
  return isAllowedExternalUrl(url) && (Object.values(PUBLIC_REPOSITORY_URLS) as string[]).includes(url);
}

export function installApplicationMenu(window: BrowserWindow, development = !app.isPackaged): void {
  const command = (value: AppMenuCommand): (() => void) => () => {
    if (!window.isDestroyed()) window.webContents.send("grok:menu-command", value);
  };
  const open = (url: string): (() => void) => () => { if (isAllowedApplicationMenuUrl(url)) void shell.openExternal(url); };
  const template: MenuItemConstructorOptions[] = [
    { label: "文件", submenu: [
      { label: "新建会话", accelerator: "CmdOrCtrl+N", click: command("new-session") },
      { label: "选择工作区…", click: command("choose-workspace") },
      { label: "添加附件…", click: command("add-attachment") },
      { type: "separator" },
      { label: "导出当前会话为 Markdown…", click: command("export-session") },
      { type: "separator" },
      { label: "退出", role: "quit" },
    ] },
    { label: "编辑", submenu: [
      { label: "撤销", role: "undo" }, { label: "重做", role: "redo" }, { type: "separator" },
      { label: "剪切", role: "cut" }, { label: "复制", role: "copy" }, { label: "粘贴", role: "paste" },
      { label: "全选", role: "selectAll" },
    ] },
    { label: "会话", submenu: [
      { label: "搜索会话", accelerator: "CmdOrCtrl+F", click: command("search-sessions") },
      { label: "搜索当前会话", accelerator: "CmdOrCtrl+Shift+F", click: command("search-conversation") },
      { label: "聚焦输入框", accelerator: "CmdOrCtrl+L", click: command("focus-composer") },
      { type: "separator" },
      { label: "停止生成", click: command("stop-generation") },
      { label: "复制最终回复", click: command("copy-final-answer") },
    ] },
    { label: "视图", submenu: [
      { label: "显示或隐藏侧栏", click: command("toggle-sidebar") },
      { type: "separator" },
      { label: "放大", role: "zoomIn" }, { label: "缩小", role: "zoomOut" }, { label: "恢复缩放", role: "resetZoom" },
      { label: "全屏", role: "togglefullscreen" }, { label: "重新加载", role: "reload" },
      ...(development ? [{ label: "开发者工具", role: "toggleDevTools" as const }] : []),
    ] },
    { label: "功能", submenu: [
      { label: "账号与额度", click: command("open-accounts") },
      { label: "任务中心与定时任务", click: command("open-task-center") },
      { label: "媒体创作", click: command("open-media") },
      { label: "扩展中心", click: command("open-extensions") },
      { label: "本次使用 Computer Use", click: command("open-computer") },
      { type: "separator" },
      { label: "设置", click: command("open-settings") },
      { label: "兼容诊断中心", click: command("open-diagnostics") },
      { label: "重新运行首次设置", click: command("open-onboarding") },
    ] },
    { label: "帮助", submenu: [
      { label: "我的 GitHub 仓库", click: open(PUBLIC_REPOSITORY_URLS.repository) },
      { label: "版本发布", click: open(PUBLIC_REPOSITORY_URLS.releases) },
      { label: "问题反馈", click: open(PUBLIC_REPOSITORY_URLS.issues) },
      { label: "xAI Grok Build 文档", click: open(PUBLIC_REPOSITORY_URLS.xaiDocs) },
      { type: "separator" },
      { label: "关于 Grok Build Desktop", click: command("open-about") },
    ] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
