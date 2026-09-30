import { useAppStore } from "./store";
export type ConfirmRemoval = (message:string,options?:{title?:string;confirmLabel?:string;danger?:boolean})=>Promise<boolean>;
export async function removeProject(cwd:string,confirm:ConfirmRemoval):Promise<void>{
 const preview=await window.grokDesktop.previewWorkspaceRemoval(cwd);
 if(preview.running.length)throw Error(`项目中有 ${preview.running.length} 个运行或等待中的任务，请先处理后再删除。`);
 if(!await confirm(`删除项目入口及 ${preview.sessionIds.length} 个 Grok 会话？\n${cwd}\n关联的 ${preview.automationCount} 个定时任务将暂停并要求重新绑定。\n磁盘项目文件和外部 Codex/Claude 历史保留。`,{title:"删除项目",confirmLabel:"删除项目及 Grok 会话",danger:true}))return;
 const result=await window.grokDesktop.removeWorkspace(cwd);
 for(const sessionId of result.removedIds)window.dispatchEvent(new CustomEvent("grok:session-deleted",{detail:{sessionId}}));
 const store=useAppStore.getState();
 if(result.removedIds.includes(store.activeSessionId))store.setActiveSession("");
 store.setSettings(await window.grokDesktop.getSettings());
 store.setWorkspaces(await window.grokDesktop.discoverWorkspaces(true));
 const active=useAppStore.getState().settings?.activeWorkspace;
 store.setSessions(active?await window.grokDesktop.listSessions(active):[]);
 if(result.removed)window.dispatchEvent(new CustomEvent("grok:project-deleted",{detail:{cwd}}));
 if(result.failures.length)throw Error(`已删除 ${result.removedIds.length} 个会话；${result.failures.length} 个失败，项目入口保留，可重试。\n${result.failures.map(row=>`${row.id}: ${row.message}`).join("\n")}`);
}
