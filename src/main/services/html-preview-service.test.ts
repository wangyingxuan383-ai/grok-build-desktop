import {expect,it} from "vitest";
import {HtmlPreviewService,HTML_PREVIEW_CSP} from "./html-preview-service";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
it("serves local styles, scripts and JSON with a base while excluding parent and secret files",async()=>{const root=await mkdtemp(join(tmpdir(),"grok-html-assets-"));try{await writeFile(join(root,"style.css"),"button{color:red}");await writeFile(join(root,"data.json"),'{"ok":true}');await writeFile(join(root,".env"),"not served");const service=new HtmlPreviewService();const url=service.register('<head></head><link rel="stylesheet" href="style.css">',join(root,"index.html"));expect(await service.response(url).text()).toContain(`${url}/assets/`);expect(await (await service.request(`${url}/assets/style.css`)).text()).toContain("color:red");expect((await service.request(`${url}/assets/data.json`)).headers.get("Access-Control-Allow-Origin")).toBe("*");expect((await service.request(`${url}/assets/.env`)).status).toBe(404);expect((await service.request(`${url}/assets/%2e%2e%2fsecret.js`)).status).toBe(404)}finally{await rm(root,{recursive:true,force:true})}});
it("returns isolated HTML for opaque handles and rejects filesystem or unknown URLs",async()=>{
 const service=new HtmlPreviewService();const url=service.register("<button>hello</button>");const response=service.response(url);
 expect(await response.text()).toBe("<button>hello</button>");expect(response.headers.get("Content-Security-Policy")).toBe(HTML_PREVIEW_CSP);
 expect(HTML_PREVIEW_CSP).toContain("sandbox allow-scripts");expect(HTML_PREVIEW_CSP).not.toContain("allow-same-origin");
 expect(service.response("file:///secret").status).toBe(404);expect(service.response(url+"?path=secret").status).toBe(404);
 service.clear();expect(service.response(url).status).toBe(404);
});
it("bounds preview storage by size, count and age",()=>{
 let now=0;const service=new HtmlPreviewService(()=>now);const old=service.register("old");for(let i=0;i<6;i++)service.register(String(i));expect(service.response(old).status).toBe(404);
 const latest=service.register("latest");now=11*60_000;expect(service.response(latest).status).toBe(404);
 expect(()=>service.register("x".repeat(20*1024*1024+1))).toThrow("上限");
});
