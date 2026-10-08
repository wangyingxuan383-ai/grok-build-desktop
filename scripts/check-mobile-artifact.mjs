import {readFile} from "node:fs/promises";
import {unzipSync} from "fflate";
const path=process.argv[2];if(!path)throw Error("Provide an APK path");
const privateStrings=JSON.parse(process.env.GROK_PRIVATE_STRINGS||"[]").filter(value=>typeof value==="string"&&value.length>5);
const needles=privateStrings.flatMap(value=>[Buffer.from(value),Buffer.from(value,"utf16le")]);
const entries=unzipSync(new Uint8Array(await readFile(path)));let checked=0;
const definedTypes=new Set(),coreTypeReferences=new Set();
for(const [name,data]of Object.entries(entries)){
 const buffer=Buffer.from(data.buffer,data.byteOffset,data.byteLength);checked++;
 if(needles.some(needle=>buffer.includes(needle)))throw Error(`Private runtime data found in APK entry: ${name}`);
 if(name==="assets/index.android.bundle"&&["grokFixture","fixture-token"].some(text=>buffer.includes(Buffer.from(text))))throw Error("Acceptance adapter included in production APK");
 if(/^classes\d*\.dex$/.test(name)){
  if(buffer.subarray(0,4).toString()!=="dex\n")throw Error("Unrecognized APK DEX format");
  const stringsOffset=buffer.readUInt32LE(60),typeCount=buffer.readUInt32LE(64),typesOffset=buffer.readUInt32LE(68),classCount=buffer.readUInt32LE(96),classesOffset=buffer.readUInt32LE(100);
  const types=Array.from({length:typeCount},(_,index)=>{
   const stringIndex=buffer.readUInt32LE(typesOffset+index*4);let offset=buffer.readUInt32LE(stringsOffset+stringIndex*4);
   // DEX strings start with a ULEB128 UTF-16 length; class descriptors are ASCII.
   while(buffer[offset++]&0x80){}
   const end=buffer.indexOf(0,offset);if(end<0)throw Error("Invalid DEX string");return buffer.toString("utf8",offset,end);
  });
  for(const type of types)if(type.startsWith("Lexpo/modules/kotlin/types/"))coreTypeReferences.add(type);
  for(let index=0;index<classCount;index++)definedTypes.add(types[buffer.readUInt32LE(classesOffset+index*32)]);
 }
}
if(!entries["assets/GROK_REMOTE_NOTICES.txt"])throw Error("Missing bundled third-party notices");
const missing=[...coreTypeReferences].filter(type=>!definedTypes.has(type));
if(missing.length)throw Error(`APK references missing Expo core type definitions: ${missing.join(", ")}`);
if(!definedTypes.has("Lexpo/modules/asset/AssetModule;")||!definedTypes.has("Lexpo/modules/grokremote/GrokRemoteModule;"))throw Error("APK is missing required native modules");
console.log(`APK native DEX contract checks passed (${coreTypeReferences.size} Expo core types)`);
console.log(`APK privacy/fixture/license checks passed (${checked} entries)`);
