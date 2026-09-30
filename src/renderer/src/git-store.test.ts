import {afterEach,describe,expect,it} from "vitest";
import {useGitStore} from "./git-store";
import type {GitRepositoryStatus} from "../../shared/workbench-types";
const status=(changes:GitRepositoryStatus["changes"]):GitRepositoryStatus=>({workspacePath:"D:/work",repositoryRoot:"D:/work",clean:changes.length===0,changes,conflicts:[],checkedAt:"now"});
afterEach(()=>useGitStore.getState().reset());
describe("Git pane selection",()=>{
 it("preserves a still-present path across repository refresh and drops paths that disappeared",()=>{const change={path:"src/app.ts",kind:"modified" as const,staged:false,workingTree:true};const store=useGitStore.getState();store.setRepository("D:/work",undefined,status([change]));store.setSelection({path:change.path,staged:false});useGitStore.getState().setRepository("d:/WORK",undefined,status([change]));expect(useGitStore.getState().selection).toEqual({path:change.path,staged:false});useGitStore.getState().setRepository("D:/work",undefined,status([]));expect(useGitStore.getState().selection).toBeUndefined()});
 it("does not carry a review selection into a different workspace",()=>{const change={path:"src/app.ts",kind:"modified" as const,staged:false,workingTree:true};useGitStore.getState().setRepository("D:/one",undefined,status([change]));useGitStore.getState().setSelection({path:change.path,staged:false});useGitStore.getState().setRepository("D:/two",undefined,status([change]));expect(useGitStore.getState().selection).toBeUndefined()});
});
