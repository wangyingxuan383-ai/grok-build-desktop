import {describe,it,expect} from "vitest";
import {removeTabs,initialLayout,openTarget,splitPane,closePane,leaves,moveTab,restoreLayout,targetKey} from "./workspace-layout";
const target={kind:"session" as const,workspace:"D:/one",id:"session",title:"会话"};
describe("workspace placement",()=>{
 it("restores legacy Windows path keys without losing focus or duplicating a session",()=>{
  const one={...target,workspace:"D:\\ONE\\"};const two={...target,workspace:"d:/one"};
  const legacy={version:1,focusedPane:"main",root:{kind:"leaf",id:"main",tabs:[one,two],activeTab:`session:${one.workspace.toLowerCase()}:session`}};
  const restored=restoreLayout(legacy);expect(leaves(restored.root)[0]?.tabs).toHaveLength(1);expect(leaves(restored.root)[0]?.activeTab).toBe(targetKey(two));
  expect(leaves(openTarget(restored,"main",one).root)[0]?.tabs).toHaveLength(1);
  expect(legacy.root.tabs).toHaveLength(2);
 });
 it("duplicates a view without inventing another runtime identity, limits nesting and keeps focus valid on close",()=>{let layout=openTarget(initialLayout(),"main",target);layout=splitPane(layout,"main","horizontal","two");expect(leaves(layout.root)[1]?.tabs[0]).toEqual(target);layout=splitPane(layout,"two","vertical","three");layout=splitPane(layout,"three","horizontal","four");expect(()=>splitPane(layout,"four","vertical","five")).toThrow("四");layout=closePane(layout,"four");expect(leaves(layout.root)).toHaveLength(3);expect(leaves(layout.root).some(p=>p.id===layout.focusedPane)).toBe(true)});
 it("moves and reorders tab placement without merging identities across workspaces",()=>{let layout=openTarget(initialLayout(),"main",target);layout=openTarget(layout,"main",{...target,workspace:"D:/two"});layout=splitPane(layout,"main","horizontal","two");layout=moveTab(layout,"main","two",targetKey(target),0);expect(leaves(layout.root)[0]?.tabs).toHaveLength(1);expect(leaves(layout.root)[1]?.tabs).toHaveLength(2);expect(leaves(layout.root)[1]?.activeTab).toBe(targetKey(target))});
 it("rejects malformed persisted trees while preserving valid layouts",()=>{const layout=openTarget(initialLayout(),"main",target);expect(restoreLayout(layout)).toEqual(layout);expect(restoreLayout({...layout,focusedPane:"missing"})).toEqual(initialLayout());expect(restoreLayout({version:1,root:{kind:"split",id:"a",first:null,second:null,ratio:.5},focusedPane:"main"})).toEqual(initialLayout())});
 it("keeps distinct file and review targets bound to their workspace and restores their focus",()=>{const file={kind:"file" as const,workspace:"D:/one",id:"D:/one\0src/a.ts",title:"src/a.ts"};const review={kind:"review" as const,workspace:"D:/one",id:JSON.stringify({path:"src/a.ts",staged:false}),title:"src/a.ts"};let layout=openTarget(initialLayout(),"main",file);layout=splitPane(layout,"main","vertical","review-pane");layout=openTarget(layout,"review-pane",review);expect(leaves(layout.root)[0]?.tabs[0]).toEqual(file);expect(leaves(layout.root)[1]?.tabs.map(tab=>tab.kind)).toEqual(["file","review"]);const restored=restoreLayout(JSON.parse(JSON.stringify(layout)));expect(leaves(restored.root)[1]?.activeTab).toBe(targetKey(review));expect(targetKey(file)).not.toBe(targetKey(review))});
});

it("closes exactly the addressed view, preserves other panes and permits an empty final pane",()=>{
 let layout=openTarget(initialLayout(),"main",target);layout=openTarget(layout,"main",{...target,id:"second"});layout=splitPane(layout,"main","horizontal","two");
 const next=removeTabs(layout,"main",t=>t.id==="second");expect(leaves(next.root)[0]?.tabs.map(t=>t.id)).toEqual(["session"]);expect(leaves(next.root)[1]?.tabs.map(t=>t.id)).toEqual(["second"]);
 const empty=removeTabs(next,undefined,()=>true);expect(leaves(empty.root).every(p=>p.tabs.length===0&&!p.activeTab)).toBe(true);expect(restoreLayout(empty)).toEqual(empty);
});
