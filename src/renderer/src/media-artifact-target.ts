import type {MediaPreview} from "./artifact-preview";
export const mediaArtifactPrefix="grok-preview:";
/** Persist an opaque media reference, never a Base64 payload or filesystem authority. */
export function encodeMediaArtifact(target:MediaPreview):string{
 if(target.isData||!target.source.startsWith("grok-media://access/"))throw Error("此旧版内嵌媒体需先另存文件再固定");
 return mediaArtifactPrefix+JSON.stringify({sessionId:target.sessionId,messageId:target.messageId,media:target.media,source:target.source,mimeType:target.mimeType});
}
export function decodeMediaArtifact(value:string):MediaPreview|undefined{
 if(!value.startsWith(mediaArtifactPrefix)||value.length>8192)return;
 try{
  const item=JSON.parse(value.slice(mediaArtifactPrefix.length));
  if(!item||!["image","video"].includes(item.media)||typeof item.sessionId!=="string"||!item.sessionId||typeof item.messageId!=="string"||typeof item.source!=="string")return;
  const url=new URL(item.source);if(url.protocol!=="grok-media:"||url.hostname!=="access"||url.username||url.password)return;
  if(url.searchParams.has("session")&&url.searchParams.get("session")!==item.sessionId)return;
  return {kind:"media",sessionId:item.sessionId,messageId:item.messageId,source:item.source,media:item.media,mimeType:typeof item.mimeType==="string"?item.mimeType:undefined};
 }catch{return}
}
