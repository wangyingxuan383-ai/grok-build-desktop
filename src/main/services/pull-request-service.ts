import {execFile} from "node:child_process";
import {promisify} from "node:util";
const execute=promisify(execFile);
import type {PullRequestStatus} from "../../shared/workspace-tools";
export type {PullRequestStatus} from "../../shared/workspace-tools";
export async function readPullRequest(workspace:string,env:NodeJS.ProcessEnv):Promise<PullRequestStatus>{
 try{const {stdout}=await execute("gh",["pr","view","--json","number,title,url,state,statusCheckRollup"],{cwd:workspace,env,windowsHide:true,timeout:20_000,maxBuffer:1024*1024});return parsePullRequest(JSON.parse(stdout));}
 catch(error){const code=(error as NodeJS.ErrnoException).code;return {available:false,reason:code==="ENOENT"?"未找到 GitHub CLI；安装并登录 gh 后可查看当前分支 PR。":"当前分支没有可读取的 PR，或 GitHub 登录/网络不可用。可在终端运行 gh pr view 检查。",checks:[],pending:false}}
}
export function parsePullRequest(raw:Record<string,unknown>):PullRequestStatus{
 const checks=(Array.isArray(raw.statusCheckRollup)?raw.statusCheckRollup:[]).map(row=>({name:String(row.name||row.context||"检查"),state:String(row.conclusion||row.status||row.state||"UNKNOWN")}));
 const url=typeof raw.url==="string"&&/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(raw.url)?raw.url:undefined;
 return {available:true,number:typeof raw.number==="number"?raw.number:undefined,title:typeof raw.title==="string"?raw.title:undefined,url,state:String(raw.state||"UNKNOWN"),checks,pending:checks.some(check=>["PENDING","QUEUED","IN_PROGRESS","WAITING","REQUESTED"].includes(check.state))};
}
