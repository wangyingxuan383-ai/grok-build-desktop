const {test}=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const Module=require("node:module");
const ts=require("typescript"),React=require("react"),renderer=require("react-test-renderer");
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
function loadPlain(relative){const path=join(__dirname,relative),module=new Module(path);module._compile(ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,path);return module.exports;}
function load(mocks){const path=join(__dirname,"../src/use-remote.ts"),module=new Module(path);module.paths=Module._nodeModulePaths(join(__dirname,".."));module.require=id=>id in mocks?mocks[id]:id==="./connection-errors"?loadPlain("../src/connection-errors.ts"):require(id);module._compile(ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,path);return module.exports.useRemote;}
test("a failed historical read and receipt-cache write cannot turn an accepted send into a connection failure",async()=>{
 const host={id:"test-device",fingerprint:"a".repeat(64),host:"https://desktop.example.invalid",token:"fixture",name:"fixture"};
 let client,posts=0;const store=new Map();
 const cache={cacheRead:async()=>undefined,cacheWrite:async()=>{},savedRead:async()=>undefined,savedWrite:async()=>{}};
 class Manager{constructor(deps){this.deps=deps}start(){void this.deps.read().then(()=>this.deps.state({phase:"online",mode:"live",failures:0}))}stop(){}refresh(){void this.deps.refresh().catch(()=>{})}}
 const storage={getItem:async key=>store.get(key)||null,setItem:async(key,value)=>store.set(key,value),removeItem:async key=>{if(key.endsWith(".unknown"))throw Error("cache unavailable");store.delete(key)}};
 const api=async(_host,path,body)=>{
  if(path==="/v1/info")return {protocol:1};
  if(path==="/v1/sessions")return {sessions:[{id:"s",canSend:true,status:"idle"}],cursor:0,epoch:"fixture",serverTime:Date.now()};
  if(path.startsWith("/v1/options"))return {capabilities:[],workspaces:[],models:[{modelId:"current",name:"Current"}]};
  if(path.startsWith("/v1/sessions/"))throw Error("history temporarily unavailable");
  if(path==="/v1/operations"){posts++;return {...body,state:"accepted",createdAt:new Date().toISOString()}}
  throw Error("unexpected fixture request");
 };
 const useRemote=load({"react-native":{AppState:{currentState:"active",addEventListener:()=>({remove(){}})}},"@react-native-async-storage/async-storage":storage,"expo-crypto":{randomUUID:()=>"00000000-0000-4000-8000-000000000001"},"./transport":{api,listen:()=>()=>{},discoverComputers:async()=>[]},"./connection":{ConnectionManager:Manager},"./draft-store":{draftKey:()=>"draft",readDraft:async()=>"",preservePairingDrafts:async()=>{}},"./remote-model":{mergeEventWindows:(...windows)=>windows.flat()},"./cache":cache});
 function Probe(){client=useRemote(host);return null}let tree;
 try{
  await renderer.act(async()=>{tree=renderer.create(React.createElement(Probe));await new Promise(r=>setTimeout(r,20))});
  await renderer.act(async()=>{client.selectSession("s");await new Promise(r=>setTimeout(r,20))});
  await renderer.act(()=>client.setDraft("你好"));
  await renderer.act(async()=>{await client.perform("send");await new Promise(r=>setTimeout(r,20))});
  assert.equal(posts,1);assert.equal(client.receipt.state,"accepted");assert.equal(client.connection.phase,"online");
  assert.equal(client.error,"");assert.equal(client.unknown,undefined);assert.equal(client.draft,"");
  assert.match(client.readError,/history/);
 }finally{if(tree)await renderer.act(()=>tree.unmount())}
});
test("model refresh is shared, local to its picker and preserves the workspace catalog",async()=>{
 const host={id:"test-device",fingerprint:"b".repeat(64),host:"https://desktop.example.invalid",token:"fixture",name:"fixture"};let client,requests=0,fail=true;
 class Manager{constructor(deps){this.deps=deps}start(){void this.deps.read().then(()=>this.deps.state({phase:"online",mode:"live",failures:0}))}stop(){}refresh(){}}
 const api=async(_host,path)=>{if(path==="/v1/info")return{protocol:1};if(path==="/v1/sessions")return{sessions:[],epoch:"fixture",cursor:0};if(path.includes("scope=models")){requests++;await new Promise(r=>setTimeout(r,15));if(fail)throw Error("catalog unavailable");return{capabilities:[],workspaces:[],models:[{modelId:"fresh",name:"Fresh"}]}}return{capabilities:[],workspaces:[{id:"valid",profiles:[]}],models:[{modelId:"cached",name:"Cached"}]}};
 const storage={getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}};
 const useRemote=load({"react-native":{AppState:{currentState:"active",addEventListener:()=>({remove(){}})}},"@react-native-async-storage/async-storage":storage,"expo-crypto":{},"./transport":{api,listen:()=>()=>{},discoverComputers:async()=>[]},"./connection":{ConnectionManager:Manager},"./draft-store":{draftKey:()=>"draft",readDraft:async()=>"",preservePairingDrafts:async()=>{}},"./remote-model":{mergeEventWindows:(...windows)=>windows.flat()},"./cache":{cacheRead:async()=>undefined,cacheWrite:async()=>{},savedRead:async()=>undefined,savedWrite:async()=>{}}});
 function Probe(){client=useRemote(host);return null}let tree;
 try{
  await renderer.act(async()=>{tree=renderer.create(React.createElement(Probe));await new Promise(r=>setTimeout(r,20))});
  await renderer.act(async()=>{await Promise.allSettled([client.loadOptions(true),client.loadOptions(true)])});
  assert.equal(requests,1);assert.match(client.optionsError,/catalog unavailable/);assert.equal(client.error,"");assert.equal(client.connection.phase,"online");assert.equal(client.options.models[0].modelId,"cached");assert.equal(client.optionsLoading,false);
  fail=false;await renderer.act(async()=>{await client.loadOptions(true)});assert.equal(client.optionsError,"");assert.equal(client.options.workspaces[0].id,"valid");assert.equal(client.options.models[0].modelId,"fresh");
 }finally{if(tree)await renderer.act(()=>tree.unmount())}
});
