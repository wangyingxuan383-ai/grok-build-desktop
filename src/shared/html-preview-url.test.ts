import {expect,it} from "vitest";
import {trustedHtmlPreviewUrl} from "./html-preview-url";
it("accepts only canonical main-issued preview handles",()=>{
 const id="00112233-4455-6677-8899-aabbccddeeff";expect(trustedHtmlPreviewUrl(`grok-html://preview/${id}`)).toBe(`grok-html://preview/${id}`);
 for(const url of ["javascript:alert(1)","data:text/html,bad",`https://example.com/${id}`,`grok-html://user@preview/${id}`,`grok-html://preview/${id}?other=1`,`grok-html://preview/${id}#x`,`grok-html://preview/${id}/other`])expect(trustedHtmlPreviewUrl(url)).toBeUndefined();
});
