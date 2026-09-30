import { open } from "node:fs/promises";
import { basename, extname } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { resolveTrustedRendererPath } from "./renderer-path-policy";
import type { WorkspaceArtifact } from "../../shared/workspace-tools";
const media:Record<string,[WorkspaceArtifact["kind"],string]>={".png":["image","image/png"],".jpg":["image","image/jpeg"],".jpeg":["image","image/jpeg"],".webp":["image","image/webp"],".gif":["image","image/gif"],".pdf":["pdf","application/pdf"],".mp3":["audio","audio/mpeg"],".wav":["audio","audio/wav"],".ogg":["audio","audio/ogg"],".mp4":["video","video/mp4"],".webm":["video","video/webm"]};
const textExtensions=new Set(".txt .md .json .yaml .yml .toml .csv .log .ts .tsx .js .jsx .css .xml .svg .py .rs .go .java .c .cpp .h .sql .sh .ps1".split(" "));
export async function readWorkspaceArtifact(workspace:string,requested:string):Promise<WorkspaceArtifact>{
 const path=await resolveTrustedRendererPath(requested,{roots:[workspace],kind:"file"});const extension=extname(path).toLowerCase();
 const office=[".docx",".xlsx",".pptx"].includes(extension);const html=[".html",".htm"].includes(extension);const binary=media[extension];
 if(!office&&!html&&!binary&&!textExtensions.has(extension))throw Error("此格式暂不支持内置预览");
 const limit=binary?20*1024*1024:2*1024*1024;const file=await open(path,"r");let buffer:Buffer;
 try {if((await file.stat()).size>limit)throw Error(`文件超过预览上限 ${limit/1024/1024} MB`);buffer=Buffer.alloc(limit+1);let bytesRead=0;while(bytesRead<buffer.length){const chunk=await file.read(buffer,bytesRead,buffer.length-bytesRead,bytesRead);if(!chunk.bytesRead)break;bytesRead+=chunk.bytesRead}if(bytesRead>limit)throw Error("文件超过预览上限");buffer=buffer.subarray(0,bytesRead)}finally{await file.close()}
 let data=binary?buffer.toString("base64"):decodeText(buffer);
 if(office){let total=0,count=0;const files=unzipSync(buffer,{filter:entry=>{if(++count>10000)throw Error("Office 文档条目过多");if(!/^(word\/document|xl\/sharedStrings|xl\/worksheets\/sheet\d+|ppt\/slides\/slide\d+)\.xml$/.test(entry.name))return false;total+=entry.originalSize;if(total>8*1024*1024)throw Error("Office 文档展开内容过大");return true}});
 data=Object.entries(files).sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([name,bytes])=>`[${name}]\n${strFromU8(bytes).replace(/<\/(?:w:p|a:p|row)>/g,"\n").replace(/<[^>]*>/g," ").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}`).join("\n\n");}
 return {path,name:basename(path),kind:binary?.[0]||(office?"office":html?"html":"text"),mimeType:binary?.[1]||"text/plain",data};
}
function decodeText(value:Buffer):string{if(value[0]===0xff&&value[1]===0xfe)return new TextDecoder("utf-16le").decode(value.subarray(2));if(value[0]===0xfe&&value[1]===0xff)return new TextDecoder("utf-16be").decode(value.subarray(2));if(value[0]===0xef&&value[1]===0xbb&&value[2]===0xbf)return new TextDecoder("utf-8").decode(value.subarray(3));return new TextDecoder("utf-8").decode(value)}
