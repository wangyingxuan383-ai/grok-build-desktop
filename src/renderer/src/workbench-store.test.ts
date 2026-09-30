import {beforeEach,expect,it} from "vitest";
import type {EditorDocument} from "../../shared/types";
import {useWorkbenchStore} from "./workbench-store";
const doc=(path:string,content:string):EditorDocument=>({workspacePath:"C:/fixture",path,relativePath:path,content,hash:content,modifiedAt:"2026-09-28T00:00:00Z",editable:true,encoding:"utf8",lineEnding:"lf",languageId:"plaintext",byteLength:content.length} as EditorDocument);
beforeEach(()=>useWorkbenchStore.setState({tabs:[],activeTabKey:""}));
it("accepts a save receipt without erasing edits made while saving or changing the active file",()=>{
 const store=useWorkbenchStore.getState();
 store.openDocument(doc("a","before"));const a=useWorkbenchStore.getState().activeTabKey;
 store.updateBuffer(a,"submitted");store.openDocument(doc("b","other"));const b=useWorkbenchStore.getState().activeTabKey;
 store.updateBuffer(a,"new typing");store.acceptSave(doc("a","submitted"),"submitted");
 expect(useWorkbenchStore.getState().activeTabKey).toBe(b);
 expect(useWorkbenchStore.getState().tabs.find(t=>t.key===a)).toMatchObject({buffer:"new typing",dirty:true,document:{content:"submitted"}});
 store.acceptSave(doc("a","new typing"),"new typing");
 expect(useWorkbenchStore.getState().tabs.find(t=>t.key===a)?.dirty).toBe(false);
});
it("late save receipts cannot recreate a closed view",()=>{
 const store=useWorkbenchStore.getState();store.openDocument(doc("a","before"));store.closeTab(useWorkbenchStore.getState().activeTabKey);
 store.acceptSave(doc("a","saved"),"saved");expect(useWorkbenchStore.getState().tabs).toEqual([]);
});
