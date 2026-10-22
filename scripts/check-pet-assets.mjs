import { readFile,readdir,stat } from "node:fs/promises";
import { join,resolve } from "node:path";
const root=resolve(import.meta.dirname,"../resources/pets");
let total=0,count=0;
const allowed=new Set(["NOTICES.md"]);
for(const id of ["a","b"]){
 const skin=JSON.parse(await readFile(join(root,id,"skin.json"),"utf8"));
 if(skin.id!==id||!skin.clips?.idle||!skin.clips?.enter||!skin.clips?.exit)throw Error("Built-in companion is missing core clips");
 allowed.add(`${id}/skin.json`);
 for(const clip of Object.values(skin.clips)){
  if(!/^[a-z-]+\.webp$/.test(clip.file))throw Error("Only runtime WebP atlases belong in the built-in art pack");
  const key=`${id}/${clip.file}`;allowed.add(key);
  const data=await readFile(join(root,key));
  if(data.toString("ascii",0,4)!=="RIFF"||data.toString("ascii",8,12)!=="WEBP")throw Error("Invalid WebP atlas");
  if(!clip.frames.length||clip.frames.some(f=>![f.x,f.y,f.width,f.height,f.anchorX,f.anchorY,f.duration].every(Number.isFinite)||f.x<0||f.y<0||f.x+f.width>clip.width||f.y+f.height>clip.height))throw Error("Atlas frames exceed declared dimensions");
 }
}
async function visit(path,prefix=""){
 for(const row of await readdir(path,{withFileTypes:true})){const key=prefix+row.name;if(row.isDirectory())await visit(join(path,row.name),key+"/");else{if(!row.isFile()||!allowed.has(key))throw Error("Unexpected file in runtime art pack: "+key);total+=(await stat(join(path,row.name))).size;count++;}}
}
await visit(root);
if(total>8*1024*1024)throw Error("Combined built-in companion art exceeds 8 MiB");
console.log(`Companion resources passed: ${count} files, ${(total/1024/1024).toFixed(2)} MiB / 8 MiB.`);
