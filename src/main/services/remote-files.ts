import { randomUUID } from "node:crypto";
import { mkdir,readFile,writeFile,stat,open,unlink,readdir,copyFile } from "node:fs/promises";
import { join,basename,resolve,dirname } from "node:path";
import{sessionCacheKey}from"./media-cache-service";
import type { Attachment } from "../../shared/types";
interface Upload {id:string;owner:string;sessionId:string;name:string;size:number;mimeType:string;path:string;createdAt:string;copiedPath?:string}
/** Durable chunk transfer, separate from idempotent model submissions. */
export class RemoteFiles {
 private locks=new Map<string,Promise<unknown>>();
 constructor(private readonly root:string){}
 private metadata(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw Error("附件身份无效");return join(this.root,"remote","uploads",id+".json")}
 async upload(body:Record<string,unknown>,owner:string,known:(id:string)=>Promise<void>){
  if(!body.id){
   const name=typeof body.name==="string"?basename(body.name).replace(/[<>:"/\\|?*\u0000-\u001f]/g,"_").slice(0,120):"";
   if(!name||!Number.isSafeInteger(body.size)||Number(body.size)<1||Number(body.size)>50*1024*1024||typeof body.sessionId!=="string")throw Error("请选择不超过 50 MB 的有效文件");
   await known(body.sessionId);const id=randomUUID();const directory=join(this.root,"remote","uploads");await mkdir(directory,{recursive:true});await this.sweep(directory,Number(body.size));
   const row:Upload={id,owner,sessionId:body.sessionId,name,size:Number(body.size),mimeType:typeof body.mimeType==="string"?body.mimeType.slice(0,100):"application/octet-stream",path:join(directory,id+"-"+name),createdAt:new Date().toISOString()};
   await writeFile(row.path,Buffer.alloc(0),{flag:"wx"});await writeFile(this.metadata(id),JSON.stringify(row),{flag:"wx"});return {id,offset:0,size:row.size};
  }
  const id=String(body.id);const previous=this.locks.get(id)??Promise.resolve();const next=previous.catch(()=>undefined).then(async()=>{
   const row=await this.read(id,owner);const info=await stat(row.path);
   if(body.cancel===true){if(row.copiedPath)throw Error("材料已由会话保存，不能作为临时上传取消");await unlink(row.path).catch(()=>undefined);await unlink(this.metadata(id));return {id,cancelled:true}}
   if(body.data!==undefined){
    if(typeof body.data!=="string"||body.data.length>700000||!/^[A-Za-z0-9+/]*={0,2}$/.test(body.data))throw Error("文件分段无效");
    if(!Number.isSafeInteger(body.offset)||Number(body.offset)<0)throw Error("文件分段位置无效");const bytes=Buffer.from(body.data,"base64");
    if(Number(body.offset)!==info.size){if(Number(body.offset)+bytes.length<=info.size){const handle=await open(row.path,"r");try{const previous=Buffer.alloc(bytes.length);await handle.read(previous,0,previous.length,Number(body.offset));if(!previous.equals(bytes))throw Error("同一位置的文件分段内容不一致")}finally{await handle.close()}return {id,offset:info.size,size:row.size}}throw Error("文件进度已变化，请读取进度后继续")}
    if(info.size+bytes.length>row.size)throw Error("文件内容超过声明大小");const file=await open(row.path,"r+");try{await file.write(bytes,0,bytes.length,info.size)}finally{await file.close()}
   }
   const size=(await stat(row.path)).size;return {id,offset:size,size:row.size,complete:size===row.size};
  });this.locks.set(id,next);try{return await next}finally{if(this.locks.get(id)===next)this.locks.delete(id)}
 }
 private async read(id:string,owner:string):Promise<Upload>{const row=JSON.parse(await readFile(this.metadata(id),"utf8")) as Upload;if(row.owner!==owner||Date.now()-Date.parse(row.createdAt)>7*86400000)throw Error("附件已过期或不属于当前设备");return row}
 async attachments(ids:string[],owner:string,sessionId:string):Promise<Attachment[]>{
  return Promise.all(ids.map(async id=>{const row=await this.read(id,owner);if(row.sessionId!==sessionId)throw Error("附件不属于当前会话");const info=await stat(row.path);if(info.size!==row.size)throw Error("附件尚未上传完成");const directory=join(this.root,"session-attachments",sessionCacheKey(sessionId));await mkdir(directory,{recursive:true});const target=join(directory,row.id+"-"+row.name);if(!row.copiedPath){const original=row.path;await copyFile(original,target);row.copiedPath=target;row.path=target;await writeFile(this.metadata(id),JSON.stringify(row));await unlink(original).catch(()=>undefined)}return {id:row.id,name:row.name,path:target,size:row.size,mimeType:row.mimeType,kind:row.mimeType.startsWith("image/")?"image" as const:"file" as const}}));
 }
 private async sweep(directory:string,incoming:number){let total=0,count=0;for(const name of await readdir(directory)){if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;try{const row=JSON.parse(await readFile(join(directory,name),"utf8"))as Upload;if(row.copiedPath){if(Date.now()-Date.parse(row.createdAt)>7*86400000)await unlink(join(directory,name));continue}if(resolve(dirname(row.path))!==resolve(directory))continue;const info=await stat(row.path);if(Date.now()-Date.parse(row.createdAt)>7*86400000){await unlink(row.path);await unlink(join(directory,name));continue}total+=info.size;count++}catch{}}if(total+incoming>500*1024*1024||count>=300)throw Error("临时上传空间已达到上限；请取消不用的上传或等待过期清理")}
}
