import {expect,it} from "vitest";
import {encodeMediaArtifact,decodeMediaArtifact,mediaArtifactPrefix} from "./media-artifact-target";
it("persists only a scoped opaque media reference",()=>{
 const target={kind:"media" as const,sessionId:"owner",messageId:"m",media:"image" as const,source:"grok-media://access/opaque"};
 expect(decodeMediaArtifact(encodeMediaArtifact(target))).toEqual(target);
 expect(()=>encodeMediaArtifact({...target,isData:true,source:"base64"})).toThrow();
 expect(decodeMediaArtifact(mediaArtifactPrefix+JSON.stringify({...target,source:"file:///C:/private.png"}))).toBeUndefined();
 expect(decodeMediaArtifact(mediaArtifactPrefix+JSON.stringify({...target,source:"grok-media://access/opaque?session=someone-else"}))).toBeUndefined();
 expect(decodeMediaArtifact(mediaArtifactPrefix+"bad")).toBeUndefined();
});
