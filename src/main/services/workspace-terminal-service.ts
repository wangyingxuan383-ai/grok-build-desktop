import { randomUUID } from "node:crypto";
import { workspaceTerminalEnvironment } from "./workspace-terminal-environment";
import { join } from "node:path";
import type { IPty } from "node-pty";
import type { WorkspaceTerminal, WorkspaceTerminalEvent } from "../../shared/workspace-tools";
export class WorkspaceTerminalService {
 private pending=0;
 private disposed=false;
 private readonly entries=new Map<string,{state:WorkspaceTerminal;process:IPty}>();
 constructor(private readonly emit:(event:WorkspaceTerminalEvent)=>void){}
 list(workspace:string):WorkspaceTerminal[]{return [...this.entries.values()].filter(entry=>entry.state.workspace===workspace).map(entry=>({...entry.state}))}
 async create(workspace:string):Promise<WorkspaceTerminal>{
  if(this.disposed)throw Error("终端服务已关闭");
  if(this.entries.size+this.pending>=16)throw Error("最多保留 16 个终端，请先关闭不用的终端");
  this.pending++;
  try {
  const pty=await import("node-pty");if(this.disposed)throw Error("终端服务已关闭");const id=randomUUID();
  const executable=process.platform==="win32"?join(process.env.SystemRoot||"C:\\Windows","System32","WindowsPowerShell","v1.0","powershell.exe"):process.env.SHELL||"/bin/sh";
  const terminal=pty.spawn(executable,process.platform==="win32"?["-NoLogo","-NoProfile"]:[],{cwd:workspace,name:"xterm-256color",cols:100,rows:30,env:workspaceTerminalEnvironment(process.env)});
  const state:WorkspaceTerminal={id,workspace,title:process.platform==="win32"?"PowerShell":"Shell",status:"running",output:"",sequence:0};this.entries.set(id,{state,process:terminal});
  const publish=(data:string,exitCode?:number)=>{state.output=(state.output+data).slice(-1024*1024);state.sequence++;this.emit({id,data,sequence:state.sequence,exitCode})};
  terminal.onData(data=>publish(data));terminal.onExit(event=>{state.status="exited";state.exitCode=event.exitCode;publish(`\r\n[进程已退出：${event.exitCode}]\r\n`,event.exitCode)});
  return {...state};
  } finally {this.pending--;}
 }
 write(id:string,data:string):void {const entry=this.require(id);if(entry.state.status!=="running")throw Error("终端进程已退出");if(data.length>65536)throw Error("单次终端输入过长");entry.process.write(data)}
 resize(id:string,cols:number,rows:number):void {if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||cols>500||rows<2||rows>300)throw Error("终端尺寸无效");const entry=this.require(id);if(entry.state.status==="running")entry.process.resize(cols,rows)}
 close(id:string):void {const entry=this.require(id);this.entries.delete(id);if(entry.state.status==="running")entry.process.kill()}
 dispose():void {this.disposed=true;for(const id of [...this.entries.keys()]){try{this.close(id)}catch{}}}
 private require(id:string){const entry=this.entries.get(id);if(!entry)throw Error("终端已关闭");return entry}
}
