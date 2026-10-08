import {describe,it,expect} from "vitest";
import {remoteConversationOutline} from "./remote-conversation-outline";
import type {ChatEvent} from "../../shared/types";

describe("read-only conversation navigation",()=>{
 it("indexes questions beyond the loaded page and preserves the snapshot anchor",()=>{
  const events:ChatEvent[]=Array.from({length:205},(_,index)=>[
   {type:"user-message",sessionId:"s",clientMessageId:String(index),text:`问题 ${index+1}`},
   {type:"message-chunk",sessionId:"s",text:`回答 ${index+1}`},
  ]as ChatEvent[]).flat();
  const page=remoteConversationOutline("s",events);expect(page.totalTurns).toBe(205);expect(page.entries).toHaveLength(200);
  expect(page.entries[0]).toMatchObject({index:10,ordinal:6,prompt:"问题 6",preview:"回答 6"});
  expect(remoteConversationOutline("s",events,page.before).entries.map(turn=>turn.ordinal)).toEqual([1,2,3,4,5]);
  expect(remoteConversationOutline("s",events,undefined,"问题 205").entries[0]).toMatchObject({index:408,ordinal:205});
 });
 it("deduplicates delivery echoes, ignores execution noise and bounds previews",()=>{
  const events:any[]=[{type:"user-message",clientMessageId:"a",text:"首问"},{type:"tool-call",tool:{output:"noise"}},{type:"message-chunk",text:"answer".repeat(1000)},{type:"user-message",clientMessageId:"a",text:"首问"}];
  const outline=remoteConversationOutline("s",events);expect(outline.totalTurns).toBe(1);expect(outline.entries[0]?.preview).toHaveLength(160);
 });
});
