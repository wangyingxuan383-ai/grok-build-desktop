import test from "node:test";
import assert from "node:assert/strict";
import {parsePairingOffer,PairingTargetTracker,messagesFromEvents,mergeEventWindows,conversationRows,readableToolText,sessionStatusLabel} from "./remote-model.ts";
test("opening saved conversations does not promote an idle connection exit into a current task failure",()=>{
 const idle=messagesFromEvents([{type:"user-message",text:"question"},{type:"turn-started"},{type:"message-chunk",text:"done"},{type:"turn-completed"},{type:"error",message:"Grok 进程已退出（代码 0）"}]);
 assert.equal(idle.at(-1)?.role,"status");assert.ok(conversationRows(idle).some(row=>row.activity?.some(message=>message.title==="连接记录")));
 const interrupted=messagesFromEvents([{type:"error",message:"Grok 进程已退出（代码 1）",failure:{turnId:"running-turn"}}]);assert.equal(interrupted[0]?.role,"error");
 const active=messagesFromEvents([{type:"turn-started"},{type:"error",message:"Grok 进程已退出（代码 1）"}]);assert.equal(active[0]?.role,"error");
 assert.equal(sessionStatusLabel("cold"),"");assert.equal(sessionStatusLabel("idle"),"");assert.equal(sessionStatusLabel("working"),"执行中");assert.equal(sessionStatusLabel("cold",false),"只读");
});
test("delivery remains readable when a status precedes a slow echo; terminal output is folded and ANSI removed",()=>{
 const rows=messagesFromEvents([{type:"user-message-status",clientMessageId:"hello",delivery:"sent"},{type:"user-message",clientMessageId:"hello",text:"你好",delivery:"sending"},{type:"command-output",text:"\u001b[31m检查完成\u001b[0m"},{type:"message-chunk",text:"完成了。"}]);
 assert.equal(rows[0]?.status,"sent");assert.equal(rows[1]?.text,"检查完成");
 const display=conversationRows(rows);assert.equal(display[1]?.activity?.[0]?.role,"status");assert.equal(display[2]?.message?.text,"完成了。");
 assert.equal(readableToolText("中文\r结果"),"中文\n结果");
});
const pin="a".repeat(64),code="b".repeat(43);
test("disjoint search pages do not concatenate answers across unread history, while filtered event indexes remain continuous",()=>{
 const first=[{type:"message-chunk",remoteIndex:1,text:"old"},{type:"message-chunk",remoteIndex:5,text:" answer"}];
 assert.equal(mergeEventWindows(first).filter(e=>e.type==="history-gap").length,0);
 const windows=mergeEventWindows(first,[{type:"message-chunk",remoteIndex:20,text:"latest"}]);
 assert.equal(windows.filter(e=>e.type==="history-gap").length,1);
 assert.deepEqual(messagesFromEvents(windows).filter(m=>m.role==="assistant").map(m=>m.text),["old answer","latest"]);
 assert.equal(mergeEventWindows(windows,[{type:"message-chunk",remoteIndex:6,text:"middle"},{type:"message-chunk",remoteIndex:19,text:"end"}]).filter(e=>e.type==="history-gap").length,0);
});
const link=`grokremote://pair?v=1&host=${encodeURIComponent("https://192.168.1.10:48975")}&fp=${pin}&code=${code}`;
test("pairing preserves exact host and pin and rejects altered identities",()=>{assert.equal(parsePairingOffer(link).host,"https://192.168.1.10:48975");assert.throws(()=>parsePairingOffer(link.replace("https%3A","http%3A")));assert.throws(()=>parsePairingOffer(link.replace(pin,"invalid")));const tracker=new PairingTargetTracker();assert.equal(tracker.changeUrl(link),false);assert.equal(tracker.changeUrl("partial"),false);assert.equal(tracker.changeUrl(link.replace(pin,"c".repeat(64))),true)});
test("candidate pairing addresses retain one pinned computer identity",()=>{const candidates=["https://desktop.example.invalid:48975","https://peer.example.invalid:48975"];const offer=parsePairingOffer(link+"&hosts="+encodeURIComponent(JSON.stringify(candidates)));assert.equal(offer.fingerprint,pin);assert.equal(offer.hosts?.length,3);assert.throws(()=>parsePairingOffer(link+"&hosts="+encodeURIComponent(JSON.stringify(["http://peer.example.invalid"]))));});
test("plans remain in history after approval and preserve actual navigation positions",()=>{const rows=messagesFromEvents([{type:"plan",sessionId:"s",text:"Review files",remoteIndex:12,requestId:"p"}as any,{type:"interaction-resolved",sessionId:"s",interaction:"plan",requestId:"p",outcome:"approved",remoteIndex:13}as any,{type:"message-chunk",text:"one ",remoteIndex:14},{type:"message-chunk",text:"two",remoteIndex:15}]);assert.equal(rows[0]?.role,"plan");assert.equal(rows[0]?.text,"Review files");assert.equal(rows[0]?.status,"approved");assert.equal(rows[1]?.remoteIndex,14);assert.equal(rows[1]?.remoteEnd,15);assert.equal(rows[1]?.text,"one two");});
test("tool/user updates are merged by real IDs without double counting",()=>{const rows=messagesFromEvents([{type:"user-message",clientMessageId:"m1",text:"hello"},{type:"user-message",clientMessageId:"m1",text:"hello"},{type:"message-chunk",text:"one "},{type:"message-chunk",text:"two"},{type:"tool-call",tool:{toolCallId:"t1",title:"read",status:"in_progress"}},{type:"tool-call",tool:{toolCallId:"t1",title:"read",status:"completed",output:"ok"}}]);assert.equal(rows.length,3);assert.equal(rows[1]?.text,"one two");assert.equal(rows[2]?.status,"completed")});
test("subagent cards use child identities instead of task titles",()=>{const rows=messagesFromEvents([{type:"subagent",update:{subagent_id:"c1",description:"same",status:"working"}},{type:"subagent",update:{subagent_id:"c2",description:"same",status:"working"}},{type:"subagent",update:{subagent_id:"c1",status:"completed",output:"done"}}]);assert.equal(rows.length,2);assert.equal(rows[0]?.text,"done")});
test("history pages overlapping a live snapshot do not duplicate streamed text",()=>{const window=mergeEventWindows([{type:"message-chunk",text:"first",remoteIndex:1},{type:"message-chunk",text:" old",remoteIndex:2}],[{type:"message-chunk",text:" current",remoteIndex:2},{type:"message-chunk",text:" last",remoteIndex:3}]);assert.equal(window.length,3);assert.equal(messagesFromEvents(window)[0]?.text,"first current last")});
test("interleaved progress leaves one readable answer and keeps child identity/title",()=>{const messages=messagesFromEvents([{type:"user-message",id:"prompt",text:"Work"},{type:"message-chunk",text:"First "},{type:"tool-call",tool:{toolCallId:"one",title:"Read",status:"in_progress"}},{type:"message-chunk",text:"answer."},{type:"subagent",update:{subagent_id:"agent",child_session_id:"child",description:"Review"}},{type:"subagent",update:{subagent_id:"agent",status:"completed"}},{type:"turn-completed"},{type:"message-chunk",text:"Next turn."}]);const rows=conversationRows(messages);assert.equal(messages.filter(m=>m.role==="assistant")[0]?.text,"First answer.");assert.equal(rows[1]?.activity?.length,2);assert.deepEqual(rows[1]?.activity?.[1],{id:"agent:agent",role:"agent",title:"Review",text:"",status:"completed",childSessionId:"child"});assert.equal(messages.filter(m=>m.role==="assistant").length,2)});
test("a parent id reported in an update is never offered as a child transcript",()=>{const rows=messagesFromEvents([{type:"subagent",sessionId:"parent",update:{subagent_id:"agent",session_id:"parent",description:"Review"}}]);assert.equal(rows[0]?.childSessionId,undefined)});

test("child usage remains a separately reported counter and tool search anchors retain IDs",()=>{const rows=messagesFromEvents([{type:"subagent",sessionId:"parent",update:{subagent_id:"a",child_session_id:"child",tokens_used:100,status:"running"}},{type:"subagent",sessionId:"parent",update:{subagent_id:"a",tokens_used:120,status:"completed"}},{type:"tool-call",remoteIndex:8,tool:{toolCallId:"t",title:"ordinary",status:"completed",output:"file"}}]);assert.equal(rows[0]?.childTokens,120);assert.equal(rows[0]?.childSessionId,"child");assert.equal(rows.filter(r=>r.role==="agent").length,1);assert.equal(rows[1]?.remoteIndex,8);});

test("resolved approvals stay visible in history with what was decided", async () => {
  const { messagesFromEvents, decisionLabel } = await import("./remote-model.ts");
  const rows = messagesFromEvents([
    { type: "permission", sessionId: "s", request: { requestId: 7, toolCall: { title: "运行 npm test" }, options: [] }, remoteIndex: 1 },
    { type: "interaction-resolved", sessionId: "s", interaction: "permission", requestId: 7, outcome: "allow_once", remoteIndex: 2 },
  ] as never);
  const record = rows.find(row => row.id.startsWith("resolved:"));
  assert.equal(record?.title, "审批记录");
  assert.equal(record?.text, "已允许：运行 npm test");
  assert.equal(decisionLabel("permission", "reject_once"), "已拒绝");
  assert.equal(decisionLabel("permission", "allow_always"), "已始终允许");
});
