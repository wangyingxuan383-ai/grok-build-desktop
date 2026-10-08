import type { RemoteOutline, RemoteTurn } from "../../shared/remote";

/** Read-only navigation uses the same projection indices as snapshot paging. */
export function remoteConversationOutline(sessionId:string,events:ReadonlyArray<{type?:unknown;text?:unknown;clientMessageId?:unknown}>,before?:number,query=""):RemoteOutline {
  const turns:RemoteTurn[]=[];const identities=new Set<string>();let current:RemoteTurn|undefined;
  const concise=(text:string,limit:number)=>text.replace(/\s+/g," ").trim().slice(0,limit);
  events.forEach((event,index)=>{
    if(event.type==="user-message"){
      if(typeof event.clientMessageId==="string"&&identities.has(event.clientMessageId))return;
      if(typeof event.clientMessageId==="string")identities.add(event.clientMessageId);
      current={index,ordinal:turns.length+1,prompt:concise(typeof event.text==="string"?event.text:"",200)||"附件消息",preview:""};turns.push(current);
    }else if(event.type==="message-chunk"&&typeof event.text==="string"&&current&&current.preview.length<160){current.preview=concise(current.preview+event.text,160)}
  });
  const normalized=query.trim().toLocaleLowerCase();
  const candidates=turns.filter(turn=>(before===undefined||turn.index<before)&&(!normalized||turn.prompt.toLocaleLowerCase().includes(normalized)));
  const entries=candidates.slice(-200);
  return {sessionId,totalTurns:turns.length,entries,...(candidates.length>entries.length?{before:entries[0]!.index}:{})};
}
