import { randomUUID } from "node:crypto";
import {readFile,realpath,stat} from "node:fs/promises";
import {dirname,resolve,relative,isAbsolute,extname} from "node:path";

export const HTML_PREVIEW_CSP="sandbox allow-scripts; default-src 'none'; script-src grok-html://preview 'unsafe-inline'; style-src grok-html://preview 'unsafe-inline'; img-src grok-html://preview data: blob:; font-src grok-html://preview data:; media-src grok-html://preview data: blob:; connect-src grok-html://preview; form-action 'none'; base-uri grok-html://preview; object-src 'none'; frame-src 'none'; worker-src 'none'";

/** Memory-only, opaque preview handles. No renderer-selected filesystem URLs. */
export class HtmlPreviewService {
  private readonly documents=new Map<string,{data:string;bytes:number;at:number;root?:string}>();
  constructor(private readonly now:()=>number=Date.now){}
  register(data:string,path?:string):string {
    const bytes=Buffer.byteLength(data);if(bytes>20*1024*1024)throw Error("HTML 超过 20 MB 预览上限");
    this.prune();
    while(this.documents.size>=6||[...this.documents.values()].reduce((sum,row)=>sum+row.bytes,0)+bytes>40*1024*1024){this.documents.delete(this.documents.keys().next().value!);}
    const id=randomUUID();if(path){const base=`<base href="grok-html://preview/${id}/assets/">`;data=data.replace(/<base\b[^>]*>/gi,"");data=/<head\b[^>]*>/i.test(data)?data.replace(/<head\b[^>]*>/i,head=>head+base):base+data;}this.documents.set(id,{data,bytes,at:this.now(),root:path?dirname(path):undefined});return `grok-html://preview/${id}`;
  }
  response(url:string):Response {
    this.prune();let id:string;try{const parsed=new URL(url);if(parsed.protocol!=="grok-html:"||parsed.hostname!=="preview"||parsed.search||parsed.hash)throw Error();id=parsed.pathname.slice(1);}catch{return new Response("Not found",{status:404});}
    const row=this.documents.get(id);if(!row)return new Response("Preview expired; reread the file.",{status:404});row.at=this.now();
    return new Response(row.data,{headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":HTML_PREVIEW_CSP,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
  }
  clear():void{this.documents.clear();}
  async request(url:string):Promise<Response>{
    let parsed:URL;try{parsed=new URL(url)}catch{return new Response("Not found",{status:404})}
    const match=/^\/([0-9a-f-]{36})\/assets\/(.+)$/i.exec(parsed.pathname);if(!match)return this.response(url);
    this.prune();const document=this.documents.get(match[1]!);if(!document?.root||parsed.protocol!=="grok-html:"||parsed.hostname!=="preview")return new Response("Not found",{status:404});
    try{const root=await realpath(document.root);const path=await realpath(resolve(root,decodeURIComponent(match[2]!)));const rel=relative(root,path);if(!rel||rel.startsWith("..")||isAbsolute(rel))throw Error();
      const mime:Record<string,string>={".css":"text/css",".js":"application/javascript",".mjs":"application/javascript",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".gif":"image/gif",".svg":"image/svg+xml",".woff":"font/woff",".woff2":"font/woff2",".mp4":"video/mp4",".webm":"video/webm"};
      const type=mime[extname(path).toLowerCase()];if(!type||(await stat(path)).size>20*1024*1024)throw Error();document.at=this.now();return new Response(new Uint8Array(await readFile(path)),{headers:{"Content-Type":type,"Access-Control-Allow-Origin":"*","Cache-Control":"no-store","Content-Security-Policy":HTML_PREVIEW_CSP}});
    }catch{return new Response("Resource unavailable",{status:404})}
  }
  private prune():void{for(const [id,row]of this.documents)if(this.now()-row.at>10*60_000)this.documents.delete(id);}
}
