import { constants } from "node:fs";
import { copyFile, lstat, mkdir, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, relative, win32, posix } from "node:path";
import { isPathInside, resolveWorkspaceRoot } from "./workspace-path-policy";

export interface MediaProjectOutput { root: string; directory: string; relativeDirectory: string }

/** Only a relative project directory; no shell, absolute paths, ADS or junction traversal. */
export async function prepareMediaProjectOutput(workspace: string, input: string, create = true): Promise<MediaProjectOutput> {
  const value=input.trim();
  if (!value || value.length>1024 || win32.isAbsolute(value) || posix.isAbsolute(value)) throw Error("请填写项目内的相对输出目录");
  const parts=value.split(/[\\/]/);
  if (parts.length>32 || parts.some(part=>!part || part==="." || part===".." || /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))
    throw Error("输出目录包含不支持的名称或越界路径");
  const root=await resolveWorkspaceRoot(workspace);
  let directory=root;
  for (const part of parts) {
    directory=join(directory,part);
    if (create) await mkdir(directory).catch(error=>{if(error.code!=="EEXIST")throw error});
    const info=await lstat(directory);
    if (info.isSymbolicLink() || !info.isDirectory()) throw Error("输出目录不能包含符号链接、联接或普通文件");
    const canonical=await realpath(directory);
    if (!isPathInside(root,canonical,false)) throw Error("输出目录超出提交时的项目");
    directory=canonical;
  }
  return {root,directory,relativeDirectory:relative(root,directory).replaceAll("\\","/")};
}

export async function saveProjectMedia(output: MediaProjectOutput, source: string, mimeType: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const checked=await prepareMediaProjectOutput(output.root,output.relativeDirectory,false);
  if (checked.root!==output.root || checked.directory!==output.directory) throw Error("项目输出目录已改变，请从图片卡另存结果");
  const extension:Record<string,string>={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif","video/mp4":"mp4","video/webm":"webm","video/quicktime":"mov"};
  if (!extension[mimeType]) throw Error("当前媒体格式暂不支持保存项目副本");
  signal?.throwIfAborted();
  const target=join(checked.directory,`grok-${randomUUID()}.${extension[mimeType]}`);
  await copyFile(source,target,constants.COPYFILE_EXCL);
  return target;
}
