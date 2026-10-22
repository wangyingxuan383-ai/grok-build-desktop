import { describe,it,expect,vi } from "vitest";
vi.mock("node:fs/promises",async importOriginal=>{const actual=await importOriginal<typeof import("node:fs/promises")>();return {...actual,open:vi.fn(actual.open)};});
import { readFile,open } from "node:fs/promises";
import { DesktopPetAssets,validatePetSkin } from "./desktop-pet-assets";
describe("data-only pet packs",()=>{
 it("rejects oversized files before reading and closes files that grow during import",async()=>{
  const oversizedRead=vi.fn(),oversizedClose=vi.fn(async()=>undefined);
  vi.mocked(open).mockResolvedValueOnce({stat:async()=>({isFile:()=>true,size:25*1024*1024}),read:oversizedRead,close:oversizedClose} as unknown as Awaited<ReturnType<typeof open>>);
  const assets=new DesktopPetAssets("unused","unused");
  await expect(assets.import("oversized.png")).rejects.toThrow("24 MiB");
  expect(oversizedRead).not.toHaveBeenCalled();expect(oversizedClose).toHaveBeenCalledOnce();
  const growingRead=vi.fn().mockResolvedValueOnce({bytesRead:4}).mockResolvedValueOnce({bytesRead:1}),growingClose=vi.fn(async()=>undefined);
  vi.mocked(open).mockResolvedValueOnce({stat:async()=>({isFile:()=>true,size:4}),read:growingRead,close:growingClose} as unknown as Awaited<ReturnType<typeof open>>);
  await expect(assets.import("growing.png")).rejects.toThrow("发生变化");expect(growingClose).toHaveBeenCalledOnce();
 });
 it("validates all built-in animation manifests under the unchanged combined budget",async()=>{for(const id of ["a","b"]){const skin=validatePetSkin(JSON.parse(await readFile(`resources/pets/${id}/skin.json`,"utf8")));expect(Object.keys(skin.clips)).toHaveLength(11);for(const clip of Object.values(skin.clips))expect(clip.frames.every(f=>f.anchorY===464)).toBe(true);}});
 it("rejects traversal, impossible frames and unbounded resources",()=>{const source={id:"custom",name:"name",author:"author",license:"license",clips:{idle:{file:"a.webp",width:100,height:100,referenceHeight:100,loop:false,frames:[{x:0,y:0,width:100,height:100,anchorX:50,anchorY:100,duration:1000}]}}};for(const patch of [{file:"../a.webp"},{width:99999},{frames:[{x:0,y:0,width:200,height:100,anchorX:50,anchorY:100,duration:1000}]}])expect(()=>validatePetSkin({...source,clips:{idle:{...source.clips.idle,...patch}}})).toThrow();});
});
