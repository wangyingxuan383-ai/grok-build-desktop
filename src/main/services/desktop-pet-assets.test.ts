import { describe,it,expect } from "vitest";
import { readFile } from "node:fs/promises";
import { validatePetSkin } from "./desktop-pet-assets";
describe("data-only pet packs",()=>{
 it("validates all built-in animation manifests under the unchanged combined budget",async()=>{for(const id of ["a","b"]){const skin=validatePetSkin(JSON.parse(await readFile(`resources/pets/${id}/skin.json`,"utf8")));expect(Object.keys(skin.clips)).toHaveLength(11);for(const clip of Object.values(skin.clips))expect(clip.frames.every(f=>f.anchorY===464)).toBe(true);}});
 it("rejects traversal, impossible frames and unbounded resources",()=>{const source={id:"custom",name:"name",author:"author",license:"license",clips:{idle:{file:"a.webp",width:100,height:100,referenceHeight:100,loop:false,frames:[{x:0,y:0,width:100,height:100,anchorX:50,anchorY:100,duration:1000}]}}};for(const patch of [{file:"../a.webp"},{width:99999},{frames:[{x:0,y:0,width:200,height:100,anchorX:50,anchorY:100,duration:1000}]}])expect(()=>validatePetSkin({...source,clips:{idle:{...source.clips.idle,...patch}}})).toThrow();});
});
