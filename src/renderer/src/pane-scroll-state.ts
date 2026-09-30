type Position = { top: number; index: number };
const positions = new Map<string, Position>();
const storageKey="grok.pane-scroll.v1";
let saveTimer:ReturnType<typeof setTimeout>|undefined;
function persist(){
  clearTimeout(saveTimer);saveTimer=undefined;
  try{
    let data=JSON.stringify({version:1,entries:[...positions]});
    while(data.length>200_000&&positions.size){positions.delete(positions.keys().next().value!);data=JSON.stringify({version:1,entries:[...positions]})}
    localStorage.setItem(storageKey,data);
  }catch{}
}
try{
  const raw=localStorage.getItem(storageKey);
  if(raw&&raw.length<=200_000){
    const value=JSON.parse(raw);
    if(value?.version===1&&Array.isArray(value.entries))for(const entry of value.entries.slice(-200)){
      if(!Array.isArray(entry)||entry.length!==2)continue;
      const [key,position]=entry;
      if(typeof key!=="string"||key.length>2048||!position||!Number.isFinite(position.top)||position.top<0||position.top>1e9||!Number.isInteger(position.index)||position.index<0||position.index>2e6)continue;
      positions.set(key,{top:position.top,index:position.index});
    }
  }
}catch{}
if(typeof window!=="undefined"){
  window.addEventListener("pagehide",persist);
  window.addEventListener("grok:layout-reset-complete",()=>{positions.clear();persist()});
}
/** Bounded viewport metadata only; never stores transcript, file contents or runtime state. */
export function readPaneScroll(key: string): Position { return positions.get(key) ?? {top:0,index:0}; }
export function writePaneScroll(key: string, patch: Partial<Position>): void {
  if(!key||key.length>2048)return;
  const previous=readPaneScroll(key);
  const valid=(value: number|undefined, fallback:number)=>value!==undefined && Number.isFinite(value)?Math.max(0,value):fallback;
  positions.delete(key);
  positions.set(key,{top:Math.min(1e9,valid(patch.top,previous.top)),index:Math.min(2e6,Math.floor(valid(patch.index,previous.index)))});
  if(positions.size>200)positions.delete(positions.keys().next().value!);
  clearTimeout(saveTimer);saveTimer=setTimeout(persist,300);
}
