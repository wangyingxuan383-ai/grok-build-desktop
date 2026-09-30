import { describe, expect, it } from "vitest";
import { mediaPreviewUrl } from "./artifact-preview";

describe("conversation preview sources",()=>{
 it("uses the original opaque handle without reconstructing filesystem access",()=>{
  expect(mediaPreviewUrl({media:"image",source:"grok-media://access/owned"})).toBe("grok-media://access/owned");
  for(const source of ["D:/private/a.png","file:///D:/private/a.png","https://example.test/a.png","javascript:alert(1)"])
   expect(mediaPreviewUrl({media:"image",source})).toBe("");
 });
 it("allows legacy inline media but never active document types",()=>{
  expect(mediaPreviewUrl({media:"image",source:"fixture",isData:true,mimeType:"image/png"})).toBe("data:image/png;base64,fixture");
  expect(mediaPreviewUrl({media:"image",source:"fixture",isData:true,mimeType:"text/html"})).toBe("");
  expect(mediaPreviewUrl({media:"image",source:"fixture",isData:true,mimeType:"image/svg+xml"})).toBe("");
 });
});
