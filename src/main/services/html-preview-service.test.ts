import {expect,it} from "vitest";
import {HtmlPreviewService,HTML_PREVIEW_CSP} from "./html-preview-service";
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
