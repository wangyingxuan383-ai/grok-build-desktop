import { randomUUID } from "node:crypto";

export const HTML_PREVIEW_CSP="sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'";

/** Memory-only, opaque preview handles. No renderer-selected filesystem URLs. */
export class HtmlPreviewService {
  private readonly documents=new Map<string,{data:string;bytes:number;at:number}>();
  constructor(private readonly now:()=>number=Date.now){}
  register(data:string):string {
    const bytes=Buffer.byteLength(data);if(bytes>20*1024*1024)throw Error("HTML 超过 20 MB 预览上限");
    this.prune();
    while(this.documents.size>=6||[...this.documents.values()].reduce((sum,row)=>sum+row.bytes,0)+bytes>40*1024*1024){this.documents.delete(this.documents.keys().next().value!);}
    const id=randomUUID();this.documents.set(id,{data,bytes,at:this.now()});return `grok-html://preview/${id}`;
  }
  response(url:string):Response {
    this.prune();let id:string;try{const parsed=new URL(url);if(parsed.protocol!=="grok-html:"||parsed.hostname!=="preview"||parsed.search||parsed.hash)throw Error();id=parsed.pathname.slice(1);}catch{return new Response("Not found",{status:404});}
    const row=this.documents.get(id);if(!row)return new Response("Preview expired; reread the file.",{status:404});row.at=this.now();
    return new Response(row.data,{headers:{"Content-Type":"text/html; charset=utf-8","Content-Security-Policy":HTML_PREVIEW_CSP,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"}});
  }
  clear():void{this.documents.clear();}
  private prune():void{for(const [id,row]of this.documents)if(this.now()-row.at>10*60_000)this.documents.delete(id);}
}
