/** Versioned UI placement only: no prompts, credentials or duplicate runtime state. */
export type ContentTarget = { kind: "workspace" | "session" | "file" | "review" | "terminal" | "browser" | "artifact" | "subagent"; workspace: string; id: string; title: string };
export type PaneNode = { kind: "leaf"; id: string; tabs: ContentTarget[]; activeTab?: string } | { kind: "split"; id: string; axis: "horizontal" | "vertical"; ratio: number; first: PaneNode; second: PaneNode };
export interface WorkspaceLayout { version: 1; root: PaneNode; focusedPane: string }
export const workspaceKey = (path: string): string => path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
const legacyTargetKey = (target: ContentTarget): string => `${target.kind}:${target.workspace.toLowerCase()}:${target.id}`;
export const targetKey = (target: ContentTarget): string => `${target.kind}:${workspaceKey(target.workspace)}:${target.id}`;
export function leaves(node: PaneNode): Extract<PaneNode,{kind:"leaf"}>[] { return node.kind==="leaf"?[node]:[...leaves(node.first),...leaves(node.second)]; }
export function mapPane(node: PaneNode,id:string,update:(node:PaneNode)=>PaneNode):PaneNode { if(node.id===id)return update(node);return node.kind==="leaf"?node:{...node,first:mapPane(node.first,id,update),second:mapPane(node.second,id,update)}; }
export function openTarget(layout: WorkspaceLayout,paneId:string,target:ContentTarget):WorkspaceLayout { if(!leaves(layout.root).some(p=>p.id===paneId))return layout; return {...layout,focusedPane:paneId,root:mapPane(layout.root,paneId,node=>node.kind!=="leaf"?node:{...node,tabs:node.tabs.some(tab=>targetKey(tab)===targetKey(target))?node.tabs.map(tab=>targetKey(tab)===targetKey(target)?target:tab):[...node.tabs,target],activeTab:targetKey(target)})}; }
export function splitPane(layout:WorkspaceLayout,paneId:string,axis:"horizontal"|"vertical",id:string):WorkspaceLayout {
  if(leaves(layout.root).length>=4)throw Error("最多同时打开四个窗格");
  const source=leaves(layout.root).find(node=>node.id===paneId);if(!source)throw Error("窗格已关闭");
  if(leaves(layout.root).some(node=>node.id===id))throw Error("窗格 ID 重复");
  const current=source.tabs.find(tab=>targetKey(tab)===source.activeTab);
  return {...layout,focusedPane:id,root:mapPane(layout.root,paneId,node=>({kind:"split",id:`split-${id}`,axis,ratio:.5,first:node,second:{kind:"leaf",id,tabs:current?[current]:[],activeTab:current?targetKey(current):undefined}}))};
}
export function closePane(layout:WorkspaceLayout,paneId:string):WorkspaceLayout {
  if(layout.root.kind==="leaf")return layout;
  const remove=(node:PaneNode):PaneNode|undefined=>{if(node.id===paneId)return undefined;if(node.kind==="leaf")return node;const first=remove(node.first),second=remove(node.second);return !first?second:!second?first:{...node,first,second}};
  const root=remove(layout.root)!;const focusedPane=leaves(root).some(node=>node.id===layout.focusedPane)?layout.focusedPane:leaves(root)[0]!.id;return {...layout,root,focusedPane};
}
export function moveTab(layout:WorkspaceLayout,sourceId:string,destinationId:string,key:string,index:number):WorkspaceLayout {
 const source=leaves(layout.root).find(node=>node.id===sourceId),destination=leaves(layout.root).find(node=>node.id===destinationId);const target=source?.tabs.find(tab=>targetKey(tab)===key);if(!source||!destination||!target)return layout;
 let root=mapPane(layout.root,sourceId,node=>{if(node.kind!=="leaf")return node;const tabs=node.tabs.filter(tab=>targetKey(tab)!==key);return {...node,tabs,activeTab:node.activeTab===key?(tabs[0]?targetKey(tabs[0]):undefined):node.activeTab}});
 root=mapPane(root,destinationId,node=>{if(node.kind!=="leaf")return node;const tabs=node.tabs.filter(tab=>targetKey(tab)!==key);tabs.splice(Math.max(0,Math.min(index,tabs.length)),0,target);return {...node,tabs,activeTab:key}});return {...layout,root,focusedPane:destinationId};
}
export function initialLayout():WorkspaceLayout { return {version:1,root:{kind:"leaf",id:"main",tabs:[]},focusedPane:"main"}; }
export function restoreLayout(value:unknown):WorkspaceLayout {
  const fail=()=>initialLayout();if(!value||typeof value!=="object")return fail();const candidate=value as WorkspaceLayout;let count=0;const ids=new Set<string>();
  const valid=(node:PaneNode,depth=0):boolean=>{if(!node||depth>6||typeof node.id!=="string"||ids.has(node.id))return false;ids.add(node.id);if(node.kind==="split")return ["horizontal","vertical"].includes(node.axis)&&Number.isFinite(node.ratio)&&node.ratio>=.15&&node.ratio<=.85&&valid(node.first,depth+1)&&valid(node.second,depth+1);if(node.kind!=="leaf"||++count>4||!Array.isArray(node.tabs)||node.tabs.length>100)return false;return node.tabs.every(tab=>tab&&["workspace","session","file","review","terminal","browser","artifact","subagent"].includes(tab.kind)&&typeof tab.id==="string"&&typeof tab.workspace==="string"&&typeof tab.title==="string")&&(!node.activeTab||node.tabs.some(tab=>targetKey(tab)===node.activeTab||legacyTargetKey(tab)===node.activeTab));};
  if(candidate.version!==1||!valid(candidate.root)||!leaves(candidate.root).some(node=>node.id===candidate.focusedPane))return fail();
  // Keep the old layout and focus while merging alternate Windows path spellings.
  let root=candidate.root;
  for(const pane of leaves(root)) {
    const active=pane.tabs.find(tab=>targetKey(tab)===pane.activeTab||legacyTargetKey(tab)===pane.activeTab);
    const unique=new Map(pane.tabs.map(tab=>[targetKey(tab),tab]));
    root=mapPane(root,pane.id,node=>node.kind==="leaf"?{...node,tabs:[...unique.values()],activeTab:active?targetKey(active):undefined}:node);
  }
  return {...candidate,root};
}

/** Remove view references only; runtime and persisted conversation ownership stay elsewhere. */
export function removeTabs(layout:WorkspaceLayout,paneId:string|undefined,predicate:(target:ContentTarget)=>boolean):WorkspaceLayout {
 let root=layout.root;
 for(const pane of leaves(root)){
  if(paneId&&pane.id!==paneId)continue;
  const activeIndex=pane.tabs.findIndex(t=>targetKey(t)===pane.activeTab);
  const tabs=pane.tabs.filter(t=>!predicate(t));
  const activeTab=tabs.some(t=>targetKey(t)===pane.activeTab)?pane.activeTab:tabs.length?targetKey(tabs[Math.max(0,Math.min(activeIndex,tabs.length-1))]!):undefined;
  root=mapPane(root,pane.id,n=>n.kind==="leaf"?{...n,tabs,activeTab}:n);
 }
 return {...layout,root};
}
